const test = require('node:test')
const assert = require('node:assert/strict')

test('普通模式单笔转账会调用 gameLogic 云函数', () => {
  let pageDefinition
  let cloudRequest

  global.getApp = () => ({ globalData: { appearanceTheme: 'light' } })
  global.wx = {
    getDeviceInfo: () => ({ benchmarkLevel: 20 }),
    cloud: {
      callFunction(options) {
        cloudRequest = options
        options.success({ result: { success: true } })
        options.complete()
      }
    },
    showToast() {}
  }
  global.Page = definition => { pageDefinition = definition }

  const roomModulePath = require.resolve('../miniprogram/pages/room/room')
  delete require.cache[roomModulePath]
  require(roomModulePath)

  const page = {
    ...pageDefinition,
    data: {
      ...pageDefinition.data,
      roomId: 'ABC123',
      myOpenid: 'sender',
      currentUser: '玩家一',
      targetMemberIndex: 1,
      transferAmount: '25',
      room: {
        status: 'playing',
        gameMode: 'normal',
        members: [
          { openid: 'sender', name: '玩家一' },
          { openid: 'receiver', name: '玩家二', isExited: false }
        ]
      }
    },
    setData(update) { Object.assign(this.data, update) },
    createGameOperationId: () => 'operation-test-123',
    scheduleRealtimeFallback() {}
  }

  page.confirmTransfer()

  assert.equal(cloudRequest.name, 'gameLogic')
  assert.equal(cloudRequest.data.action, 'TRANSFER')
  assert.deepEqual(cloudRequest.data.payload, {
    roomId: 'ABC123',
    operationId: 'operation-test-123',
    amount: 25,
    toOpenid: 'receiver',
    nickname: '玩家一',
    toNickname: '玩家二'
  })
  assert.equal(page.data.showTransferModal, false)
  assert.equal(page.data.transferSubmitting, false)
})
