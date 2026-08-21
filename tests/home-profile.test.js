const test = require('node:test')
const assert = require('node:assert/strict')

function flushTasks() {
  return new Promise(resolve => setImmediate(resolve))
}

function loadHomePage({ callFunction } = {}) {
  let pageDefinition
  const app = {
    globalData: {
      appearanceTheme: 'light',
      currentRoomId: null,
      userInfo: { nickname: '旧昵称', avatarUrl: '', avatarFileID: 'cloud://old' }
    }
  }
  const requests = []

  global.getApp = () => app
  global.wx = {
    getDeviceInfo: () => ({ benchmarkLevel: 20 }),
    getStorageSync: () => '',
    showToast() {},
    showLoading() {},
    hideLoading() {},
    cloud: {
      callFunction(options) {
        requests.push(options)
        if (callFunction) return callFunction(options, requests)
        options.success({ result: { success: true } })
      }
    }
  }
  global.Page = definition => { pageDefinition = definition }

  const modulePath = require.resolve('../miniprogram/pages/home/home')
  delete require.cache[modulePath]
  require(modulePath)

  const page = {
    ...pageDefinition,
    data: {
      ...pageDefinition.data,
      nickname: '旧昵称',
      avatarUrl: '',
      avatarFileID: 'cloud://old',
      roomName: '测试房间',
      hasActiveRoom: false,
      currentRoomId: ''
    },
    _lastSavedProfile: { nickname: '旧昵称', avatarFileID: 'cloud://old', syncedRoomId: '' },
    _profileDraftVersion: 0,
    setData(update) { Object.assign(this.data, update) }
  }

  return { app, page, requests }
}

test('昵称输入期间不保存，失焦后才调用资料接口', async () => {
  const { page, requests } = loadHomePage()

  page.onNicknameInput({ detail: { value: '新昵称' } })
  assert.equal(requests.length, 0)

  page.onNicknameBlur({ detail: { value: '新昵称' } })
  await flushTasks()

  assert.equal(requests.length, 1)
  assert.equal(requests[0].name, 'userFunctions')
  assert.equal(requests[0].data.action, 'updateUserInfo')
  assert.equal(requests[0].data.userData.nickname, '新昵称')
})

test('创建房间会等待最新资料保存成功', async () => {
  let resolveProfile
  const events = []
  const { page } = loadHomePage({
    callFunction(options) {
      events.push(options.data.action)
      if (options.data.action === 'updateUserInfo') {
        resolveProfile = () => options.success({ result: { success: true } })
      } else if (options.data.action === 'create') {
        options.success({ result: { success: false, msg: '停止测试跳转' } })
      }
    }
  })
  page.onNicknameInput({ detail: { value: '建房新昵称' } })

  page.submitCreateRoom()
  assert.deepEqual(events, ['updateUserInfo'])

  resolveProfile()
  await flushTasks()
  assert.deepEqual(events, ['updateUserInfo', 'create'])
})

test('保存期间再次改名会继续保存最新版本', async () => {
  const pending = []
  const { page, requests } = loadHomePage({
    callFunction(options) {
      pending.push(options)
    }
  })

  page.onNicknameInput({ detail: { value: '第一次' } })
  const saving = page.ensureProfileSaved()
  assert.equal(requests[0].data.userData.nickname, '第一次')

  page.onNicknameInput({ detail: { value: '最终昵称' } })
  pending.shift().success({ result: { success: true } })
  await flushTasks()
  assert.equal(requests[1].data.userData.nickname, '最终昵称')

  pending.shift().success({ result: { success: true } })
  assert.equal(await saving, true)
  assert.equal(page._lastSavedProfile.nickname, '最终昵称')
})

test('已有活动房间时资料保存同步房间玩家快照', async () => {
  const { page, requests } = loadHomePage()
  page.data.hasActiveRoom = true
  page.data.currentRoomId = 'ABC123'
  page.onNicknameInput({ detail: { value: '房间新昵称' } })

  assert.equal(await page.ensureProfileSaved(), true)
  assert.equal(requests[0].name, 'roomFunctions')
  assert.deepEqual(requests[0].data, {
    action: 'updateProfile',
    payload: { roomId: 'ABC123', nickname: '房间新昵称', avatarFileID: 'cloud://old' }
  })
})

test('账号先保存后才确认活动房间时会补做房间同步', async () => {
  const { page, requests } = loadHomePage()
  page.onNicknameInput({ detail: { value: '稍后同步' } })
  assert.equal(await page.ensureProfileSaved(), true)
  assert.equal(requests[0].name, 'userFunctions')

  page.data.hasActiveRoom = true
  page.data.currentRoomId = 'ABC123'
  assert.equal(await page.ensureProfileSaved(), true)
  assert.equal(requests[1].name, 'roomFunctions')
  assert.equal(requests[1].data.payload.nickname, '稍后同步')
})

test('资料保存失败时不会继续创建房间', async () => {
  const events = []
  const { page } = loadHomePage({
    callFunction(options) {
      events.push(options.data.action)
      options.success({ result: { success: false } })
    }
  })
  page.onNicknameInput({ detail: { value: '未保存昵称' } })

  page.submitCreateRoom()
  await flushTasks()

  assert.deepEqual(events, ['updateUserInfo'])
  assert.equal(page.data.isCreatingOrJoining, false)
})
