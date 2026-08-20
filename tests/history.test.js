const test = require('node:test')
const assert = require('node:assert/strict')
const { messageAmount, buildBetSummary, historyPlayer } = require('../cloudfunctions/roomFunctions/historyUtils')

test('优先使用结构化金额并兼容旧消息文本', () => {
  assert.equal(messageAmount({ amount: 18, content: '下注 99 分' }), 18)
  assert.equal(messageAmount({ content: '收走了奖池 42 分' }), 42)
  assert.equal(messageAmount({ content: '无金额' }), 0)
})

test('下注摘要只累计下注、All-in 和领取', () => {
  const summary = buildBetSummary([
    { messageType: 'bet', amount: 10 },
    { messageType: 'allin', amount: 30 },
    { messageType: 'transfer', amount: 99 },
    { messageType: 'claim', amount: 40, operationId: 'claim-001', fromOpenid: 'u1', fromNickname: '玩家A' }
  ])
  assert.equal(summary.totalBet, 40)
  assert.equal(summary.totalClaimed, 40)
  assert.deepEqual(summary.claimEvents[0], { operationId: 'claim-001', openid: 'u1', nickname: '玩家A', amount: 40, timestamp: null })
})

test('历史玩家快照不保存临时头像 URL', () => {
  const player = historyPlayer({ openid: 'u1', nickname: 'A', avatar: 'https://temporary', avatarFileID: 'cloud://avatar', score: -3 })
  assert.deepEqual(player, { openid: 'u1', nickname: 'A', avatarFileID: 'cloud://avatar', score: -3, isExited: false })
})
