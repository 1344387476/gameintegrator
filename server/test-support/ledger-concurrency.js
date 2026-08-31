const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const { setupLedger } = require('./ledger')
const { createHistoryStore } = require('../src/history-store')

async function allSuccessful(promises) {
  const results = await Promise.allSettled(promises)
  assert.ok(results.every(result => result.status === 'fulfilled'), JSON.stringify(results.map(result => result.reason?.code || result.status)))
  return results.map(result => result.value)
}

async function exerciseLedgerConcurrency(db) {
  const normal = await setupLedger(db)
  const { alice, bob, room, score, snapshot, rooms, profiles, scores } = normal
  await allSuccessful(Array.from({ length: 40 }, (_, index) => score(index % 2 ? bob : alice, 'TRANSFER', {
    toUserId: (index % 2 ? alice : bob).user.id, amount: 1
  })))
  assert.deepEqual((await snapshot()).players.map(player => player.score), [0, 0, 0])
  const operationId = randomUUID()
  const duplicates = await allSuccessful(Array.from({ length: 12 }, () => score(alice, 'TRANSFER', { toUserId: bob.user.id, amount: 9 }, operationId)))
  assert.equal(duplicates.filter(result => !result.duplicated).length, 1)
  assert.equal(new Set(duplicates.map(result => result.ledgerEntryId)).size, 1)
  assert.deepEqual((await snapshot()).players.map(player => player.score), [-9, 9, 0])

  const competing = await Promise.allSettled([
    score(alice, 'TRANSFER', { toUserId: bob.user.id, amount: 5 }),
    rooms.leave(bob.user.id, room.roomId, { operationId: randomUUID() }),
    profiles.updateNickname(alice.user.id, '并发资料')
  ])
  assert.equal(competing[1].status, 'fulfilled')
  assert.equal(competing[2].status, 'fulfilled')
  if (competing[0].status === 'rejected') assert.equal(competing[0].reason.code, 'INVALID_RECIPIENT')
  const current = await snapshot()
  assert.equal(current.players[1].isExited, true)
  assert.equal(current.players[1].score, competing[0].status === 'fulfilled' ? 14 : 9)
  assert.equal(current.players[0].nickname, '并发资料')
  assert.equal(current.players.reduce((sum, player) => sum + player.score, current.pot), 0)
  assert.equal((await score(alice, 'TRANSFER', { toUserId: bob.user.id, amount: 9 }, operationId)).duplicated, true)
  assert.equal((await scores.list(alice.user.id, room.roomId, { limit: 50 })).items.length, competing[0].status === 'fulfilled' ? 42 : 41)

  const bet = await setupLedger(db, 'bet')
  const bettors = [bet.alice, bet.bob, bet.carol]
  await allSuccessful(Array.from({ length: 30 }, (_, i) => bet.score(bettors[i % 3], 'BET', { amount: 2 })))
  assert.equal((await bet.snapshot()).pot, 60)
  const claims = await Promise.allSettled([bet.score(bet.bob, 'CLAIM'), bet.score(bet.carol, 'CLAIM')])
  assert.equal(claims.filter(result => result.status === 'fulfilled').length, 1)
  assert.equal(claims.find(result => result.status === 'rejected').reason.code, 'EMPTY_POT')
  const winner = claims[0].status === 'fulfilled' ? bet.bob : bet.carol
  const allinId = randomUUID()
  const allins = await allSuccessful(Array.from({ length: 8 }, () => bet.score(winner, 'ALLIN', {}, allinId)))
  assert.equal(allins.filter(result => !result.duplicated).length, 1)
  const final = await bet.snapshot()
  assert.equal(final.pot, 40)
  assert.equal(final.players.find(player => player.userId === winner.user.id).score, 0)
  assert.equal(final.players.reduce((sum, player) => sum + player.score, final.pot), 0)

  // 从零重放审计流水，应与权威快照一致，每条变更的before必须接上上一条after。
  const entries = (await bet.scores.list(bet.alice.user.id, bet.room.roomId, { limit: 50 })).items.reverse()
  const replay = new Map(bettors.map(user => [user.user.id, 0]))
  let pot = 0
  for (const entry of entries) {
    assert.equal(entry.potBefore, pot)
    for (const change of entry.changes) {
      assert.equal(change.scoreBefore, replay.get(change.userId))
      replay.set(change.userId, change.scoreAfter)
    }
    pot = entry.potAfter
    assert.equal([...replay.values()].reduce((sum, value) => sum + value, pot), 0)
  }
  assert.equal(pot, final.pot)
  for (const player of final.players) assert.equal(replay.get(player.userId), player.score)

  // 结算与计分竞争只允许一个先后顺序；重复结算不能生成多份战绩。
  const finish = await setupLedger(db)
  await finish.score(finish.alice, 'TRANSFER', { toUserId: finish.bob.user.id, amount: 10 })
  const settlementId = randomUUID()
  const finishing = await Promise.allSettled([
    finish.score(finish.bob, 'TRANSFER', { toUserId: finish.alice.user.id, amount: 4 }),
    ...Array.from({ length: 8 }, () => finish.rooms.settle(finish.alice.user.id, finish.room.roomId, { operationId: settlementId }))
  ])
  for (const result of finishing.slice(1)) assert.equal(result.status, 'fulfilled')
  assert.equal(finishing.slice(1).filter(result => !result.value.duplicated).length, 1)
  assert.equal(new Set(finishing.slice(1).map(result => result.value.historyId)).size, 1)
  const history = await createHistoryStore(db, finish.config.wechat.appId).get(finish.alice.user.id, finishing[1].value.historyId)
  if (finishing[0].status === 'rejected') assert.equal(finishing[0].reason.code, 'ROOM_ENDED')
  assert.deepEqual(history.players.map(p => p.score), finishing[0].status === 'fulfilled' ? [-6, 6, 0] : [-10, 10, 0])
  for (const user of [finish.alice, finish.bob, finish.carol]) assert.equal(await finish.rooms.current(user.user.id), null)

  const ending = await setupLedger(db)
  const conflict = await Promise.allSettled([
    ending.rooms.settle(ending.alice.user.id, ending.room.roomId, { operationId: randomUUID() }),
    ending.rooms.dismiss(ending.alice.user.id, ending.room.roomId, { operationId: randomUUID() })
  ])
  assert.equal(conflict.filter(result => result.status === 'fulfilled').length, 1)
  assert.ok(['ROOM_ENDED', 'ROOM_NOT_FOUND'].includes(conflict.find(result => result.status === 'rejected').reason.code))
  const count = (await db.query('SELECT id FROM histories WHERE room_id=$1', [ending.room.roomId])).rows.length
  assert.equal(count, conflict[0].status === 'fulfilled' ? 1 : 0)
}

module.exports = { exerciseLedgerConcurrency }
