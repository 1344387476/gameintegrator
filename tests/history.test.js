const test = require('node:test')
const assert = require('node:assert/strict')
const { historyPlayer, normalizeDisplayText, normalizeIdentifier, assertSettleAllowed } = require('../cloudfunctions/roomFunctions/historyUtils')
const { buildSettlementPlan } = require('../miniprogram/utils/settlement')
const { limitDisplayText, safeInteger } = require('../miniprogram/utils/display')

test('历史玩家快照不保存临时头像 URL', () => {
  const player = historyPlayer({ openid: 'u1', nickname: 'A', avatar: 'https://temporary', avatarFileID: 'cloud://avatar', score: -3 })
  assert.deepEqual(player, { openid: 'u1', nickname: 'A', avatarFileID: 'cloud://avatar', score: -3, isExited: false })
})

test('动态展示字段会规范空白并限制字符数量', () => {
  assert.equal(normalizeDisplayText('  玩家   A  ', '昵称', 10), '玩家 A')
  assert.throws(() => normalizeDisplayText('12345678901', '昵称', 10), /不能超过10个字符/)
  assert.throws(() => normalizeIdentifier(`room\ninvalid`, '房间ID', 64), /无效/)
})

test('旧数据进入控件前会截断文本并过滤异常数字', () => {
  assert.equal(limitDisplayText(' 12345678901 ', 10, '玩家'), '1234567890')
  assert.equal(safeInteger(Number.MAX_SAFE_INTEGER), Number.MAX_SAFE_INTEGER)
  assert.equal(safeInteger(Infinity), 0)
})

test('云端拒绝对已结算房间再次生成战绩', () => {
  assert.doesNotThrow(() => assertSettleAllowed({ owner: 'u1', status: 'active', mode: 'normal', pot: 0 }, 'u1'))
  assert.throws(
    () => assertSettleAllowed({ owner: 'u1', status: 'settled', mode: 'normal', pot: 0 }, 'u1'),
    /已经结算/
  )
})

test('结算方案优先匹配同额输赢并按小额收款人排列', () => {
  const plan = buildSettlementPlan([
    { openid: 'a', name: 'A', score: -5 },
    { openid: 'b', name: 'B', score: -6 },
    { openid: 'c', name: 'C', score: 1 },
    { openid: 'd', name: 'D', score: 5 },
    { openid: 'e', name: 'E', score: 5 }
  ])

  assert.equal(plan.isBalanced, true)
  assert.deepEqual(plan.groups.map(group => ({
    payer: group.payer.nickname,
    transfers: group.transfers.map(item => `${item.receiver.nickname}:${item.amount}`)
  })), [
    { payer: 'A', transfers: ['D:5'] },
    { payer: 'B', transfers: ['C:1', 'E:5'] }
  ])
})

test('结算方案能识别积分合计不平', () => {
  const plan = buildSettlementPlan([
    { openid: 'a', name: 'A', score: -8 },
    { openid: 'b', name: 'B', score: 5 }
  ])
  assert.equal(plan.isBalanced, false)
  assert.equal(plan.difference, 3)
})

test('八人结算最多生成七笔转账且金额守恒', () => {
  const plan = buildSettlementPlan([
    { openid: 'a', score: -1 },
    { openid: 'b', score: -1 },
    { openid: 'c', score: -1 },
    { openid: 'd', score: -7 },
    { openid: 'e', score: 2 },
    { openid: 'f', score: 2 },
    { openid: 'g', score: 2 },
    { openid: 'h', score: 4 }
  ])
  const transfers = plan.groups.flatMap(group => group.transfers)
  assert.equal(plan.isBalanced, true)
  assert.ok(transfers.length <= 7)
  assert.equal(transfers.reduce((sum, item) => sum + item.amount, 0), 10)
})

test('全员零积分时返回明确的无需转账状态', () => {
  const plan = buildSettlementPlan([
    { openid: 'a', name: 'A', score: 0 },
    { openid: 'b', name: 'B', score: 0 }
  ])
  assert.equal(plan.isBalanced, true)
  assert.equal(plan.hasTransfers, false)
  assert.deepEqual(plan.groups, [])
})
