const test = require('node:test')
const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const { createTestDatabase } = require('../test-support/database')
const { readMigrations, migrate, verifyMigrations } = require('../src/migrations')
const { createIdentityStore } = require('../src/identity-store')
const { withTransaction } = require('../src/database')
const { hashToken } = require('../src/auth')

test('数据库迁移可重复执行，拒绝篡改历史版本、插入旧编号和未知数据库版本', async t => {
  const db = await createTestDatabase()
  t.after(() => db.end())
  const migrations = await readMigrations()
  await assert.rejects(verifyMigrations(db, migrations))
  assert.deepEqual(await migrate(db, migrations), ['001_identity.sql'])
  assert.deepEqual(await migrate(db, migrations), [])
  await verifyMigrations(db, migrations)
  await assert.rejects(migrate(db, [{ ...migrations[0], checksum: 'changed' }]), /不能修改/)
  await assert.rejects(migrate(db, [{ name: '000_earlier.sql', sql: 'SELECT 1', checksum: 'earlier' }, ...migrations]), /顺序不一致/)
  await assert.rejects(verifyMigrations(db, []), /不一致/)
})

test('迁移中途失败回滚表结构和版本记录，可重新修正未应用的迁移', async t => {
  const db = await createTestDatabase()
  t.after(() => db.end())
  const sql = 'CREATE TABLE example_failure(id integer); SELECT * FROM table_that_does_not_exist;'
  await assert.rejects(migrate(db, [{ name: '001_failure.sql', sql, checksum: createHash('sha256').update(sql).digest('hex') }]))
  const result = await db.query("SELECT to_regclass('public.example_failure') AS test_table, to_regclass('public.schema_migrations') AS version_table")
  assert.deepEqual(result.rows[0], { test_table: null, version_table: null })
  await migrate(db, await readMigrations())
})

test('同微信身份复用用户，凭证只存哈希；失败不能留下孤立用户', async t => {
  const db = await createTestDatabase()
  t.after(() => db.end())
  await migrate(db, await readMigrations())
  const store = createIdentityStore(db, 'wx7687ea673d95f908')
  const first = await store.createSession({ openid: 'wechat-user', tokenHash: hashToken('first-token'), ttlSeconds: 600 })
  const second = await store.createSession({ openid: 'wechat-user', tokenHash: hashToken('second-token'), ttlSeconds: 600 })
  assert.equal(first.isNewUser, true)
  assert.equal(second.isNewUser, false)
  assert.equal(first.user.id, second.user.id)
  assert.match(first.user.nickname, /^玩家\d{3}$/u)
  assert.equal(first.user.openid, undefined)
  assert.equal((await db.query('SELECT * FROM users')).rows.length, 1)
  const sessions = (await db.query('SELECT token_hash FROM sessions')).rows
  assert.equal(sessions.length, 2)
  assert.ok(sessions.every(row => /^[0-9a-f]{64}$/u.test(row.token_hash)))
  await assert.rejects(store.createSession({ openid: 'another-user', tokenHash: hashToken('first-token'), ttlSeconds: 600 }))
  assert.equal((await db.query('SELECT * FROM users')).rows.length, 1)
})

test('会话按AppID隔离；过期或注销后不能使用，其他有效会话不受影响', async t => {
  const db = await createTestDatabase()
  t.after(() => db.end())
  await migrate(db, await readMigrations())
  const store = createIdentityStore(db, 'wx7687ea673d95f908')
  const otherApp = createIdentityStore(db, 'wx0000000000000000')
  const active = hashToken('active')
  const expired = hashToken('expired')
  await store.createSession({ openid: 'user', tokenHash: active, ttlSeconds: 600 })
  await store.createSession({ openid: 'user', tokenHash: expired, ttlSeconds: 600 })
  await db.query("UPDATE sessions SET created_at = now() - interval '2 days', expires_at = now() - interval '1 day' WHERE token_hash = $1", [expired])
  assert.equal(await store.findSession(expired), null)
  assert.equal(await otherApp.findSession(active), null)
  await otherApp.revokeSession(active)
  assert.ok(await store.findSession(active))
  await store.createSession({ openid: 'user', tokenHash: hashToken('new'), ttlSeconds: 600 })
  assert.equal((await db.query('SELECT token_hash FROM sessions WHERE token_hash=$1', [expired])).rows.length, 0)
  await store.revokeSession(active)
  assert.equal(await store.findSession(active), null)
  assert.ok(await store.findSession(hashToken('new')))
})

test('回滚失败时丢弃连接，保留原始业务错误', async () => {
  const original = new Error('original')
  let destroyed
  const pool = { connect: async () => ({
    query: async sql => { if (sql === 'ROLLBACK') throw new Error('connection broken') },
    release: flag => { destroyed = flag }
  }) }
  await assert.rejects(withTransaction(pool, async () => { throw original }), error => error === original)
  assert.equal(destroyed, true)
})
