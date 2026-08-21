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
  assert.match(modalOptions.content, /不能再进行转分或投入/)
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

test('房间页隐藏时释放唯一实时监听', () => {
  let closed = 0
  const { page } = loadRoomPage()
  page.data.roomWatcher = { close() { closed += 1 } }

  page.onHide()

  assert.equal(closed, 1)
  assert.equal(page.data.roomWatcher, null)
})

test('点击离线玩家只提示状态，不打开转分弹窗', () => {
  let toastOptions
  const { page } = loadRoomPage({
    showToast(options) { toastOptions = options }
  })
  page.data.room.status = 'playing'
  page.data.room.members[0].isExited = true

  page.handleMemberTap({ currentTarget: { dataset: { index: 0 } } })

  assert.equal(toastOptions.title, '该玩家已离线')
  assert.equal(page.data.showTransferModal, false)
})

test('首次打开邀请二维码时才触发生成，已有二维码时直接复用', () => {
  const { page } = loadRoomPage()
  let generateCount = 0
  page.getRoomQRCode = () => { generateCount += 1 }

  page.data.qrCodeFileID = ''
  page.showQrcode()
  assert.equal(generateCount, 1)
  assert.equal(page.data.showQrcode, true)

  page.data.qrCodeFileID = 'cloud://env/room-qrcodes/ABC123.png'
  page.showQrcode()
  assert.equal(generateCount, 1)
})
