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

  const backendPath = require.resolve('../miniprogram/utils/backend')
  require.cache[backendPath] = { exports: {
    callFunction: options => global.wx.cloud.callFunction(options),
    uploadFile: options => global.wx.cloud.uploadFile(options),
    getTempFileURL: options => global.wx.cloud.getTempFileURL(options),
    database: () => global.wx.cloud.database()
  } }

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

test('房间资料头像使用媒体选择并上传到自建适配层', () => {
  const events = []
  const { page } = loadRoomPage({
    chooseMedia(options) {
      events.push(['choose', options.mediaType, options.sourceType])
      options.success({ tempFiles: [{ tempFilePath: 'wxfile://room-avatar.jpg' }] })
    },
    cloud: {
      uploadFile(options) {
        events.push(['upload', options.filePath])
        options.success({ fileID: 'avatar-room-new' })
      }
    },
    showToast() {}
  })
  page.data.room.members[1].avatarUrl = 'wxfile://old.jpg'
  page.data.room.members[1].avatarFileID = 'avatar-old'
  page.showEditProfile()

  page.onProfileAvatarTap()

  assert.deepEqual(events, [
    ['choose', ['image'], ['album', 'camera']],
    ['upload', 'wxfile://room-avatar.jpg']
  ])
  assert.equal(page.data.editProfile.avatarUrl, 'wxfile://room-avatar.jpg')
  assert.equal(page.data.editProfile.avatarFileID, 'avatar-room-new')
  assert.equal(page.data.isUploadingAvatar, false)
})

test('房间资料头像上传失败会恢复原头像并解除锁定', () => {
  const { page } = loadRoomPage({
    chooseMedia(options) {
      options.success({ tempFiles: [{ tempFilePath: 'wxfile://broken.jpg' }] })
    },
    cloud: {
      uploadFile(options) {
        options.fail(new Error('upload failed'))
      }
    },
    showToast() {}
  })
  page.data.room.members[1].avatarUrl = 'wxfile://old.jpg'
  page.data.room.members[1].avatarFileID = 'avatar-old'
  page.showEditProfile()

  page.onProfileAvatarTap()

  assert.equal(page.data.editProfile.avatarUrl, 'wxfile://old.jpg')
  assert.equal(page.data.editProfile.avatarFileID, 'avatar-old')
  assert.equal(page.data.isUploadingAvatar, false)
})

test('非房主收到结算状态后先显示统一风格通知，再展示战绩', () => {
  let modalCount = 0
  const { app, page } = loadRoomPage({ showModal() { modalCount += 1 } })

  page.handleRoomSettled()

  assert.equal(modalCount, 0)
  assert.equal(page.data.showSettledNotice, true)
  assert.equal(page.data.showResultModal, false)
  page.confirmSettledNotice()
  assert.equal(page.data.showSettledNotice, false)
  assert.equal(page.data.showResultModal, true)
  assert.equal(app.globalData.currentRoomId, null)
})

test('房间监听收到删除事件后立即锁定操作并显示统一风格通知', () => {
  let watchOptions
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
    cloud: { database: () => database }
  })
  page.data.room.status = 'playing'
  page.data.showTransferModal = true

  page.initRoomWatch('ABC123')
  watchOptions.onChange({
    docs: [{ _id: 'ABC123' }],
    docChanges: [{ dataType: 'remove' }]
  })

  assert.equal(page.data.room.status, 'ended')
  assert.equal(page.data.showTransferModal, false)
  assert.equal(page.data.showDismissedNotice, true)
})

test('最后一人主动退出触发房间删除时直接返回首页', () => {
  let watchOptions
  let reLaunchCount = 0
  let modalCount = 0
  const database = {
    collection: () => ({
      doc: () => ({
        watch(options) {
          watchOptions = options
          return { close() {} }
        }
      })
    })
  }
  const { page } = loadRoomPage({
    cloud: {
      database: () => database,
      callFunction(options) {
        watchOptions.onChange({ docs: [], docChanges: [{ dataType: 'remove' }] })
        options.success({ result: { success: true, roomDeleted: true } })
      }
    },
    showModal() { modalCount += 1 },
    reLaunch() { reLaunchCount += 1 },
    showToast() {}
  })
  page.data.room.status = 'playing'
  page.data.room.members = [{ openid: 'other-player', name: '玩家', score: 0 }]
  page.initRoomWatch('ABC123')

  page.confirmExit()

  assert.equal(modalCount, 0)
  assert.equal(reLaunchCount, 1)
  assert.equal(page.data.showDismissedNotice, false)
})

test('房主主动解散成功后显示统一风格卡片而不是 Toast', () => {
  let toastCount = 0
  let reLaunchCount = 0
  const { page } = loadRoomPage({
    cloud: {
      callFunction(options) {
        options.success({ result: { success: true } })
      }
    },
    showLoading() {},
    showToast() { toastCount += 1 },
    reLaunch() { reLaunchCount += 1 }
  })
  page.data.room.status = 'playing'
  page.data.showDismissConfirm = true

  page.confirmDismiss()

  assert.equal(toastCount, 0)
  assert.equal(reLaunchCount, 0)
  assert.equal(page.data.showDismissedNotice, true)
  assert.equal(page.data.dismissedNoticeByMe, true)
  assert.equal(page.data.room.status, 'ended')
})

test('房间页隐藏时释放唯一实时监听', () => {
  let closed = 0
  const { page } = loadRoomPage()
  page.data.roomWatcher = { close() { closed += 1 } }

  page.onHide()

  assert.equal(closed, 1)
  assert.equal(page.data.roomWatcher, null)
})

test('WSS成员权限撤销按退出处理，不误报房间已解散', () => {
  let watchOptions
  let modalCount = 0
  const database = { collection: () => ({ doc: () => ({ watch(options) { watchOptions = options; return { close() {} } } }) }) }
  const { app, page } = loadRoomPage({
    cloud: { database: () => database },
    showModal() { modalCount += 1 },
    showToast() {},
    reLaunch() {}
  })
  page.data.exitSubmitting = true
  page.initRoomWatch('ABC123')
  watchOptions.onChange({ docs: [], docChanges: [{ dataType: 'access_revoked' }] })
  assert.equal(modalCount, 0)
  assert.equal(app.globalData.currentRoomId, null)
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

test('打开转入奖池弹窗后自动聚焦金额输入框', () => {
  let nextTickCount = 0
  const { page } = loadRoomPage({
    nextTick(callback) {
      nextTickCount += 1
      callback()
    }
  })
  page.data.room.status = 'playing'

  page.transferToPrizePool()

  assert.equal(nextTickCount, 1)
  assert.equal(page.data.showPrizeModal, true)
  assert.equal(page.data.prizeInputFocus, true)

  page.closePrizeModal()
  assert.equal(page.data.prizeInputFocus, false)
})
