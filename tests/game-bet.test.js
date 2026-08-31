const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { _test } = require('../cloudfunctions/gameLogic')

function createBetRoom(overrides = {}) {
  return {
    mode: 'bet',
    status: 'active',
    pot: 20,
    baseBetVal: 10,
    players: [
      { openid: 'me', nickname: '玩家一', score: 35, isExited: false }
    ],
    ...overrides
  }
}

test('All-in 由云端使用玩家当前全部正积分且归零', () => {
  const result = _test.prepareOperation({
    action: 'ALLIN',
    payload: { amount: 1 },
    room: createBetRoom(),
    openid: 'me',
    operationId: 'operation-allin-123'
  })

  assert.equal(result.updates.players[0].score, 0)
  assert.equal(result.updates.pot, 55)
  assert.equal(result.messages[0].amount, 35)
  assert.match(result.messages[0].content, /All-in 35 分/)
})

test('零分和负分玩家不能 All-in', () => {
  for (const score of [0, -10]) {
    assert.throws(() => _test.prepareOperation({
      action: 'ALLIN',
      payload: {},
      room: createBetRoom({ players: [{ openid: 'me', score, isExited: false }] }),
      openid: 'me',
      operationId: `operation-allin-${score}`
    }), /当前积分必须大于 0/)
  }
})

test('底注由云端房间设置决定并兼容旧 All-in 设置', () => {
  const current = _test.prepareOperation({
    action: 'BASE_BET',
    payload: { amount: 999 },
    room: createBetRoom(),
    openid: 'me',
    operationId: 'operation-basebet-current'
  })
  assert.equal(current.messages[0].amount, 10)
  assert.equal(current.updates.players[0].score, 25)

  const legacy = _test.prepareOperation({
    action: 'BASE_BET',
    payload: {},
    room: createBetRoom({ baseBetVal: undefined, allInVal: 8 }),
    openid: 'me',
    operationId: 'operation-basebet-legacy'
  })
  assert.equal(legacy.messages[0].amount, 8)
  assert.match(legacy.messages[0].content, /底注 8 分/)
})

function loadBetPage() {
  let pageDefinition
  let cloudRequest
  global.getApp = () => ({ globalData: { appearanceTheme: 'light' } })
  global.wx = {
    getDeviceInfo: () => ({ benchmarkLevel: 20 }),
    cloud: {
      callFunction(options) {
        cloudRequest = options
        options.success({ result: { success: true, latestMessages: [{ amount: 35 }] } })
        options.complete()
      }
    },
    showToast() {}
  }
  global.Page = definition => { pageDefinition = definition }
  const backendPath = require.resolve('../miniprogram/utils/backend')
  require.cache[backendPath] = { exports: { callFunction: options => global.wx.cloud.callFunction(options) } }
  const modulePath = require.resolve('../miniprogram/pages/room/room')
  delete require.cache[modulePath]
  require(modulePath)

  const page = {
    ...pageDefinition,
    data: {
      ...pageDefinition.data,
      roomId: 'ABC123',
      myOpenid: 'me',
      myScore: 35,
      room: {
        status: 'playing',
        gameMode: 'bet',
        baseBetValue: 10,
        members: [{ openid: 'me', score: 35 }]
      }
    },
    setData(update) { Object.assign(this.data, update) },
    createGameOperationId: () => 'operation-client-123',
    triggerDepositAnimation() {},
    scheduleRealtimeFallback() {}
  }
  return { page, getCloudRequest: () => cloudRequest }
}

test('All-in 先打开确认弹窗，确认后不向云端传入金额', () => {
  const { page, getCloudRequest } = loadBetPage()
  page.handleAllIn()
  assert.equal(page.data.showAllInConfirm, true)
  assert.equal(getCloudRequest(), undefined)

  page.confirmAllIn()
  assert.equal(getCloudRequest().data.action, 'ALLIN')
  assert.deepEqual(getCloudRequest().data.payload, {
    roomId: 'ABC123',
    operationId: 'operation-client-123'
  })
  assert.equal(page.data.showAllInConfirm, false)
})

test('下注按钮按底注、跟注、All-in 排列并使用通用确认弹窗', () => {
  const wxml = fs.readFileSync(
    path.join(__dirname, '../miniprogram/pages/room/room.wxml'),
    'utf8'
  )
  assert.match(wxml, /bindtap="handleBaseBet"[\s\S]*?>底注<[\s\S]*?bindtap="handleFollow"[\s\S]*?>跟注<[\s\S]*?bindtap="handleAllIn"[\s\S]*?>All-in</)
  assert.match(wxml, /class="confirm-modal \{\{showAllInConfirm[\s\S]*?是否Allin所有分数[\s\S]*?>再想想<[\s\S]*?bindtap="confirmAllIn"/)
})
