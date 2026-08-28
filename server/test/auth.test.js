const test = require('node:test')
const assert = require('node:assert/strict')
const { createTestDatabase } = require('../test-support/database')
const { testConfig } = require('../test-support/config')
const { readMigrations, migrate, verifyMigrations } = require('../src/migrations')
const { createIdentityStore } = require('../src/identity-store')
const { createAuth, hashToken } = require('../src/auth')
const { buildApp } = require('../src/app')
const { ApiError } = require('../src/errors')

async function fixture(t, overrides = {}) {
  const db = await createTestDatabase()
  const migrations = await readMigrations()
  await migrate(db, migrations)
  const config = testConfig()
  const auth = createAuth({ store: createIdentityStore(db, config.wechat.appId), sessionTtlSeconds: config.sessionTtlSeconds, exchangeCode: async code => ({ openid: `user-${code}` }), ...overrides.auth })
  const app = await buildApp({ config, auth, checkReady: () => verifyMigrations(db, migrations), logger: false, ...overrides.app })
  t.after(async () => { await app.close(); await db.end() })
  return { db, app, config }
}

test('HTTP登录、读取本人、重复登录、单会话注销完整链路', async t => {
  const { app, db } = await fixture(t)
  const login = await app.inject({ method: 'POST', url: '/api/v1/auth/wechat', payload: { code: 'alice' } })
  assert.equal(login.statusCode, 200)
  const { data } = login.json()
  assert.match(data.token, /^gi_[A-Za-z0-9_-]{43}$/u)
  assert.equal(data.isNewUser, true)
  assert.equal(data.user.openid, undefined)
  assert.equal(data.session_key, undefined)
  assert.equal(login.headers['cache-control'], 'no-store')
  assert.equal(login.headers['x-request-id'], login.json().requestId)
  assert.ok(new Date(data.expiresAt) > new Date())
  const stored = (await db.query('SELECT token_hash FROM sessions')).rows[0]
  assert.equal(stored.token_hash, hashToken(data.token))
  assert.ok(!JSON.stringify(stored).includes(data.token))
  const headers = { authorization: `Bearer ${data.token}` }
  const me = await app.inject({ method: 'GET', url: '/api/v1/users/me', headers })
  assert.equal(me.statusCode, 200)
  assert.deepEqual(me.json().data, data.user)
  const repeat = (await app.inject({ method: 'POST', url: '/api/v1/auth/wechat', payload: { code: 'alice' } })).json().data
  assert.equal(repeat.isNewUser, false)
  assert.equal(repeat.user.id, data.user.id)
  assert.notEqual(repeat.token, data.token)
  assert.equal((await app.inject({ method: 'POST', url: '/api/v1/auth/logout', headers })).statusCode, 200)
  assert.equal((await app.inject({ method: 'GET', url: '/api/v1/users/me', headers })).statusCode, 401)
  assert.equal((await app.inject({ method: 'GET', url: '/api/v1/users/me', headers: { authorization: `Bearer ${repeat.token}` } })).statusCode, 200)
})

test('拒绝客户端身份字段、类型转换、超长请求和未知接口，不创建用户', async t => {
  const { app, db } = await fixture(t)
  for (const payload of [{ code: 'ok', openid: 'victim' }, { code: 123 }, { code: ' ' }, { code: 'a'.repeat(129) }, {}]) {
    const response = await app.inject({ method: 'POST', url: '/api/v1/auth/wechat', payload })
    assert.equal(response.statusCode, 400)
    assert.equal(response.json().error.code, 'INVALID_REQUEST')
  }
  const oversized = await app.inject({ method: 'POST', url: '/api/v1/auth/wechat', payload: { code: 'a'.repeat(20000) } })
  assert.equal(oversized.statusCode, 413)
  assert.equal((await app.inject({ method: 'GET', url: '/api/v1/users/me?openid=victim' })).statusCode, 400)
  assert.equal((await app.inject({ method: 'GET', url: '/api/v1/users/victim' })).statusCode, 404)
  assert.equal((await db.query('SELECT id FROM users')).rows.length, 0)
})

test('缺失、伪造、过期凭证无法访问；不接受URL或客户端openid作为身份', async t => {
  const { app, db } = await fixture(t)
  for (const authorization of [undefined, 'openid=victim', 'Bearer fake', `Bearer gi_${'x'.repeat(43)}`]) {
    const response = await app.inject({ method: 'GET', url: '/api/v1/users/me', headers: authorization ? { authorization } : {} })
    assert.equal(response.statusCode, 401)
    assert.equal(response.json().error.code, 'AUTH_REQUIRED')
    assert.equal(response.headers['www-authenticate'], 'Bearer')
  }
  const data = (await app.inject({ method: 'POST', url: '/api/v1/auth/wechat', payload: { code: 'alice' } })).json().data
  await db.query("UPDATE sessions SET created_at=now()-interval '2 days', expires_at=now()-interval '1 day'")
  const response = await app.inject({ method: 'GET', url: '/api/v1/users/me', headers: { authorization: `Bearer ${data.token}` } })
  assert.equal(response.statusCode, 401)
})

test('登录限流不能通过伪造X-Forwarded-For绕过', async t => {
  const config = testConfig({ LOGIN_RATE_LIMIT_MAX: '2' })
  let exchanges = 0
  const { app } = await fixture(t, { app: { config }, auth: { exchangeCode: async () => { exchanges++; return { openid: 'user' } } } })
  const responses = []
  for (let i = 0; i < 3; i++) {
    responses.push(await app.inject({ method: 'POST', url: '/api/v1/auth/wechat', headers: { 'x-forwarded-for': `192.0.2.${i + 1}` }, payload: { code: 'code' } }))
  }
  assert.deepEqual(responses.map(response => response.statusCode), [200, 200, 429])
  assert.equal(responses[2].json().error.code, 'RATE_LIMITED')
  assert.ok(responses[2].headers['retry-after'])
  assert.equal(responses[2].headers['cache-control'], 'no-store')
  assert.equal(responses[2].headers['x-request-id'], responses[2].json().requestId)
  assert.equal(exchanges, 2)
})

test('上游失败和数据库失败不泄露内部信息，健康检查区分存活与就绪', async t => {
  const { app, db } = await fixture(t, {
    auth: { exchangeCode: async code => {
      if (code === 'invalid') throw new ApiError(401, 'WECHAT_CODE_INVALID', '请重新登录')
      throw new Error('password=do-not-expose')
    } },
    app: { checkReady: async () => { throw new Error('private DB config') } }
  })
  const invalid = await app.inject({ method: 'POST', url: '/api/v1/auth/wechat', payload: { code: 'invalid' } })
  assert.equal(invalid.statusCode, 401)
  const broken = await app.inject({ method: 'POST', url: '/api/v1/auth/wechat', payload: { code: 'failure' } })
  assert.equal(broken.statusCode, 500)
  assert.ok(!broken.body.includes('do-not-expose'))
  assert.equal((await db.query('SELECT id FROM users')).rows.length, 0)
  assert.equal((await app.inject('/health/live')).statusCode, 200)
  const ready = await app.inject('/health/ready')
  assert.equal(ready.statusCode, 503)
  assert.ok(!ready.body.includes('private'))
})

test('日志不包含原始URL、登录code、Authorization或上游错误正文', async t => {
  const lines = []
  const logger = { level: 'info', stream: { write: line => { lines.push(line) } } }
  const { app } = await fixture(t, { app: { logger } })
  const response = await app.inject({ method: 'POST', url: '/api/v1/auth/wechat', payload: { code: 'sensitive-login-code' } })
  const token = response.json().data.token
  await app.inject({ method: 'GET', url: '/api/v1/users/me', headers: { authorization: `Bearer ${token}`, 'x-request-id': 'untrusted-request-id' } })
  await app.inject('/unknown?secret=sensitive-query')
  const text = lines.join('')
  assert.ok(text.includes('request completed'))
  for (const value of [token, 'sensitive-login-code', 'sensitive-query', 'untrusted-request-id']) assert.ok(!text.includes(value), value)
})
