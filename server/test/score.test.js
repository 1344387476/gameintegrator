const test = require('node:test')
const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const { createTestDatabase } = require('../test-support/database')
const { setupLedger } = require('../test-support/ledger')
const { readMigrations, migrate } = require('../src/migrations')
const { createScoreStore } = require('../src/score-store')
const { createProfile } = require('../src/profile')
const { buildApp } = require('../src/app')
const { exerciseLedgerConcurrency } = require('../test-support/ledger-concurrency')

async function fixture(t, mode) {
  const db = await createTestDatabase()
  t.after(() => db.end())
  await migrate(db, await readMigrations())
  const f = await setupLedger(db, mode)
  const profile = createProfile({ store: f.profiles, storage: { read: async () => Buffer.from('avatar') } })
  const app = await buildApp({ config: f.config, auth: f.auth, rooms: f.rooms, scores: f.scores, profile, checkReady: async () => {}, logger: false })
  t.after(() => app.close())
  const request = (user, action, payload = {}, operationId = randomUUID()) => app.inject({ method: 'POST', url: `/api/v1/rooms/${f.room.roomId}/score`,
    headers: { authorization: `Bearer ${user.token}` }, payload: { action, operationId, payload } })
  return { ...f, app, request }
}
const balance = room => room.players.reduce((sum, player) => sum + BigInt(player.score), BigInt(room.pot))
const scoresOf = room => room.players.map(player => player.score)

test('HTTP单笔/批量转分允许负分，流水保存可信快照且不改变输入', async t => {
  const f = await fixture(t)
  const { alice, bob, carol, request, profiles, snapshot, scores, room } = f
  await profiles.updateNickname(alice.user.id, '当时昵称')
  assert.equal((await request(alice, 'TRANSFER', { toUserId: bob.user.id, amount: 5 })).statusCode, 200)
  const payload = { transferList: [{ toUserId: alice.user.id, amount: 2 }, { toUserId: bob.user.id, amount: 3 }] }
  const original = JSON.stringify(payload)
  assert.equal((await request(carol, 'BATCH_TRANSFER', payload)).statusCode, 200)
  assert.equal(JSON.stringify(payload), original)
  const current = await snapshot()
  assert.deepEqual(scoresOf(current), [-3, 8, -5])
  assert.equal(balance(current), 0n)
  await profiles.updateNickname(alice.user.id, '现在昵称')
  const page = await scores.list(alice.user.id, room.roomId)
  assert.equal(page.items.length, 2)
  assert.equal(page.items[1].actor.nickname, '当时昵称')
  assert.equal(page.items[1].changes.length, 2)
  assert.equal(page.items[0].changes.length, 3)
  for (const entry of page.items) {
    assert.equal(entry.changes.reduce((sum, c) => sum + BigInt(c.scoreAfter) - BigInt(c.scoreBefore), BigInt(entry.potAfter) - BigInt(entry.potBefore)), 0n)
    assert.equal(entry.actor.openid, undefined)
  }
})

test('下注、服务端底注、非房主领奖池和All-in使用事务内当前数值', async t => {
  const { alice, bob, carol, score, snapshot, scores, room } = await fixture(t, 'bet')
  await assert.rejects(score(alice, 'TRANSFER', { toUserId: bob.user.id, amount: 1 }), { code: 'WRONG_ROOM_MODE' })
  await assert.rejects(score(alice, 'BATCH_TRANSFER', { transferList: [{ toUserId: bob.user.id, amount: 1 }] }), { code: 'WRONG_ROOM_MODE' })
  await assert.rejects(score(bob, 'SET_BASE_BET', { amount: 10 }), { code: 'ROOM_OWNER_REQUIRED' })
  await assert.rejects(score(bob, 'BASE_BET'), { code: 'BASE_BET_NOT_SET' })
  await assert.rejects(score(alice, 'ALLIN'), { code: 'ALLIN_NOT_AVAILABLE' })
  await score(alice, 'SET_BASE_BET', { amount: 10 })
  await score(bob, 'BASE_BET')
  await assert.rejects(score(bob, 'ALLIN'), { code: 'ALLIN_NOT_AVAILABLE' })
  await score(carol, 'BET', { amount: 4 })
  assert.equal((await snapshot()).pot, 14)
  await score(bob, 'CLAIM')
  assert.equal((await snapshot()).players[1].score, 4)
  const operationId = randomUUID()
  await score(bob, 'ALLIN', {}, operationId)
  assert.equal((await score(bob, 'ALLIN', {}, operationId)).duplicated, true)
  const after = await snapshot()
  assert.equal(after.pot, 4)
  assert.equal(after.players[1].lastDepositAmount, 4)
  assert.ok(after.players[1].lastDepositAt)
  await score(carol, 'CLAIM')
  assert.deepEqual(scoresOf(await snapshot()), [0, 0, 0])
  await assert.rejects(score(alice, 'CLAIM'), { code: 'EMPTY_POT' })
  const page = await scores.list(alice.user.id, room.roomId)
  assert.equal(page.items.find(entry => entry.action === 'ALLIN').amount, 4)
  assert.equal(page.items.find(entry => entry.action === 'BASE_BET').amount, 10)
  assert.equal(page.items.at(-1).changes.length, 0)
})

test('金额、模式和参数白名单严格校验，批量失败不产生部分转分', async t => {
  const { alice, bob, carol, outsider, room, rooms, request, snapshot, score, db } = await fixture(t)
  for (const amount of [0, -1, 1.5, '10', null, Number.MAX_SAFE_INTEGER + 1]) assert.equal((await request(alice, 'TRANSFER', { toUserId: bob.user.id, amount })).statusCode, 400)
  for (const [action, payload] of [
    ['TRANSFER', { toUserId: alice.user.id, amount: 1 }],
    ['TRANSFER', { toUserId: outsider.user.id, amount: 1 }],
    ['TRANSFER', { toUserId: bob.user.id, amount: 1, nickname: '伪造' }],
    ['BATCH_TRANSFER', { transferList: [] }],
    ['BATCH_TRANSFER', { transferList: [{ toUserId: bob.user.id, amount: 1 }, { toUserId: bob.user.id, amount: 2 }] }],
    ['BATCH_TRANSFER', { transferList: Array.from({ length: 8 }, () => ({ toUserId: randomUUID(), amount: 1 })) }],
    ['BATCH_TRANSFER', { transferList: [{ toUserId: bob.user.id, amount: Number.MAX_SAFE_INTEGER }, { toUserId: carol.user.id, amount: 1 }] }],
    ['BASE_BET', { amount: 1 }], ['ALLIN', { amount: 10 }], ['CLAIM', { amount: 10 }],
    ['HACK', {}]
  ]) assert.equal((await request(alice, action, payload)).statusCode, 400)
  for (const action of ['BET', 'BASE_BET', 'ALLIN', 'CLAIM', 'SET_BASE_BET']) await assert.rejects(score(alice, action, ['BET', 'SET_BASE_BET'].includes(action) ? { amount: 1 } : {}), { code: 'WRONG_ROOM_MODE' })
  await rooms.leave(carol.user.id, room.roomId, { operationId: randomUUID() })
  await assert.rejects(score(alice, 'BATCH_TRANSFER', { transferList: [{ toUserId: bob.user.id, amount: 1 }, { toUserId: carol.user.id, amount: 1 }] }), { code: 'INVALID_RECIPIENT' })
  assert.deepEqual(scoresOf(await snapshot()), [0, 0, 0])
  assert.equal((await db.query('SELECT * FROM score_ledger')).rows.length, 0)
})

test('安全整数边界精确处理，接收者/发送者/奖池溢出和不平账全部回滚', async t => {
  const f = await fixture(t)
  const { db, alice, bob, carol, room, score, snapshot } = f
  const max = Number.MAX_SAFE_INTEGER
  await db.query('UPDATE room_members SET score = CASE WHEN user_id=$2 THEN $4::bigint WHEN user_id=$3 THEN -$4::bigint ELSE 0 END WHERE room_id=$1', [room.roomId, alice.user.id, bob.user.id, String(max)])
  await assert.rejects(score(carol, 'TRANSFER', { toUserId: alice.user.id, amount: 1 }), { code: 'SCORE_OVERFLOW' })
  await assert.rejects(score(bob, 'TRANSFER', { toUserId: carol.user.id, amount: 1 }), { code: 'SCORE_OVERFLOW' })
  assert.deepEqual(scoresOf(await snapshot()), [max, -max, 0])
  await score(alice, 'TRANSFER', { toUserId: bob.user.id, amount: max })
  assert.deepEqual(scoresOf(await snapshot()), [0, 0, 0])
  await db.query('UPDATE room_members SET score = 1 WHERE room_id=$1 AND user_id=$2', [room.roomId, alice.user.id])
  await assert.rejects(score(alice, 'TRANSFER', { toUserId: bob.user.id, amount: 1 }), { code: 'LEDGER_UNBALANCED' })
  const bet = await setupLedger(db, 'bet')
  await db.query('UPDATE rooms SET pot=$2 WHERE id=$1', [bet.room.roomId, String(max)])
  await db.query('UPDATE room_members SET score=$3 WHERE room_id=$1 AND user_id=$2', [bet.room.roomId, bet.bob.user.id, String(-max)])
  await assert.rejects(bet.score(bet.alice, 'BET', { amount: 1 }), { code: 'SCORE_OVERFLOW' })
  assert.equal((await bet.snapshot()).pot, max)
  await db.query('UPDATE room_members SET score=CASE WHEN user_id=$2 THEN 1 ELSE score END WHERE room_id=$1', [bet.room.roomId, bet.alice.user.id])
  await db.query('UPDATE room_members SET score=-1 WHERE room_id=$1 AND user_id=$2', [bet.room.roomId, bet.carol.user.id])
  await assert.rejects(bet.score(bet.alice, 'CLAIM'), { code: 'SCORE_OVERFLOW' })
  assert.equal((await bet.snapshot()).pot, max)
})

test('超过100笔仍能分页和去重，批量顺序不影响摘要，同编号不同参数/动作/房间拒绝', async t => {
  const { db, config, alice, bob, carol, room, score, scores, rooms, snapshot } = await fixture(t)
  const first = randomUUID()
  for (let i = 0; i < 110; i++) await score(alice, 'TRANSFER', { toUserId: bob.user.id, amount: 1 }, i === 0 ? first : randomUUID())
  const restarted = createScoreStore(db, config.wechat.appId)
  assert.equal((await restarted.execute(alice.user.id, room.roomId, { operationId: first, action: 'TRANSFER', payload: { toUserId: bob.user.id, amount: 1 } })).duplicated, true)
  assert.equal((await snapshot()).players[0].score, -110)
  await assert.rejects(score(alice, 'TRANSFER', { toUserId: bob.user.id, amount: 2 }, first), { code: 'OPERATION_CONFLICT' })
  await assert.rejects(rooms.leave(alice.user.id, room.roomId, { operationId: first }), { code: 'OPERATION_CONFLICT' })
  await assert.rejects(restarted.execute(alice.user.id, randomUUID(), { operationId: first, action: 'TRANSFER', payload: { toUserId: bob.user.id, amount: 1 } }), { code: 'OPERATION_CONFLICT' })
  const batch = randomUUID()
  const list = [{ toUserId: bob.user.id, amount: 2 }, { toUserId: carol.user.id, amount: 3 }]
  await score(alice, 'BATCH_TRANSFER', { transferList: list }, batch)
  assert.equal((await score(alice, 'BATCH_TRANSFER', { transferList: [...list].reverse() }, batch)).duplicated, true)
  let beforeVersion = null
  const all = []
  do {
    const page = await scores.list(alice.user.id, room.roomId, { limit: 17, beforeVersion })
    all.push(...page.items)
    beforeVersion = page.nextBeforeVersion
  } while (beforeVersion)
  assert.equal(all.length, 111)
  assert.equal(new Set(all.map(entry => entry.id)).size, 111)
  assert.ok(all.every((entry, index) => !index || entry.stateVersion < all[index - 1].stateVersion))
})

test('积分、奖池、版本、流水明细和幂等回执任一步失败均整体回滚', async t => {
  const { db, config, alice, bob, room, snapshot } = await fixture(t)
  for (const failure of ['UPDATE room_members SET score', 'UPDATE rooms SET pot', 'UPDATE rooms SET state_version', 'INSERT INTO score_ledger(', 'INSERT INTO score_ledger_changes', 'INSERT INTO room_commands']) {
    const pool = { connect: async () => {
      const client = await db.connect()
      return { release: flag => client.release(flag), query: (sql, values) => {
        if (sql.startsWith(failure)) throw new Error('injected failure')
        return client.query(sql, values)
      } }
    } }
    await assert.rejects(createScoreStore(pool, config.wechat.appId).execute(alice.user.id, room.roomId,
      { operationId: randomUUID(), action: 'TRANSFER', payload: { toUserId: bob.user.id, amount: 2 } }), /injected failure/)
    const current = await snapshot()
    assert.deepEqual(scoresOf(current), [0, 0, 0])
    assert.equal(current.stateVersion, 3)
    assert.equal((await db.query('SELECT * FROM score_ledger')).rows.length, 0)
    assert.equal((await db.query('SELECT * FROM score_ledger_changes')).rows.length, 0)
    assert.equal((await db.query('SELECT * FROM room_commands')).rows.length, 3)
  }
})

test('COMMIT已成功但响应丢失，使用同编号重试只返回原回执', async t => {
  const { db, config, alice, bob, room, scores, snapshot } = await fixture(t)
  const pool = { connect: async () => {
    const client = await db.connect()
    return { release: flag => client.release(flag), query: async (sql, values) => {
      const result = await client.query(sql, values)
      if (sql === 'COMMIT') throw Object.assign(new Error('response lost'), { code: 'ECONNRESET' })
      return result
    } }
  } }
  const input = { operationId: randomUUID(), action: 'TRANSFER', payload: { toUserId: bob.user.id, amount: 7 } }
  await assert.rejects(createScoreStore(pool, config.wechat.appId).execute(alice.user.id, room.roomId, input), { code: 'ECONNRESET' })
  assert.equal((await scores.execute(alice.user.id, room.roomId, input)).duplicated, true)
  assert.deepEqual(scoresOf(await snapshot()), [-7, 7, 0])
  assert.equal((await db.query('SELECT * FROM score_ledger')).rows.length, 1)
})

test('退出/非成员/跨App不能新计分或读流水，结束房间不能计分', async t => {
  const { db, app, alice, bob, outsider, room, rooms, score, scores, request } = await fixture(t)
  const url = `/api/v1/rooms/${room.roomId}/score`
  assert.equal((await app.inject({ method: 'POST', url, payload: {} })).statusCode, 401)
  assert.equal((await request(outsider, 'TRANSFER', { toUserId: bob.user.id, amount: 1 })).statusCode, 403)
  await assert.rejects(createScoreStore(db, 'wx0000000000000000').execute(alice.user.id, room.roomId,
    { action: 'TRANSFER', operationId: randomUUID(), payload: { toUserId: bob.user.id, amount: 1 } }), { code: 'AUTH_REQUIRED' })
  await score(alice, 'TRANSFER', { toUserId: bob.user.id, amount: 1 })
  await rooms.leave(bob.user.id, room.roomId, { operationId: randomUUID() })
  await assert.rejects(score(bob, 'TRANSFER', { toUserId: alice.user.id, amount: 1 }), { code: 'ROOM_MEMBER_REQUIRED' })
  for (const user of [bob, outsider]) await assert.rejects(scores.list(user.user.id, room.roomId), { code: 'ROOM_NOT_FOUND' })
  assert.equal((await scores.list(alice.user.id, room.roomId)).items.length, 1)
  await db.query("UPDATE rooms SET status='settled' WHERE id=$1", [room.roomId])
  await assert.rejects(score(alice, 'TRANSFER', { toUserId: bob.user.id, amount: 1 }), { code: 'ROOM_ENDED' })
  await assert.rejects(scores.list(alice.user.id, room.roomId), { code: 'ROOM_NOT_FOUND' })
})

test('流水头像按当前房间鉴权，分页参数不能扩大查询，版本耗尽不留半笔账', async t => {
  const { db, app, alice, bob, carol, outsider, room, profiles, rooms, score, snapshot } = await fixture(t)
  const avatar = randomUUID()
  const recipientAvatar = randomUUID()
  await profiles.replaceAvatar(alice.user.id, avatar)
  await profiles.replaceAvatar(bob.user.id, recipientAvatar)
  await score(alice, 'TRANSFER', { toUserId: bob.user.id, amount: 2 })
  await profiles.replaceAvatar(alice.user.id, randomUUID())
  await profiles.replaceAvatar(bob.user.id, randomUUID())
  const get = (user, url) => app.inject({ url, headers: { authorization: `Bearer ${user.token}` } })
  assert.equal((await get(bob, `/api/v1/avatars/${avatar}`)).statusCode, 200)
  assert.equal((await get(carol, `/api/v1/avatars/${recipientAvatar}`)).statusCode, 200)
  assert.equal((await get(outsider, `/api/v1/avatars/${avatar}`)).statusCode, 404)
  const page = await get(alice, `/api/v1/rooms/${room.roomId}/ledger?limit=1`)
  assert.equal(page.statusCode, 200)
  assert.equal(page.json().data.items[0].amount, 2)
  for (const query of ['limit=51', 'limit=0', 'beforeVersion=0', 'beforeVersion=9007199254740992', 'openid=fake']) {
    assert.equal((await get(alice, `/api/v1/rooms/${room.roomId}/ledger?${query}`)).statusCode, 400)
  }
  await rooms.leave(bob.user.id, room.roomId, { operationId: randomUUID() })
  assert.equal((await get(bob, `/api/v1/avatars/${avatar}`)).statusCode, 404)
  await db.query('UPDATE rooms SET state_version=9007199254740991 WHERE id=$1', [room.roomId])
  await assert.rejects(score(alice, 'TRANSFER', { toUserId: carol.user.id, amount: 1 }), { code: 'ROOM_VERSION_EXHAUSTED' })
  assert.deepEqual(scoresOf(await snapshot()), [-2, 2, 0])
  assert.equal((await db.query('SELECT * FROM score_ledger')).rows.length, 1)
})

test('最后退出清理本房间流水，保留幂等回执，重放不能复活或重复计分', async t => {
  const { db, alice, bob, carol, room, rooms, score, scores } = await fixture(t, 'bet')
  const operationId = randomUUID()
  await score(alice, 'BET', { amount: 3 }, operationId)
  for (const user of [alice, bob, carol]) await rooms.leave(user.user.id, room.roomId, { operationId: randomUUID() })
  assert.equal((await db.query('SELECT * FROM score_ledger')).rows.length, 0)
  assert.equal((await db.query('SELECT * FROM score_ledger_changes')).rows.length, 0)
  assert.equal((await score(alice, 'BET', { amount: 3 }, operationId)).duplicated, true)
  await assert.rejects(score(alice, 'BET', { amount: 3 }), { code: 'ROOM_NOT_FOUND' })
  await assert.rejects(scores.list(alice.user.id, room.roomId), { code: 'ROOM_NOT_FOUND' })
  assert.equal((await db.query('SELECT * FROM rooms')).rows.length, 0)
})

test('竞争场景在PGlite排队执行：对转、重复请求、退出竞争、抢奖池和All-in', async t => {
  const db = await createTestDatabase()
  t.after(() => db.end())
  await migrate(db, await readMigrations())
  await exerciseLedgerConcurrency(db)
})
