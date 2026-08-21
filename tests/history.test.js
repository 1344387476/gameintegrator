const test = require('node:test')
const assert = require('node:assert/strict')
const {
  historyPlayer,
  normalizeDisplayText,
  normalizeIdentifier,
  assertSettleAllowed,
  buildSettledRoomState,
  assertQRCodeAllowed,
  buildLeaveState
} = require('../cloudfunctions/roomFunctions/historyUtils')
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

test('结算状态会清空二维码引用并返回待删除的云文件 ID', () => {
  const state = buildSettledRoomState({ qrCode: 'cloud://env/room-qrcodes/ABC123.png' })

  assert.deepEqual(state.roomUpdate, { status: 'settled', qrCode: null })
  assert.equal(state.qrCodeFileID, 'cloud://env/room-qrcodes/ABC123.png')
})

test('只有活跃房间中的在线成员可以按需生成二维码', () => {
  const activeRoom = { status: 'active', players: [{ openid: 'u1', isExited: false }] }

  assert.doesNotThrow(() => assertQRCodeAllowed(activeRoom, 'u1'))
  assert.throws(() => assertQRCodeAllowed(activeRoom, 'u2'), /不在该房间/)
  assert.throws(() => assertQRCodeAllowed({ ...activeRoom, status: 'settled' }, 'u1'), /已经结束/)
})

test('玩家退出后保留积分账本并标记离线', () => {
  const room = {
    owner: 'u1',
    status: 'active',
    players: [
      { openid: 'u1', nickname: 'A', score: 12, isExited: false },
      { openid: 'u2', nickname: 'B', score: -12, isExited: false }
    ]
  }
  const result = buildLeaveState(room, 'u2')
  assert.equal(result.roomDeleted, false)
  assert.equal(result.owner, 'u1')
  assert.deepEqual(result.players.map(player => ({ openid: player.openid, score: player.score, isExited: player.isExited })), [
    { openid: 'u1', score: 12, isExited: false },
    { openid: 'u2', score: -12, isExited: true }
  ])
  assert.deepEqual(result.players.map(historyPlayer).map(player => player.score), [12, -12])
})

test('房主退出后转交给首位在线玩家，离线玩家仍留在房间', () => {
  const result = buildLeaveState({
    owner: 'owner',
    status: 'active',
    players: [
      { openid: 'owner', score: 5, isExited: false },
      { openid: 'old', score: -2, isExited: true },
      { openid: 'next', score: -3, isExited: false }
    ]
  }, 'owner')
  assert.equal(result.roomDeleted, false)
  assert.equal(result.owner, 'next')
  assert.equal(result.players.length, 3)
  assert.equal(result.players[0].isExited, true)
})

test('最后一位在线玩家退出时房间按原规则销毁', () => {
  const result = buildLeaveState({
    owner: 'u1',
    status: 'active',
    players: [
      { openid: 'u1', score: 3, isExited: false },
      { openid: 'u2', score: -3, isExited: true }
    ]
  }, 'u1')
  assert.equal(result.roomDeleted, true)
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
