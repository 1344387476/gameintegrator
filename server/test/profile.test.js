const test = require('node:test')
const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const { mkdtemp, readdir } = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { Readable } = require('node:stream')
const sharp = require('sharp')
const { createTestDatabase } = require('../test-support/database')
const { testConfig } = require('../test-support/config')
const { readMigrations, migrate } = require('../src/migrations')
const { createIdentityStore } = require('../src/identity-store')
const { createAuth } = require('../src/auth')
const { createProfileStore } = require('../src/profile-store')
const { createProfile, normalizeAvatar, MAX_AVATAR_BYTES } = require('../src/profile')
const { createAvatarStorage } = require('../src/avatar-storage')
const { buildApp } = require('../src/app')

function memoryStorage() {
  const files = new Map()
  const removed = []
  return {
    files, removed,
    async put(id, buffer) { assert.ok(!files.has(id)); files.set(id, buffer) },
    async read(id) {
      if (!files.has(id)) throw Object.assign(new Error('missing'), { code: 'ENOENT' })
      return files.get(id)
    },
    async remove(id) { removed.push(id); files.delete(id) }
  }
}

async function fixture(t, options = {}) {
  const db = await createTestDatabase()
  t.after(() => db.end())
  await migrate(db, await readMigrations())
  const config = testConfig()
  const auth = createAuth({ store: createIdentityStore(db, config.wechat.appId), sessionTtlSeconds: 600, exchangeCode: async code => ({ openid: code }) })
  const store = createProfileStore(db, config.wechat.appId)
  const storage = memoryStorage()
  const profile = createProfile({ store, storage })
  const app = await buildApp({ config, auth, profile, checkReady: async () => {}, logger: options.logger || false })
  t.after(() => app.close())
  const alice = await auth.login('alice')
  const bob = await auth.login('bob')
  const headers = { authorization: `Bearer ${alice.token}` }
  const png = await sharp({ create: { width: 800, height: 400, channels: 4, background: '#ff880080' } }).png().toBuffer()
  const upload = (buffer = png, options = {}) => {
    const multipart = form([{ buffer, ...options.part }, ...(options.extraParts || [])])
    return app.inject({ method: 'POST', url: '/api/v1/users/me/avatar', headers: { ...headers, ...multipart.headers }, payload: multipart.payload, ...options.request })
  }
  return { db, app, auth, store, storage, profile, alice, bob, headers, png, upload }
}

function form(parts) {
  const boundary = 'test-avatar-boundary'
  const buffers = []
  for (const part of parts) {
    const disposition = `Content-Disposition: form-data; name="${part.name || 'avatar'}"${part.field ? '' : `; filename="${part.filename || '../../client-name.png'}"`}`
    buffers.push(Buffer.from(`--${boundary}\r\n${disposition}\r\nContent-Type: ${part.mimetype || 'image/png'}\r\n\r\n`), part.buffer, Buffer.from('\r\n'))
  }
  buffers.push(Buffer.from(`--${boundary}--\r\n`))
  return { headers: { 'content-type': `multipart/form-data; boundary=${boundary}` }, payload: Buffer.concat(buffers) }
}

test('修改本人昵称严格校验，只改昵称不会覆盖已有头像，跨App不能修改', async t => {
  const { app, headers, upload, db, alice } = await fixture(t)
  const uploaded = await upload()
  assert.equal(uploaded.statusCode, 200, uploaded.body)
  const avatarId = uploaded.json().data.avatarFileId
  const response = await app.inject({ method: 'PATCH', url: '/api/v1/users/me', headers, payload: { nickname: ' 小明😀 ' } })
  assert.equal(response.statusCode, 200)
  assert.equal(response.json().data.nickname, '小明😀')
  assert.equal(response.json().data.avatarFileId, avatarId)
  const current = await app.inject({ url: '/api/v1/users/me', headers })
  assert.deepEqual(current.json().data, response.json().data)
  assert.equal((await app.inject({ method: 'PATCH', url: '/api/v1/users/me', headers, payload: { nickname: '😀'.repeat(10) } })).statusCode, 200)
  for (const payload of [{}, { nickname: '   ' }, { nickname: 123 }, { nickname: 'a'.repeat(11) }, { nickname: 'a\n' }, { nickname: '\ud800' }, { nickname: 'ok', openid: 'bob' }, { nickname: 'ok', avatarFileId: null }, { nickname: 'ok', userId: 'bob' }]) {
    assert.equal((await app.inject({ method: 'PATCH', url: '/api/v1/users/me', headers, payload })).statusCode, 400)
  }
  assert.equal((await app.inject({ method: 'PATCH', url: '/api/v1/users/me', payload: { nickname: 'bad' } })).statusCode, 401)
  const otherApp = createProfileStore(db, 'wx0000000000000000')
  await assert.rejects(otherApp.updateNickname(alice.user.id, 'bad'), { code: 'AUTH_REQUIRED' })
  await assert.rejects(otherApp.replaceAvatar(alice.user.id, randomUUID()), { code: 'AUTH_REQUIRED' })
  assert.equal(await otherApp.canReadAvatar(alice.user.id, avatarId), false)
})

test('头像重编码、鉴权读取、替换后单文件清理，旧头像和他人头像不可读', async t => {
  const { app, headers, upload, storage, bob, store, alice } = await fixture(t)
  const first = await upload()
  assert.equal(first.statusCode, 200, first.body)
  const id = first.json().data.avatarFileId
  assert.match(id, /^[0-9a-f-]{36}$/u)
  assert.ok(!first.body.includes('client-name'))
  const url = `/api/v1/avatars/${id}`
  const image = await app.inject({ url, headers })
  assert.equal(image.statusCode, 200)
  assert.equal(image.headers['content-type'], 'image/jpeg')
  assert.equal(image.headers['x-content-type-options'], 'nosniff')
  assert.equal(image.headers['cache-control'], 'no-store')
  const metadata = await sharp(image.rawPayload).metadata()
  assert.equal(metadata.format, 'jpeg')
  assert.equal(metadata.width, 512)
  assert.equal(metadata.height, 256)
  assert.equal(metadata.exif, undefined)
  assert.equal((await app.inject(url)).statusCode, 401)
  assert.equal((await app.inject({ url, headers: { authorization: `Bearer ${bob.token}` } })).statusCode, 404)
  assert.equal((await app.inject({ url: `${url}?token=${bob.token}`, headers })).statusCode, 400)
  for (const invalid of ['not-a-uuid', '..%2fsecret', randomUUID()]) {
    assert.equal((await app.inject({ url: `/api/v1/avatars/${invalid}`, headers })).statusCode, 404)
  }
  // 返回的是保存时最新昵称，不是会话鉴权时的旧快照。
  await store.updateNickname(alice.user.id, '新昵称')
  const second = await upload()
  assert.equal(second.json().data.nickname, '新昵称')
  assert.notEqual(second.json().data.avatarFileId, id)
  assert.deepEqual(storage.removed, [id])
  assert.equal(storage.files.size, 1)
  assert.equal((await app.inject({ url, headers })).statusCode, 404)
  const currentId = second.json().data.avatarFileId
  storage.files.delete(currentId)
  assert.equal((await app.inject({ url: `/api/v1/avatars/${currentId}`, headers })).statusCode, 404)
  assert.equal((await app.inject({ url: '/api/v1/users/me', headers })).json().data.avatarFileId, currentId)
})

test('拒绝多文件、额外字段、错误字段、损坏表单和超限上传，失败保留原资料', async t => {
  const { app, headers, upload, storage, png } = await fixture(t)
  const first = (await upload()).json().data
  const cases = [
    { part: { name: 'other' } },
    { extraParts: [{ buffer: png }] },
    { extraParts: [{ field: true, name: 'openid', buffer: Buffer.from('victim') }] },
    { request: { payload: Buffer.from('--broken'), headers: { ...headers, 'content-type': 'multipart/form-data' } } },
    { request: { payload: {}, headers } }
  ]
  for (const options of cases) {
    const response = await upload(png, options)
    assert.ok([400, 415].includes(response.statusCode), response.body)
  }
  assert.equal((await upload(Buffer.alloc(MAX_AVATAR_BYTES + 1))).statusCode, 413)
  assert.equal((await upload(Buffer.alloc(MAX_AVATAR_BYTES + 20000))).statusCode, 413)
  const noAuth = await upload(png, { request: { headers: form([{ buffer: png }]).headers } })
  assert.equal(noAuth.statusCode, 401)
  assert.equal(storage.files.size, 1)
  assert.deepEqual((await app.inject({ url: '/api/v1/users/me', headers })).json().data, first)
})

test('无Content-Length的超大multipart流也中断，限流不能伪造代理头绕过', async t => {
  const { app, headers, upload, storage } = await fixture(t)
  const oversized = form([{ buffer: Buffer.alloc(MAX_AVATAR_BYTES + 20000) }])
  await assert.rejects(app.inject({ method: 'POST', url: '/api/v1/users/me/avatar', headers: { ...headers, ...oversized.headers }, payload: Readable.from([oversized.payload]) }), { code: 'REQUEST_TOO_LARGE' })
  assert.equal(storage.files.size, 0)
  for (let i = 0; i < 9; i++) await upload(Buffer.from('invalid'), { request: { headers: { ...headers, ...oversized.headers, 'x-forwarded-for': `192.0.2.${i}` } } })
  const limited = await upload()
  assert.equal(limited.statusCode, 429)
  assert.ok(limited.headers['retry-after'])
})

test('仅接受真实静态PNG/JPEG/WebP，去除元数据，拒绝伪装文件、超大像素及损坏内容', async () => {
  const source = sharp({ create: { width: 32, height: 32, channels: 3, background: '#123456' } })
  for (const [format, mime] of [['png', 'image/png'], ['jpeg', 'image/jpeg'], ['webp', 'image/webp']]) {
    const input = await source.clone().withMetadata().toFormat(format).toBuffer()
    const output = await normalizeAvatar(input, mime)
    const meta = await sharp(output).metadata()
    assert.equal(meta.format, 'jpeg')
    assert.equal(meta.exif, undefined)
    assert.equal(meta.icc, undefined)
  }
  const png = await source.clone().png().toBuffer()
  assert.equal((await sharp(await normalizeAvatar(png, 'application/octet-stream')).metadata()).format, 'jpeg')
  const animationControl = Buffer.alloc(20)
  animationControl.writeUInt32BE(8)
  animationControl.write('acTL', 4, 'ascii')
  const apngMarker = Buffer.concat([png.subarray(0, 33), animationControl, png.subarray(33)])
  const huge = await sharp({ create: { width: 5000, height: 5000, channels: 3, background: '#ffffff' } }).png().toBuffer()
  const frames = Buffer.concat([Buffer.alloc(12, 0), Buffer.alloc(12, 255)])
  const animation = await sharp(frames, { raw: { width: 2, height: 4, pageHeight: 2, channels: 3 } }).webp({ delay: [100, 100] }).toBuffer()
  assert.equal((await sharp(animation).metadata()).pages, 2)
  for (const [buffer, mime, code] of [
    [Buffer.from('<svg/>'), 'image/png', 'UNSUPPORTED_AVATAR'],
    [png, 'image/jpeg', 'UNSUPPORTED_AVATAR'],
    [png.subarray(0, 30), 'image/png', 'INVALID_AVATAR'],
    [Buffer.alloc(0), 'image/png', 'INVALID_AVATAR'],
    [huge, 'image/png', 'INVALID_AVATAR'],
    [animation, 'image/webp', 'INVALID_AVATAR'],
    [apngMarker, 'image/png', 'INVALID_AVATAR'],
    [Buffer.alloc(MAX_AVATAR_BYTES + 1), 'image/png', 'REQUEST_TOO_LARGE']
  ]) await assert.rejects(normalizeAvatar(buffer, mime), { code })
})

test('落盘失败不改资料；提交结果未知不删新文件；旧头像清理失败不回滚已保存资料', async t => {
  const { profile, store, storage, png, alice, db } = await fixture(t)
  const warnings = []
  const log = { warn: (...args) => warnings.push(args) }
  const read = async () => ({ buffer: png, mimetype: 'image/png' })
  const first = await profile.upload(alice.user.id, read, log)
  const originalPut = storage.put
  storage.put = async () => { throw new Error('disk full private path') }
  await assert.rejects(profile.upload(alice.user.id, read, log), /disk full/)
  assert.equal((await db.query('SELECT avatar_file_id FROM users WHERE id=$1', [alice.user.id])).rows[0].avatar_file_id, first.avatarFileId)
  storage.put = originalPut
  const originalReplace = store.replaceAvatar
  store.replaceAvatar = async (...args) => { await originalReplace(...args); throw new Error('COMMIT response lost') }
  await assert.rejects(profile.upload(alice.user.id, read, log), /COMMIT/)
  const committed = (await db.query('SELECT avatar_file_id FROM users WHERE id=$1', [alice.user.id])).rows[0].avatar_file_id
  assert.notEqual(committed, first.avatarFileId)
  assert.ok(storage.files.has(committed))
  assert.equal(storage.removed.length, 0)
  assert.ok(!JSON.stringify(warnings).includes('COMMIT response lost'))
  store.replaceAvatar = originalReplace
  storage.remove = async () => { throw new Error('unlink failed') }
  const third = await profile.upload(alice.user.id, read, log)
  assert.ok(storage.files.has(third.avatarFileId))
  assert.equal(warnings.length, 3)
})

test('上传同时只处理一个，不堆积Buffer，失败后释放；事务失败保持旧头像引用', async t => {
  const { profile, png, alice, db } = await fixture(t)
  let release
  const read = new Promise(resolve => { release = resolve })
  const pending = profile.upload(alice.user.id, () => read, { warn() {} })
  await assert.rejects(profile.upload(alice.user.id, () => assert.fail('busy must not read'), { warn() {} }), { code: 'UPLOAD_BUSY' })
  release({ buffer: png, mimetype: 'image/png' })
  const first = await pending
  const failingPool = {
    async connect() {
      const client = await db.connect()
      return { release: () => client.release(), query: (sql, params) => {
        if (sql.startsWith('UPDATE users')) throw new Error('simulated write failure')
        return client.query(sql, params)
      } }
    }
  }
  await assert.rejects(createProfileStore(failingPool, testConfig().wechat.appId).replaceAvatar(alice.user.id, randomUUID()), /simulated/)
  assert.equal((await db.query('SELECT avatar_file_id FROM users WHERE id=$1', [alice.user.id])).rows[0].avatar_file_id, first.avatarFileId)
  await assert.rejects(profile.upload(alice.user.id, async () => { throw new Error('read failed') }, { warn() {} }), /read failed/)
  await profile.upload(alice.user.id, async () => ({ buffer: png, mimetype: 'image/png' }), { warn() {} })
})

test('本地存储重建后可读、拒绝任意路径和覆盖，每次只删除一个明确头像文件', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'gameintegrator-avatar-test-'))
  const storage = await createAvatarStorage(directory)
  const id = randomUUID()
  try {
    await storage.put(id, Buffer.from('test-avatar'))
    await assert.rejects(storage.put(id, Buffer.from('overwrite')), { code: 'EEXIST' })
    const restarted = await createAvatarStorage(directory)
    assert.equal((await restarted.read(id)).toString(), 'test-avatar')
    for (const bad of ['../secret', 'https://example.com/a', 'avatar.jpg']) {
      await assert.rejects(storage.put(bad, Buffer.from('bad')), /invalid avatar file id/)
      await assert.rejects(storage.read(bad), /invalid avatar file id/)
      await assert.rejects(storage.remove(bad), /invalid avatar file id/)
    }
  } finally { await storage.remove(id) }
  assert.deepEqual(await readdir(directory), [])
  // 保留空测试目录，不递归删除，也不遍历删除目录内容。
})

test('trace日志仍不泄露multipart请求凭证、文件名和文件内容', async t => {
  const lines = []
  const { upload, alice } = await fixture(t, { logger: { level: 'trace', stream: { write: line => lines.push(line) } } })
  assert.equal((await upload()).statusCode, 200)
  const logs = lines.join('')
  for (const secret of [alice.token, 'client-name.png', 'authorization']) assert.ok(!logs.includes(secret), secret)
})
