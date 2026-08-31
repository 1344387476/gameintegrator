const test = require('node:test')
const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const { readFile } = require('node:fs/promises')
const path = require('node:path')
const { createTestDatabase } = require('../test-support/database')
const { readMigrations, migrate, verifyMigrations } = require('../src/migrations')
const { createIdentityStore } = require('../src/identity-store')
const { createProfileStore } = require('../src/profile-store')
const { createRoomStore } = require('../src/room-store')
const { createScoreStore } = require('../src/score-store')
const { createHistoryStore } = require('../src/history-store')
const { createQRCodeService } = require('../src/qrcode')
const { withTransaction } = require('../src/database')
const { hashToken } = require('../src/auth')

test('数据库迁移可重复执行，拒绝篡改历史版本、插入旧编号和未知数据库版本', async t => {
  const db = await createTestDatabase()
  t.after(() => db.end())
  const migrations = await readMigrations()
  await assert.rejects(verifyMigrations(db, migrations))
  assert.deepEqual(await migrate(db, migrations), ['001_identity.sql', '002_rooms.sql', '003_score_ledger.sql', '004_history_qrcode.sql'])
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

test('已有001用户与头像升级到当前版本时保留资料，不创建虚假房间关联', async t => {
  const db = await createTestDatabase()
  t.after(() => db.end())
  const migrations = await readMigrations()
  await migrate(db, [migrations[0]])
  const id = '39159b22-69ba-4aaf-8fc8-b1109a81c726'
  await db.query(`INSERT INTO users(id,app_id,openid,nickname,avatar_file_id)
    VALUES ($1,'wx7687ea673d95f908','existing-user','原资料','existing-avatar')`, [id])
  assert.deepEqual(await migrate(db, migrations), ['002_rooms.sql', '003_score_ledger.sql', '004_history_qrcode.sql'])
  assert.deepEqual((await db.query('SELECT nickname,avatar_file_id FROM users WHERE id = $1', [id])).rows[0], {
    nickname: '原资料', avatar_file_id: 'existing-avatar'
  })
  assert.equal((await db.query('SELECT * FROM active_room_memberships')).rows.length, 0)
  await verifyMigrations(db, migrations)
})

test('002升级003/004保留积分、席位、回执和已有流水，不创建虚假战绩', async t => {
  const db = await createTestDatabase()
  t.after(() => db.end())
  const migrations = await readMigrations()
  await migrate(db, migrations.slice(0, 2))
  const appId = 'wx7687ea673d95f908'
  const identity = createIdentityStore(db, appId)
  const alice = (await identity.createSession({ openid: 'upgrade-alice', tokenHash: hashToken('upgrade-alice'), ttlSeconds: 600 })).user
  const bob = (await identity.createSession({ openid: 'upgrade-bob', tokenHash: hashToken('upgrade-bob'), ttlSeconds: 600 })).user
  const rooms = createRoomStore(db, appId)
  const input = { operationId: 'upgrade-create', roomName: '已有房间', mode: 'bet' }
  const room = await rooms.create(alice.id, input)
  await rooms.joinById(bob.id, room.roomId, { operationId: 'upgrade-join' })
  await db.query('UPDATE room_members SET score = CASE WHEN user_id=$1 THEN -9 ELSE 9 END WHERE room_id=$2', [alice.id, room.roomId])
  const before = (await db.query('SELECT user_id,seat,score FROM room_members ORDER BY seat')).rows
  const commands = (await db.query('SELECT * FROM room_commands ORDER BY operation_id')).rows
  assert.deepEqual(await migrate(db, migrations.slice(0, 3)), ['003_score_ledger.sql'])
  assert.deepEqual((await db.query('SELECT user_id,seat,score FROM room_members ORDER BY seat')).rows, before)
  assert.deepEqual((await db.query('SELECT * FROM room_commands ORDER BY operation_id')).rows, commands)
  const snapshot = await rooms.get(alice.id, room.roomId)
  assert.equal(snapshot.stateVersion, 2)
  assert.equal(snapshot.pot, 0)
  assert.equal(snapshot.baseBetValue, null)
  assert.ok(snapshot.players.every(player => player.lastDepositAmount === null && player.lastDepositAt === null))
  assert.deepEqual(await rooms.create(alice.id, input), { ...room, duplicated: true })
  const scores = createScoreStore(db, appId)
  assert.deepEqual((await scores.list(alice.id, room.roomId)).items, [])
  await scores.execute(alice.id, room.roomId, { operationId: 'upgrade-first-bet', action: 'BET', payload: { amount: 1 } })
  const ledger = (await db.query('SELECT * FROM score_ledger')).rows
  assert.deepEqual(await migrate(db, migrations), ['004_history_qrcode.sql'])
  assert.deepEqual((await db.query('SELECT * FROM score_ledger')).rows, ledger)
  assert.equal((await db.query('SELECT * FROM histories')).rows.length, 0)
  assert.equal((await rooms.get(alice.id, room.roomId)).pot, 1)
  await verifyMigrations(db, migrations)
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

test('隔离部署账号可操作房间账本，不能建表或篡改流水、回执、迁移记录', async t => {
  const db = await createTestDatabase()
  t.after(() => db.end())
  const directory = path.join(__dirname, '..', 'deploy', 'smoke')
  const databaseName = (await db.query('SELECT current_database() AS name')).rows[0].name
  // PGlite没有psql或网络登录：仅替换环境变量和测试数据库名，执行部署SQL本身。
  // 容器入口、SCRAM密码登录与真实PostgreSQL17仍需服务器验证。
  const initSql = (await readFile(path.join(directory, 'init.sql'), 'utf8'))
    .replace(/^\\getenv app_password APP_DB_PASSWORD\r?\n/mu, '')
    .replace(":'app_password'", "'test-only-password-with-at-least-32-characters'")
    .replaceAll('gameintegrator_smoke', '"' + databaseName.replaceAll('"', '""') + '"')
  await db.query(initSql)
  await migrate(db, await readMigrations())
  await db.query(await readFile(path.join(directory, 'grant-app.sql'), 'utf8'))
  assert.deepEqual((await db.query("SELECT rolsuper, rolcreatedb, rolcreaterole, rolreplication FROM pg_roles WHERE rolname = 'gameintegrator_app'")).rows[0], {
    rolsuper: false, rolcreatedb: false, rolcreaterole: false, rolreplication: false
  })
  await db.query('SET ROLE gameintegrator_app')
  await verifyMigrations(db, await readMigrations())
  const store = createIdentityStore(db, 'wx7687ea673d95f908')
  const tokenHash = hashToken('restricted-role-token')
  await store.createSession({ openid: 'restricted-role-user', tokenHash, ttlSeconds: 600 })
  assert.ok(await store.findSession(tokenHash))
  const profileStore = createProfileStore(db, 'wx7687ea673d95f908')
  const userId = (await store.findSession(tokenHash)).user.id
  assert.equal((await profileStore.updateNickname(userId, '测试玩家')).nickname, '测试玩家')
  const avatarId = '0f1122ba-bcdc-4134-9234-567890abcdef'
  assert.equal((await profileStore.replaceAvatar(userId, avatarId)).user.avatarFileId, avatarId)
  assert.equal(await profileStore.canReadAvatar(userId, avatarId), true)
  const rooms = createRoomStore(db, 'wx7687ea673d95f908')
  const room = await rooms.create(userId, { operationId: 'restricted-create', roomName: '受限账号', mode: 'normal' })
  await profileStore.updateNickname(userId, '同步资料')
  assert.equal((await rooms.get(userId, room.roomId)).players[0].nickname, '同步资料')
  const peer = (await store.createSession({ openid: 'restricted-peer', tokenHash: hashToken('restricted-peer'), ttlSeconds: 600 })).user
  await rooms.joinById(peer.id, room.roomId, { operationId: 'restricted-join' })
  const scores = createScoreStore(db, 'wx7687ea673d95f908')
  await scores.execute(userId, room.roomId, { operationId: 'restricted-transfer', action: 'TRANSFER', payload: { toUserId: peer.id, amount: 3 } })
  assert.equal((await scores.list(userId, room.roomId)).items[0].amount, 3)
  await assert.rejects(db.query('UPDATE score_ledger SET amount=1'), { code: '42501' })
  await assert.rejects(db.query('DELETE FROM score_ledger'), { code: '42501' })
  await assert.rejects(db.query('UPDATE score_ledger_changes SET score_after=0'), { code: '42501' })
  await assert.rejects(db.query('DELETE FROM score_ledger_changes'), { code: '42501' })
  await rooms.leave(peer.id, room.roomId, { operationId: 'restricted-peer-leave' })
  assert.equal((await rooms.leave(userId, room.roomId, { operationId: 'restricted-leave' })).deleted, true)
  assert.equal((await db.query('SELECT * FROM score_ledger')).rows.length, 0)
  assert.equal((await db.query('SELECT * FROM score_ledger_changes')).rows.length, 0)
  await assert.rejects(db.query("UPDATE room_commands SET action = 'leave'"), { code: '42501' })
  await assert.rejects(db.query('DELETE FROM room_commands'), { code: '42501' })
  const finalRoom = await rooms.create(userId, { operationId: 'restricted-final-room', roomName: '结算权限', mode: 'normal' })
  const qr = createQRCodeService(db, 'wx7687ea673d95f908', async () => Buffer.from('test-code'))
  await qr.getOrCreate(userId, finalRoom.roomId)
  const result = await rooms.settle(userId, finalRoom.roomId, { operationId: 'restricted-settle' })
  assert.equal((await createHistoryStore(db, 'wx7687ea673d95f908').get(userId, result.historyId)).players.length, 1)
  assert.equal((await db.query('SELECT * FROM room_qrcodes')).rows.length, 0)
  await assert.rejects(db.query("UPDATE histories SET room_name='tampered'"), { code: '42501' })
  await assert.rejects(db.query('DELETE FROM histories'), { code: '42501' })
  await assert.rejects(db.query('UPDATE history_players SET score=1'), { code: '42501' })
  await assert.rejects(db.query('DELETE FROM history_players'), { code: '42501' })
  await store.revokeSession(tokenHash)
  assert.equal(await store.findSession(tokenHash), null)
  await assert.rejects(db.query('CREATE TABLE denied_probe(id integer)'), { code: '42501' })
  await assert.rejects(db.query("UPDATE schema_migrations SET checksum = 'tampered'"), { code: '42501' })
})
