const test = require('node:test')
const assert = require('node:assert/strict')

function loadRoomPage(wxOverrides = {}) {
  let pageDefinition
  const app = { globalData: { appearanceTheme: 'light', currentRoomId: 'ABC123' } }

  global.getApp = () => app
  global.wx = {
    getDeviceInfo: () => ({ benchmarkLevel: 20 }),
    getStorageSync: key => key === 'openid' ? 'other-player' : '',
    removeStorageSync() {},
    hideLoading() {},
    ...wxOverrides
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
      myOpenid: 'other-player',
      isCreator: false,
      room: {
        _id: 'ABC123',
        roomName: '测试牌局',
        gameMode: 'normal',
        status: 'ended',
        members: [
          { openid: 'owner', name: '房主', score: 10 },
          { openid: 'other-player', name: '玩家', score: -10 }
        ],
        records: [],
        prizePool: { total: 0 }
      }
    },
    setData(update) {
      Object.entries(update).forEach(([path, value]) => {
        const parts = path.split('.')
        let target = this.data
        while (parts.length > 1) target = target[parts.shift()]
        target[parts[0]] = value
      })
    }
  }

  return { app, page }
}

test('非房主收到结算状态后先提示，再展示战绩', () => {
  let modalOptions
  const { app, page } = loadRoomPage({
    showModal(options) {
      modalOptions = options
      options.complete()
    }
  })

  page.handleRoomSettled()

  assert.equal(modalOptions.title, '本局已结算')
  assert.match(modalOptions.content, /不能再进行转账或下注/)
  assert.equal(page.data.showResultModal, true)
  assert.equal(app.globalData.currentRoomId, null)
})

test('房间监听收到删除事件后立即锁定操作并提示', () => {
  let watchOptions
  let modalOptions
  const watcher = { close() {} }
  const database = {
    collection: () => ({
      doc: () => ({
        watch(options) {
          watchOptions = options
          return watcher
        }
      })
    })
  }
  const { page } = loadRoomPage({
    cloud: { database: () => database },
    showModal(options) { modalOptions = options }
  })
  page.data.room.status = 'playing'
  page.data.showTransferModal = true

  page.initRoomWatch('ABC123')
  watchOptions.onChange({
    docs: [{ _id: 'ABC123' }],
    docChanges: [{ dataType: 'remove' }]
  })

  assert.equal(modalOptions.title, '房间已解散')
  assert.equal(page.data.room.status, 'ended')
  assert.equal(page.data.showTransferModal, false)
})
