const test = require('node:test')
const assert = require('node:assert/strict')

const userId = '11111111-1111-4111-8111-111111111111'
const roomId = '22222222-2222-4222-8222-222222222222'
const otherId = '33333333-3333-4333-8333-333333333333'
const token = `gi_${'a'.repeat(43)}`

function ok(data) { return { statusCode: 200, data: { success: true, data } } }

function loadBackend(handler) {
  const storage = new Map([['backendApiBaseUrl', 'https://api.example.test']])
  const requests = []
  global.wx = {
    env: { USER_DATA_PATH: '/tmp' },
    getStorageSync: key => storage.get(key),
    setStorageSync: (key, value) => storage.set(key, value),
    removeStorageSync: key => storage.delete(key),
    login: options => options.success({ code: 'wechat-code' }),
    request(options) {
      requests.push(options)
      Promise.resolve(handler(options, requests)).then(options.success, options.fail)
    },
    downloadFile: options => options.success({ statusCode: 200, tempFilePath: `/tmp/${options.url.split('/').pop()}.jpg` }),
    uploadFile: options => options.success({ statusCode: 200, data: JSON.stringify({ success: true, data: {
      id: userId, nickname: '玩家A', avatarFileId: 'avatar-id', currentRoomId: roomId
    } }) }),
    getFileSystemManager: () => ({ writeFile: options => options.success() })
  }
  const path = require.resolve('../miniprogram/utils/backend')
  delete require.cache[path]
  return { backend: require(path), requests, storage }
}

function loginResponse() {
  return ok({ token, expiresAt: '2099-01-01T00:00:00.000Z', isNewUser: true,
    user: { id: userId, nickname: '玩家A', avatarFileId: null, currentRoomId: null } })
}

test('自建客户端用wx.login换取Bearer，会话身份只来自服务端', async () => {
  const { backend, requests, storage } = loadBackend(options => {
    if (options.url.endsWith('/api/v1/auth/wechat')) return loginResponse()
    if (options.url.endsWith('/api/v1/users/me')) return ok({ id: userId, nickname: '玩家A', avatarFileId: null, currentRoomId: roomId })
    throw new Error(`unexpected ${options.url}`)
  })
  const response = await backend.callFunction({ name: 'userFunctions', data: { action: 'getUserInfo' } })
  assert.equal(response.result.success, true)
  assert.equal(response.result.openid, userId)
  assert.equal(response.result.isNewUser, true)
  assert.equal(requests[0].data.code, 'wechat-code')
  assert.equal(requests[1].header.Authorization, `Bearer ${token}`)
  assert.equal(requests[1].url, 'https://api.example.test/api/v1/users/me')
  assert.equal(storage.get('openid'), userId)
  assert.ok(!JSON.stringify(requests).includes('openid='))
})

test('房间REST快照和审计流水映射为现有页面模型，转分字段改用用户UUID', async () => {
  let scoreBody
  const { backend } = loadBackend(options => {
    if (options.url.endsWith('/api/v1/auth/wechat')) return loginResponse()
    if (options.url.endsWith(`/api/v1/rooms/${roomId}`)) return ok({
      id: roomId, roomCode: 'ABC123', roomName: '测试牌局', mode: 'normal', status: 'active',
      ownerId: userId, stateVersion: 4, pot: 0, baseBetValue: null, createdAt: '2026-08-30T00:00:00.000Z',
      players: [
        { userId, nickname: '玩家A', avatarFileId: null, score: -10, isExited: false, seat: 1 },
        { userId: otherId, nickname: '玩家B', avatarFileId: null, score: 10, isExited: false, seat: 2 }
      ]
    })
    if (options.url.includes(`/api/v1/rooms/${roomId}/ledger?`)) return ok({ items: [{
      id: 'entry', operationId: 'score-operation', action: 'TRANSFER', stateVersion: 4, amount: 10,
      actor: { userId, nickname: '玩家A', avatarFileId: null },
      changes: [
        { userId, nickname: '玩家A', scoreBefore: 0, scoreAfter: -10 },
        { userId: otherId, nickname: '玩家B', scoreBefore: 0, scoreAfter: 10 }
      ], createdAt: '2026-08-30T00:01:00.000Z'
    }], nextBeforeVersion: null })
    if (options.url.endsWith(`/api/v1/rooms/${roomId}/score`)) { scoreBody = options.data; return ok({ roomId, stateVersion: 5 }) }
    throw new Error(`unexpected ${options.url}`)
  })
  const room = (await backend.database().collection('rooms').doc(roomId).get()).data
  assert.equal(room._id, roomId)
  assert.equal(room.roomCode, 'ABC123')
  assert.equal(room.owner, userId)
  assert.deepEqual(room.players.map(player => player.openid), [userId, otherId])
  assert.equal(room.recentMessages[0].content, '转给 玩家B 10 分')

  const result = await backend.callFunction({ name: 'gameLogic', data: { action: 'TRANSFER', payload: {
    roomId, operationId: 'score-operation-2', amount: 7, toOpenid: otherId, nickname: '伪造名', toNickname: '伪造目标'
  } } })
  assert.equal(result.result.success, true)
  assert.deepEqual(scoreBody, { operationId: 'score-operation-2', action: 'TRANSFER', payload: { toUserId: otherId, amount: 7 } })
})

test('WSS以Header鉴权订阅，只接受更高stateVersion并生成房间watch快照', async () => {
  let socketOptions
  let sent
  const socketHandlers = {}
  const changes = []
  const { backend } = loadBackend(options => {
    if (options.url.endsWith('/api/v1/auth/wechat')) return loginResponse()
    if (options.url.includes(`/api/v1/rooms/${roomId}/ledger?`)) return ok({ items: [], nextBeforeVersion: null })
    throw new Error(`unexpected ${options.url}`)
  })
  wx.connectSocket = options => {
    socketOptions = options
    return {
      onOpen: callback => { socketHandlers.open = callback },
      onMessage: callback => { socketHandlers.message = callback },
      onError: callback => { socketHandlers.error = callback },
      onClose: callback => { socketHandlers.close = callback },
      send: options => { sent = JSON.parse(options.data) },
      close() {}
    }
  }
  const watcher = backend.database().collection('rooms').doc(roomId).watch({
    onChange: value => changes.push(value),
    onError: error => assert.fail(error.message)
  })
  await new Promise(resolve => setImmediate(resolve))
  socketHandlers.open()
  assert.equal(socketOptions.url, 'wss://api.example.test/api/v1/ws')
  assert.equal(socketOptions.header.Authorization, `Bearer ${token}`)
  assert.deepEqual(sent, { type: 'subscribe', roomId, lastStateVersion: 0 })

  const snapshot = { id: roomId, roomCode: 'ABC123', roomName: '实时牌局', mode: 'bet', status: 'active',
    ownerId: userId, stateVersion: 2, pot: 5, baseBetValue: 1, createdAt: '2026-08-30T00:00:00.000Z', players: [] }
  socketHandlers.message({ data: JSON.stringify({ type: 'room.snapshot', room: snapshot }) })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(changes.length, 1)
  assert.equal(changes[0].docs[0].stateVersion, 2)
  socketHandlers.message({ data: JSON.stringify({ type: 'room.snapshot', room: { ...snapshot, stateVersion: 1 } }) })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(changes.length, 1)
  watcher.close()
})

test('活动房间读取404时用受权战绩区分结算与解散并返回最终积分', async () => {
  const { backend } = loadBackend(options => {
    if (options.url.endsWith('/api/v1/auth/wechat')) return loginResponse()
    if (options.url.endsWith(`/api/v1/rooms/${roomId}`)) return {
      statusCode: 404, data: { success: false, error: { code: 'ROOM_NOT_FOUND', message: '房间不存在或无权访问' } }
    }
    if (options.url.endsWith(`/api/v1/rooms/${roomId}/result`)) return ok({
      id: '44444444-4444-4444-8444-444444444444', roomId, roomName: '已结算牌局', mode: 'normal',
      ownerId: userId, settledBy: userId, stateVersion: 9, endedAt: '2026-08-30T01:00:00.000Z',
      players: [{ userId, nickname: '玩家A', avatarFileId: null, score: 12, isExited: false, seat: 1 }]
    })
    throw new Error(`unexpected ${options.url}`)
  })
  const room = (await backend.database().collection('rooms').doc(roomId).get()).data
  assert.equal(room.status, 'settled')
  assert.equal(room.players[0].score, 12)
})

test('写请求网络结果未知时有限重试原operationId，不生成第二笔操作', async () => {
  const bodies = []
  const { backend } = loadBackend(options => {
    if (options.url.endsWith('/api/v1/auth/wechat')) return loginResponse()
    if (options.url.endsWith('/api/v1/rooms')) {
      bodies.push(options.data)
      if (bodies.length < 3) throw new Error('temporary network failure')
      return ok({ roomId, roomCode: 'ABC123', stateVersion: 1, deleted: false })
    }
    throw new Error(`unexpected ${options.url}`)
  })
  const response = await backend.callFunction({ name: 'roomFunctions', data: { action: 'create', payload: {
    roomName: '重试牌局', mode: 'normal'
  } } })
  assert.equal(response.result.success, true)
  assert.equal(bodies.length, 3)
  assert.equal(new Set(bodies.map(body => body.operationId)).size, 1)
})
