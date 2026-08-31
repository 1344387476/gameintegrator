const test = require('node:test')
const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const { createTestDatabase } = require('../test-support/database')
const { testConfig } = require('../test-support/config')
const { migrate, readMigrations } = require('../src/migrations')
const { createIdentityStore } = require('../src/identity-store')
const { createAuth } = require('../src/auth')
const { createRoomStore } = require('../src/room-store')
const { createProfileStore } = require('../src/profile-store')
const { createProfile } = require('../src/profile')
const { buildApp } = require('../src/app')
const { roomTransaction } = require('../src/room-state')
const { createHistoryStore } = require('../src/history-store')
const { createScoreStore } = require('../src/score-store')
const { createQRCodeService, roomScene, roomIdFromScene } = require('../src/qrcode')

async function fixture(t, { generate = async () => Buffer.from('test-only-code') } = {}) {
  const db = await createTestDatabase()
  t.after(() => db.end())
  await migrate(db, await readMigrations())
  const config = testConfig()
  const identity = createIdentityStore(db, config.wechat.appId)
  const auth = createAuth({ store: identity, sessionTtlSeconds: 600, exchangeCode: async code => ({ openid: code }) })
  const users = await Promise.all(['alice', 'bob', 'carol'].map(code => auth.login(code)))
  const [alice, bob, carol] = users
  const rooms = createRoomStore(db, config.wechat.appId)
  const profiles = createProfileStore(db, config.wechat.appId)
  const histories = createHistoryStore(db, config.wechat.appId)
  const scores = createScoreStore(db, config.wechat.appId)
  const qrcodes = createQRCodeService(db, config.wechat.appId, generate)
  const profile = createProfile({ store: profiles, storage: { read: async () => Buffer.from('avatar') } })
  const app = await buildApp({ config, auth, rooms, profile, histories, scores, qrcodes, checkReady: async () => {}, logger: false })
  t.after(() => app.close())
  const create = (user = alice, overrides = {}) => rooms.create(user.user.id, { operationId: randomUUID(), roomName: '周末牌局', mode: 'normal', ...overrides })
  const join = (user, room) => rooms.joinById(user.user.id, room.roomId, { operationId: randomUUID() })
  const leave = (user, room) => rooms.leave(user.user.id, room.roomId, { operationId: randomUUID() })
  const request = (user, method, url, payload) => app.inject({ method, url, payload, headers: { authorization: `Bearer ${user.token}` } })
  return { db, config, app, auth, identity, rooms, profiles, histories, scores, qrcodes, alice, bob, carol, create, join, leave, request }
}

test('结算原子保存可信战绩，退出参与者仍可读，不清除其新房间关联', async t => {
  const f = await fixture(t)
  const { db, alice, bob, carol, create, join, leave, rooms, profiles, scores, histories, request, qrcodes } = f
  const room = await create()
  await join(bob, room)
  await profiles.updateNickname(bob.user.id, '结算昵称')
  const avatar = randomUUID()
  await profiles.replaceAvatar(bob.user.id, avatar)
  await scores.execute(alice.user.id, room.roomId, { operationId: randomUUID(), action: 'TRANSFER', payload: { toUserId: bob.user.id, amount: 7 } })
  await leave(bob, room)
  const otherRoom = await create(bob)
  await qrcodes.getOrCreate(alice.user.id, room.roomId)
  const operationId = randomUUID()
  const response = await request(alice, 'POST', `/api/v1/rooms/${room.roomId}/settle`, { operationId })
  assert.equal(response.statusCode, 200, response.body)
  const result = response.json().data
  assert.equal((await rooms.settle(alice.user.id, room.roomId, { operationId })).duplicated, true)
  await assert.rejects(rooms.settle(alice.user.id, room.roomId, { operationId: randomUUID() }), { code: 'ROOM_ENDED' })
  assert.equal(await rooms.current(alice.user.id), null)
  assert.equal((await rooms.current(bob.user.id)).id, otherRoom.roomId)
  await profiles.updateNickname(bob.user.id, '后来的昵称')
  await profiles.replaceAvatar(bob.user.id, randomUUID())
  const detail = await histories.get(bob.user.id, result.historyId)
  assert.deepEqual(detail.players.map(p => p.score), [-7, 7])
  assert.equal(detail.players[1].nickname, '结算昵称')
  assert.equal(detail.players[1].avatarFileId, avatar)
  assert.equal(detail.players[1].isExited, true)
  assert.equal(detail.settledBy, alice.user.id)
  assert.equal((await request(bob, 'GET', `/api/v1/rooms/${room.roomId}/result`)).json().data.id, result.historyId)
  assert.equal((await request(alice, 'GET', `/api/v1/history/${result.historyId}`)).statusCode, 200)
  assert.equal((await request(carol, 'GET', `/api/v1/history/${result.historyId}`)).statusCode, 404)
  assert.equal((await request(carol, 'GET', '/api/v1/history')).json().data.items.length, 0)
  assert.equal(await profiles.canReadAvatar(alice.user.id, avatar), true)
  assert.equal(await profiles.canReadAvatar(carol.user.id, avatar), false)
  assert.equal((await db.query('SELECT * FROM room_qrcodes')).rows.length, 0)
  assert.equal((await db.query('SELECT * FROM score_ledger')).rows.length, 1)
  assert.equal((await db.query('SELECT * FROM histories')).rows.length, 1)
  await assert.rejects(scores.execute(alice.user.id, room.roomId, { operationId: randomUUID(), action: 'TRANSFER', payload: { toUserId: bob.user.id, amount: 1 } }), { code: 'ROOM_ENDED' })
})

test('结算/解散权限、非空奖池、不平账、额外字段与跨App战绩均拒绝', async t => {
  const { db, app, alice, bob, carol, rooms, scores, histories, create, join, leave, request } = await fixture(t)
  const room = await create(alice, { mode: 'bet' })
  await join(bob, room)
  for (const action of ['settle', 'dismiss']) {
    assert.equal((await request(bob, 'POST', `/api/v1/rooms/${room.roomId}/${action}`, { operationId: randomUUID() })).statusCode, 403)
    assert.equal((await request(carol, 'POST', `/api/v1/rooms/${room.roomId}/${action}`, { operationId: randomUUID() })).statusCode, 403)
    assert.equal((await app.inject({ method: 'POST', url: `/api/v1/rooms/${room.roomId}/${action}`, payload: {} })).statusCode, 401)
  }
  assert.equal((await request(alice, 'POST', `/api/v1/rooms/${room.roomId}/settle`, { operationId: randomUUID(), players: [] })).statusCode, 400)
  await scores.execute(alice.user.id, room.roomId, { operationId: randomUUID(), action: 'BET', payload: { amount: 3 } })
  const operationId = randomUUID()
  await assert.rejects(rooms.settle(alice.user.id, room.roomId, { operationId }), { code: 'POT_NOT_EMPTY' })
  await scores.execute(bob.user.id, room.roomId, { operationId: randomUUID(), action: 'CLAIM', payload: {} })
  await db.query('UPDATE room_members SET score=0 WHERE room_id=$1 AND user_id=$2', [room.roomId, alice.user.id])
  await assert.rejects(rooms.settle(alice.user.id, room.roomId, { operationId }), { code: 'LEDGER_UNBALANCED' })
  await db.query('UPDATE room_members SET score=-3 WHERE room_id=$1 AND user_id=$2', [room.roomId, alice.user.id])
  await leave(bob, room)
  await assert.rejects(rooms.settle(bob.user.id, room.roomId, { operationId: randomUUID() }), { code: 'ROOM_MEMBER_REQUIRED' })
  const settled = await rooms.settle(alice.user.id, room.roomId, { operationId })
  await assert.rejects(createHistoryStore(db, 'wx0000000000000000').get(alice.user.id, settled.historyId), { code: 'HISTORY_NOT_FOUND' })
  assert.equal((await histories.list(bob.user.id)).items.length, 1)
  for (const query of ['limit=51', 'cursor=garbage', 'openid=fake', 'cursor=' + Buffer.from(JSON.stringify(['bad-date', settled.historyId])).toString('base64url')]) {
    assert.equal((await request(alice, 'GET', '/api/v1/history?' + query)).statusCode, 400)
  }
})

test('战绩游标按时间加UUID分页，同毫秒和新增记录不造成重复或漏项', async t => {
  const { db, alice, bob, rooms, histories, create, request } = await fixture(t)
  const ids = []
  for (let i = 0; i < 4; i++) {
    const room = await create()
    ids.push((await rooms.settle(alice.user.id, room.roomId, { operationId: randomUUID() })).historyId)
  }
  await db.query("UPDATE histories SET ended_at='2026-08-28T00:00:00.000Z'")
  const first = (await request(alice, 'GET', '/api/v1/history?limit=2')).json().data
  const recent = await create()
  await rooms.settle(alice.user.id, recent.roomId, { operationId: randomUUID() })
  const second = await histories.list(alice.user.id, { limit: 2, cursor: first.nextCursor })
  assert.deepEqual([...first.items, ...second.items].map(item => item.id).sort(), ids.sort())
  assert.equal(second.nextCursor, null)
  assert.equal((await histories.list(bob.user.id)).items.length, 0)
})

test('结算任何写入失败整体回滚，COMMIT响应丢失后原请求只返回一次战绩', async t => {
  const { db, config, alice, bob, rooms, qrcodes, create, join } = await fixture(t)
  const room = await create()
  await join(bob, room)
  await qrcodes.getOrCreate(alice.user.id, room.roomId)
  for (const failure of ['INSERT INTO histories', 'INSERT INTO history_players', "UPDATE rooms SET status", 'DELETE FROM active_room_memberships', 'DELETE FROM room_qrcodes', 'INSERT INTO room_commands']) {
    const pool = { connect: async () => {
      const client = await db.connect()
      return { release: flag => client.release(flag), query: (sql, values) => {
        if (sql.startsWith(failure)) throw new Error('injected settlement failure')
        return client.query(sql, values)
      } }
    } }
    await assert.rejects(createRoomStore(pool, config.wechat.appId).settle(alice.user.id, room.roomId, { operationId: randomUUID() }), /injected settlement failure/)
    assert.equal((await rooms.get(alice.user.id, room.roomId)).stateVersion, 2)
    assert.equal((await db.query('SELECT * FROM histories')).rows.length, 0)
    assert.equal((await db.query('SELECT * FROM history_players')).rows.length, 0)
    assert.equal((await db.query('SELECT * FROM active_room_memberships')).rows.length, 2)
    assert.equal((await db.query('SELECT * FROM room_qrcodes')).rows.length, 1)
  }
  const pool = { connect: async () => {
    const client = await db.connect()
    return { release: flag => client.release(flag), query: async (sql, values) => {
      const result = await client.query(sql, values)
      if (sql === 'COMMIT') throw Object.assign(new Error('response lost'), { code: 'ECONNRESET' })
      return result
    } }
  } }
  const operationId = randomUUID()
  await assert.rejects(createRoomStore(pool, config.wechat.appId).settle(alice.user.id, room.roomId, { operationId }), { code: 'ECONNRESET' })
  assert.equal((await rooms.settle(alice.user.id, room.roomId, { operationId })).duplicated, true)
  assert.equal((await db.query('SELECT * FROM histories')).rows.length, 1)
})

test('解散清理本局账本和二维码、不产生战绩；旧邀请不会因房号复用加入新局', async t => {
  const { db, config, alice, bob, carol, rooms, scores, qrcodes, create, join, leave } = await fixture(t)
  const room = await create(alice, { mode: 'bet' })
  await join(bob, room)
  await scores.execute(alice.user.id, room.roomId, { operationId: randomUUID(), action: 'BET', payload: { amount: 8 } })
  await qrcodes.getOrCreate(alice.user.id, room.roomId)
  await leave(bob, room)
  const another = await create(bob)
  const operationId = randomUUID()
  const result = await rooms.dismiss(alice.user.id, room.roomId, { operationId })
  assert.equal(result.deleted, true)
  assert.equal((await rooms.dismiss(alice.user.id, room.roomId, { operationId })).duplicated, true)
  assert.equal((await rooms.current(bob.user.id)).id, another.roomId)
  for (const table of ['histories', 'score_ledger', 'score_ledger_changes', 'room_qrcodes']) assert.equal((await db.query(`SELECT * FROM ${table}`)).rows.length, 0)
  const reused = createRoomStore(db, config.wechat.appId, { makeCode: () => room.roomCode })
  await reused.create(alice.user.id, { operationId: randomUUID(), roomName: '新局', mode: 'normal' })
  await assert.rejects(rooms.joinByScene(carol.user.id, { operationId: randomUUID(), scene: roomScene(room.roomId) }), { code: 'ROOM_NOT_FOUND' })
})

test('二维码按需生成并持久复用，scene严格还原UUID，成员退出后不可读', async t => {
  let calls = 0
  const f = await fixture(t, { generate: async scene => { calls++; assert.equal(scene.length, 23); return Buffer.from('test-code') } })
  const { db, config, alice, bob, carol, qrcodes, rooms, create, leave, request } = f
  const room = await create()
  assert.equal((await request(alice, 'GET', `/api/v1/rooms/${room.roomId}/qrcode`)).statusCode, 404)
  assert.equal((await request(carol, 'POST', `/api/v1/rooms/${room.roomId}/qrcode`, {})).statusCode, 404)
  assert.equal(calls, 0)
  const response = await request(alice, 'POST', `/api/v1/rooms/${room.roomId}/qrcode`, {})
  assert.equal(response.statusCode, 200)
  assert.match(response.headers['content-type'], /image\/png/u)
  const restarted = createQRCodeService(db, config.wechat.appId, async () => { throw new Error('must use cache') })
  assert.equal((await restarted.getOrCreate(alice.user.id, room.roomId)).toString(), 'test-code')
  assert.equal(calls, 1)
  const scene = roomScene(room.roomId)
  assert.equal(roomIdFromScene(scene), room.roomId)
  const joined = await request(bob, 'POST', '/api/v1/rooms/join-scene', { operationId: randomUUID(), scene })
  assert.equal(joined.statusCode, 200, joined.body)
  assert.equal(joined.json().data.roomId, room.roomId)
  for (const invalid of [room.roomId, room.roomCode, scene + '=', 'r' + 'A'.repeat(22)]) assert.throws(() => roomIdFromScene(invalid), { code: 'INVALID_REQUEST' })
  await leave(bob, room)
  await assert.rejects(qrcodes.read(bob.user.id, room.roomId), { code: 'ROOM_NOT_FOUND' })
  await leave(alice, room)
  assert.equal((await db.query('SELECT * FROM room_qrcodes')).rows.length, 0)
  await assert.rejects(rooms.joinByScene(carol.user.id, { operationId: randomUUID(), scene }), { code: 'ROOM_NOT_FOUND' })
})

test('二维码生成不占用房间事务；限并发、共享请求，结算后不写回过期图片', async t => {
  let release, started
  const began = new Promise(resolve => { started = resolve })
  const f = await fixture(t, { generate: async () => { started(); return new Promise(resolve => { release = resolve }) } })
  const { db, alice, bob, carol, rooms, qrcodes, create, join } = f
  const room = await create()
  await join(bob, room)
  const other = await create(carol)
  const first = qrcodes.getOrCreate(alice.user.id, room.roomId)
  await began
  const second = qrcodes.getOrCreate(bob.user.id, room.roomId)
  // 先安装失败观察器，避免等待期间出现未处理rejection。
  const results = Promise.allSettled([first, second])
  await assert.rejects(qrcodes.getOrCreate(carol.user.id, other.roomId), { code: 'QRCODE_BUSY' })
  await rooms.settle(alice.user.id, room.roomId, { operationId: randomUUID() })
  release(Buffer.from('test-code'))
  for (const result of await results) { assert.equal(result.status, 'rejected'); assert.equal(result.reason.code, 'ROOM_NOT_FOUND') }
  assert.equal((await db.query('SELECT * FROM room_qrcodes')).rows.length, 0)
})

test('HTTP创建、按房号和UUID加入、当前房间查询及主动房主转移', async t => {
  const { request, alice, bob, carol, rooms } = await fixture(t)
  assert.deepEqual((await request(alice, 'GET', '/api/v1/users/me/room')).json().data, { room: null })
  const created = await request(alice, 'POST', '/api/v1/rooms', { operationId: randomUUID(), roomName: ' 牌友 ', mode: 'bet' })
  assert.equal(created.statusCode, 200, created.body)
  const room = created.json().data
  assert.match(room.roomCode, /^[A-Z0-9]{6}$/u)
  assert.equal(room.stateVersion, 1)
  const joined = await request(bob, 'POST', '/api/v1/rooms/join', { operationId: randomUUID(), roomCode: room.roomCode.toLowerCase() })
  assert.equal(joined.statusCode, 200, joined.body)
  assert.equal(joined.json().data.roomId, room.roomId)
  assert.equal((await request(carol, 'POST', `/api/v1/rooms/${room.roomId}/join`, { operationId: randomUUID() })).statusCode, 200)
  const current = (await request(alice, 'GET', '/api/v1/users/me/room')).json().data.room
  assert.equal(current.roomName, '牌友')
  assert.equal(current.mode, 'bet')
  assert.equal(current.ownerId, alice.user.id)
  assert.equal(current.players.length, 3)
  assert.equal(current.stateVersion, 3)
  assert.ok(current.players.every(player => player.score === 0 && !player.isExited && !('openid' in player)))
  assert.equal((await request(alice, 'GET', '/api/v1/users/me')).json().data.currentRoomId, room.roomId)
  assert.equal((await request(alice, 'POST', `/api/v1/rooms/${room.roomId}/owner`, { operationId: randomUUID(), toUserId: bob.user.id })).statusCode, 200)
  assert.equal((await rooms.get(alice.user.id, room.roomId)).ownerId, bob.user.id)
  assert.equal((await request(alice, 'POST', `/api/v1/rooms/${room.roomId}/owner`, { operationId: randomUUID(), toUserId: carol.user.id })).statusCode, 403)
})

test('退出保留席位和负积分，房主自动转交首个在房玩家，重进不重置账本', async t => {
  const { db, alice, bob, carol, create, join, leave, rooms, request } = await fixture(t)
  const room = await create()
  await join(bob, room)
  await join(carol, room)
  // 仅测试注入已有积分，计分接口在下一阶段实现。
  await db.query('UPDATE room_members SET score = -123 WHERE room_id = $1 AND user_id = $2', [room.roomId, alice.user.id])
  await leave(bob, room)
  const left = await request(alice, 'POST', `/api/v1/rooms/${room.roomId}/leave`, { operationId: randomUUID() })
  assert.equal(left.statusCode, 200, left.body)
  const snapshot = await rooms.get(carol.user.id, room.roomId)
  assert.equal(snapshot.ownerId, carol.user.id)
  assert.deepEqual(snapshot.players.map(player => [player.seat, player.isExited]), [[1, true], [2, true], [3, false]])
  assert.equal((await request(alice, 'GET', '/api/v1/users/me')).json().data.currentRoomId, null)
  await assert.rejects(rooms.get(alice.user.id, room.roomId), { code: 'ROOM_NOT_FOUND' })
  await join(alice, room)
  const returned = await rooms.get(alice.user.id, room.roomId)
  assert.equal(returned.players[0].score, -123)
  assert.equal(returned.players[0].seat, 1)
  assert.equal(returned.ownerId, carol.user.id)
  assert.equal(returned.players.length, 3)
})

test('最后退出删除房间及成员关联，不删用户/头像；旧create/join/leave重放不复活房间', async t => {
  const { db, alice, bob, rooms, create, request } = await fixture(t)
  const creation = { operationId: randomUUID(), roomName: '测试', mode: 'normal' }
  const room = await create(alice, creation)
  const joining = { operationId: randomUUID() }
  await rooms.joinById(bob.user.id, room.roomId, joining)
  const firstLeave = { operationId: randomUUID() }
  await rooms.leave(alice.user.id, room.roomId, firstLeave)
  const lastLeave = { operationId: randomUUID() }
  const deleted = await rooms.leave(bob.user.id, room.roomId, lastLeave)
  assert.equal(deleted.deleted, true)
  for (const table of ['rooms', 'room_members', 'active_room_memberships']) assert.equal((await db.query(`SELECT * FROM ${table}`)).rows.length, 0)
  assert.equal((await db.query('SELECT * FROM users')).rows.length, 3)
  assert.equal((await rooms.create(alice.user.id, creation)).duplicated, true)
  assert.equal((await rooms.joinById(bob.user.id, room.roomId, joining)).duplicated, true)
  assert.equal((await rooms.leave(bob.user.id, room.roomId, lastLeave)).duplicated, true)
  assert.equal((await db.query('SELECT * FROM rooms')).rows.length, 0)
  assert.equal((await request(alice, 'GET', '/api/v1/users/me/room')).json().data.room, null)
  assert.equal((await request(alice, 'GET', `/api/v1/rooms/${room.roomId}`)).statusCode, 404)
})

test('一次只能关联一个房间，八席含退出者，满员仍允许原玩家返回', async t => {
  const { alice, bob, carol, auth, create, rooms, join, leave, db } = await fixture(t)
  const first = await create()
  const second = await create(bob)
  await assert.rejects(create(alice), { code: 'ALREADY_IN_ROOM' })
  await assert.rejects(join(alice, second), { code: 'ALREADY_IN_ROOM' })
  await join(carol, first)
  for (let i = 0; i < 6; i++) await join(await auth.login(`extra-${i}`), first)
  await leave(carol, first)
  const ninth = await auth.login('ninth')
  await assert.rejects(join(ninth, first), { code: 'ROOM_FULL' })
  await join(carol, first)
  assert.equal((await rooms.get(alice.user.id, first.roomId)).players.length, 8)
  // 数据库也拒绝双重关联、重复座位和安全整数范围外的积分。
  await assert.rejects(db.query('INSERT INTO active_room_memberships(user_id, room_id) VALUES ($1, $2)', [alice.user.id, second.roomId]), { code: '23505' })
  await assert.rejects(db.query('UPDATE room_members SET seat = 1 WHERE room_id = $1 AND user_id = $2', [first.roomId, carol.user.id]), { code: '23505' })
  await assert.rejects(db.query('UPDATE room_members SET score = 9007199254740992 WHERE room_id = $1', [first.roomId]), { code: '23514' })
})

test('操作编号绑定调用者、动作和参数，重放旧join/leave/转交不改变较新的状态', async t => {
  const { alice, bob, carol, rooms, create, join, leave } = await fixture(t)
  const room = await create()
  const joining = { operationId: randomUUID() }
  const originalJoin = await rooms.joinById(bob.user.id, room.roomId, joining)
  assert.equal((await rooms.joinById(bob.user.id, room.roomId, joining)).duplicated, true)
  await leave(bob, room)
  assert.equal((await rooms.joinById(bob.user.id, room.roomId, joining)).stateVersion, originalJoin.stateVersion)
  assert.equal((await rooms.get(alice.user.id, room.roomId)).players[1].isExited, true)
  await assert.rejects(rooms.leave(bob.user.id, room.roomId, joining), { code: 'OPERATION_CONFLICT' })
  await join(bob, room)
  const exit = { operationId: randomUUID() }
  await rooms.leave(bob.user.id, room.roomId, exit)
  await join(bob, room)
  await rooms.leave(bob.user.id, room.roomId, exit)
  assert.equal((await rooms.get(bob.user.id, room.roomId)).players[1].isExited, false)
  await join(carol, room)
  const transfer = { operationId: randomUUID(), toUserId: bob.user.id }
  await rooms.transferOwner(alice.user.id, room.roomId, transfer)
  await rooms.transferOwner(bob.user.id, room.roomId, { operationId: randomUUID(), toUserId: carol.user.id })
  await rooms.transferOwner(alice.user.id, room.roomId, transfer)
  assert.equal((await rooms.get(alice.user.id, room.roomId)).ownerId, carol.user.id)
  await assert.rejects(rooms.transferOwner(alice.user.id, room.roomId, { ...transfer, toUserId: carol.user.id }), { code: 'OPERATION_CONFLICT' })
})

test('房间号碰撞有界重试；房号复用后旧UUID邀请不能误入新房间', async t => {
  const { db, config, alice, bob, carol, rooms, leave } = await fixture(t)
  const fixed = createRoomStore(db, config.wechat.appId, { makeCode: () => 'ABC123' })
  const first = await fixed.create(alice.user.id, { operationId: randomUUID(), roomName: '旧房间', mode: 'normal' })
  let attempts = 0
  const colliding = createRoomStore(db, config.wechat.appId, { makeCode: () => { attempts++; return 'ABC123' } })
  await assert.rejects(colliding.create(bob.user.id, { operationId: randomUUID(), roomName: '冲突', mode: 'normal' }), { code: 'ROOM_CODE_UNAVAILABLE' })
  assert.equal(attempts, 5)
  const retrying = createRoomStore(db, config.wechat.appId, { makeCode: () => attempts++ === 5 ? 'ABC123' : 'ABC124' })
  assert.equal((await retrying.create(bob.user.id, { operationId: randomUUID(), roomName: '重试成功', mode: 'normal' })).roomCode, 'ABC124')
  await leave(alice, first)
  const second = await fixed.create(carol.user.id, { operationId: randomUUID(), roomName: '新房间', mode: 'normal' })
  assert.notEqual(second.roomId, first.roomId)
  await assert.rejects(rooms.joinById(alice.user.id, first.roomId, { operationId: randomUUID() }), { code: 'ROOM_NOT_FOUND' })
})

test('资料与活动成员快照同事务更新、版本递增，退出者不能读取同房头像', async t => {
  const { alice, bob, carol, create, join, leave, rooms, profiles, request, db } = await fixture(t)
  const room = await create()
  await join(bob, room)
  const avatar = randomUUID()
  await profiles.replaceAvatar(alice.user.id, avatar)
  const renamed = await profiles.updateNickname(alice.user.id, '新名字')
  assert.equal(renamed.currentRoomId, room.roomId)
  const snapshot = await rooms.get(bob.user.id, room.roomId)
  assert.equal(snapshot.stateVersion, 4)
  assert.equal(snapshot.players[0].nickname, '新名字')
  assert.equal(snapshot.players[0].avatarFileId, avatar)
  await profiles.updateNickname(alice.user.id, '新名字')
  assert.equal((await rooms.get(bob.user.id, room.roomId)).stateVersion, 4)
  assert.equal((await request(bob, 'GET', `/api/v1/avatars/${avatar}`)).statusCode, 200)
  assert.equal((await request(carol, 'GET', `/api/v1/avatars/${avatar}`)).statusCode, 404)
  await leave(bob, room)
  assert.equal((await request(bob, 'GET', `/api/v1/avatars/${avatar}`)).statusCode, 404)
  await profiles.updateNickname(bob.user.id, '房外改名')
  assert.notEqual((await rooms.get(alice.user.id, room.roomId)).players[1].nickname, '房外改名')
  await join(bob, room)
  assert.equal((await rooms.get(alice.user.id, room.roomId)).players[1].nickname, '房外改名')
  await db.query('UPDATE rooms SET state_version = 9007199254740991 WHERE id = $1', [room.roomId])
  await assert.rejects(profiles.updateNickname(alice.user.id, '必须回滚'), { code: 'ROOM_VERSION_EXHAUSTED' })
  assert.equal((await request(alice, 'GET', '/api/v1/users/me')).json().data.nickname, '新名字')
  assert.equal((await rooms.get(bob.user.id, room.roomId)).players[0].nickname, '新名字')
})

test('缺失身份、伪造参数、非房主、退出/非成员目标及跨App访问均拒绝', async t => {
  const { db, app, alice, bob, carol, create, join, leave, rooms, request } = await fixture(t)
  const room = await create()
  await join(bob, room)
  assert.equal((await app.inject({ method: 'POST', url: '/api/v1/rooms', payload: {} })).statusCode, 401)
  for (const payload of [
    { operationId: 'short', roomName: '牌局', mode: 'normal' },
    { operationId: randomUUID(), roomName: ' ', mode: 'normal' },
    { operationId: randomUUID(), roomName: '牌局', mode: 'unknown' },
    { operationId: randomUUID(), roomName: '牌局', mode: 'normal', ownerId: carol.user.id },
    { operationId: randomUUID(), roomName: '牌局', mode: 'normal', initialScore: 100 }
  ]) assert.equal((await request(carol, 'POST', '/api/v1/rooms', payload)).statusCode, 400)
  assert.equal((await request(bob, 'POST', `/api/v1/rooms/${room.roomId}/owner`, { operationId: randomUUID(), toUserId: bob.user.id })).statusCode, 403)
  await assert.rejects(rooms.transferOwner(alice.user.id, room.roomId, { operationId: randomUUID(), toUserId: carol.user.id }), { code: 'ROOM_MEMBER_REQUIRED' })
  await leave(bob, room)
  await assert.rejects(rooms.transferOwner(alice.user.id, room.roomId, { operationId: randomUUID(), toUserId: bob.user.id }), { code: 'ROOM_MEMBER_REQUIRED' })
  await assert.rejects(rooms.leave(carol.user.id, room.roomId, { operationId: randomUUID() }), { code: 'ROOM_MEMBER_REQUIRED' })
  const otherApp = createRoomStore(db, 'wx0000000000000000')
  await assert.rejects(otherApp.joinById(alice.user.id, room.roomId, { operationId: randomUUID() }), { code: 'AUTH_REQUIRED' })
  await assert.rejects(otherApp.get(alice.user.id, room.roomId), { code: 'ROOM_NOT_FOUND' })
  await db.query("UPDATE rooms SET status = 'settled' WHERE id = $1", [room.roomId])
  await assert.rejects(join(carol, room), { code: 'ROOM_ENDED' })
  await assert.rejects(rooms.leave(alice.user.id, room.roomId, { operationId: randomUUID() }), { code: 'ROOM_ENDED' })
})

test('幂等回执写入失败时创建/加入/退出/房主变更一起回滚', async t => {
  const { db, config, alice, bob, rooms, create, join } = await fixture(t)
  const pool = { async connect() {
    const client = await db.connect()
    return { release: () => client.release(), query: (sql, params) => {
      if (sql.startsWith('INSERT INTO room_commands')) throw new Error('simulated receipt failure')
      return client.query(sql, params)
    } }
  } }
  const failing = createRoomStore(pool, config.wechat.appId)
  await assert.rejects(failing.create(alice.user.id, { operationId: randomUUID(), roomName: '回滚', mode: 'normal' }), /receipt failure/)
  assert.equal((await db.query('SELECT * FROM rooms')).rows.length, 0)
  const room = await create()
  await assert.rejects(failing.joinById(bob.user.id, room.roomId, { operationId: randomUUID() }), /receipt failure/)
  assert.equal((await rooms.get(alice.user.id, room.roomId)).players.length, 1)
  await join(bob, room)
  for (const execute of [
    () => failing.leave(alice.user.id, room.roomId, { operationId: randomUUID() }),
    () => failing.transferOwner(alice.user.id, room.roomId, { operationId: randomUUID(), toUserId: bob.user.id })
  ]) {
    await assert.rejects(execute(), /receipt failure/)
    const snapshot = await rooms.get(alice.user.id, room.roomId)
    assert.equal(snapshot.ownerId, alice.user.id)
    assert.equal(snapshot.stateVersion, 2)
    assert.ok(snapshot.players.every(player => !player.isExited))
  }
})

test('并发提交在单连接测试引擎串行落库：同请求只执行一次，不产生双重房间关联', async t => {
  const { alice, bob, rooms, create, db } = await fixture(t)
  const args = { operationId: randomUUID(), roomName: '重复创建', mode: 'normal' }
  const results = await Promise.all([rooms.create(alice.user.id, args), rooms.create(alice.user.id, args)])
  assert.equal(results[0].roomId, results[1].roomId)
  assert.deepEqual(results.map(item => item.duplicated), [false, true])
  const other = await create(bob)
  await assert.rejects(rooms.joinById(alice.user.id, other.roomId, { operationId: randomUUID() }), { code: 'ALREADY_IN_ROOM' })
  assert.equal((await db.query('SELECT * FROM active_room_memberships WHERE user_id = $1', [alice.user.id])).rows.length, 1)
})

test('明确回滚的竞争最多尝试三次，COMMIT结果未知不自动重放', async () => {
  let calls = 0
  const pool = { connect: async () => ({ query: async () => {}, release() {} }) }
  assert.equal(await roomTransaction(pool, async () => {
    if (++calls < 3) throw Object.assign(new Error('deadlock'), { code: '40P01' })
    return 'ok'
  }), 'ok')
  assert.equal(calls, 3)
  calls = 0
  await assert.rejects(roomTransaction(pool, async () => {
    calls++
    throw Object.assign(new Error('busy'), { code: '55P03' })
  }), { code: 'ROOM_BUSY' })
  assert.equal(calls, 3)
  calls = 0
  const uncertain = { connect: async () => ({ query: async sql => {
    if (sql === 'COMMIT') throw Object.assign(new Error('connection lost'), { code: 'ECONNRESET' })
  }, release() {} }) }
  await assert.rejects(roomTransaction(uncertain, async () => { calls++ }), { code: 'ECONNRESET' })
  assert.equal(calls, 1)
})

test('资料保存期间房间关联变化会重新读取，不能同步到错误房间', async t => {
  const { db, config, alice, bob, create, rooms } = await fixture(t)
  const room = await create()
  let lookups = 0
  const changing = { async connect() {
    const client = await db.connect()
    return { release: () => client.release(), query: async (sql, params) => {
      // 用同一事务内的状态变化模拟初读关联与拿到用户锁之间的竞争；不冒充真实连接并发测试。
      if (sql.startsWith('SELECT room_id FROM active_room_memberships') && ++lookups === 2) {
        await client.query(`INSERT INTO room_members(room_id,user_id,app_id,seat,nickname)
          VALUES ($1,$2,$3,2,'竞争加入')`, [room.roomId, bob.user.id, config.wechat.appId])
        await client.query('INSERT INTO active_room_memberships(user_id,room_id) VALUES ($1,$2)', [bob.user.id, room.roomId])
      }
      return client.query(sql, params)
    } }
  } }
  const result = await createProfileStore(changing, config.wechat.appId).updateNickname(bob.user.id, '最新资料')
  assert.equal(lookups, 4)
  assert.equal(result.currentRoomId, null)
  assert.equal(result.nickname, '最新资料')
  assert.equal((await rooms.get(alice.user.id, room.roomId)).players.length, 1)
})
