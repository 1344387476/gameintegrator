const test = require('node:test')
const assert = require('node:assert/strict')
const http = require('node:http')
const { randomUUID } = require('node:crypto')
const { WebSocket } = require('ws')
const { ApiError } = require('../src/errors')
const { createRealtimeHub } = require('../src/realtime')
const { buildApp } = require('../src/app')
const { testConfig } = require('../test-support/config')

function inbox(socket) {
  const queued = []
  const waiting = []
  socket.on('message', data => {
    const value = JSON.parse(data.toString('utf8'))
    const resolve = waiting.shift()
    if (resolve) resolve(value)
    else queued.push(value)
  })
  return () => queued.length ? Promise.resolve(queued.shift()) : new Promise(resolve => waiting.push(resolve))
}

async function fixture(t) {
  const roomId = randomUUID()
  let version = 3
  let allowed = true
  const auth = {
    async authenticate(value) {
      if (value !== 'Bearer valid-token') throw new ApiError(401, 'AUTH_REQUIRED', '请重新登录')
      return { user: { id: 'user-1' } }
    }
  }
  const rooms = {
    async get(userId, requestedRoomId) {
      if (!allowed || userId !== 'user-1' || requestedRoomId !== roomId) throw new ApiError(404, 'ROOM_NOT_FOUND', '无权访问')
      return { id: roomId, roomCode: 'ABC123', roomName: '实时牌局', mode: 'normal', status: 'active',
        ownerId: 'user-1', stateVersion: version, pot: 0, baseBetValue: null, players: [] }
    }
  }
  const server = http.createServer((request, response) => { response.writeHead(404).end() })
  const hub = createRealtimeHub({ auth, rooms, heartbeatMs: 10000, logger: false })
  hub.attach(server)
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  t.after(async () => {
    await hub.close()
    await new Promise(resolve => server.close(resolve))
  })
  return {
    roomId, hub,
    url: `ws://127.0.0.1:${address.port}/api/v1/ws`,
    setVersion(value) { version = value },
    revoke() { allowed = false }
  }
}

function connect(url, authorization = 'Bearer valid-token') {
  const socket = new WebSocket(url, { headers: { authorization } })
  const next = inbox(socket)
  return new Promise((resolve, reject) => {
    socket.once('open', () => resolve({ socket, next }))
    socket.once('error', reject)
  })
}

test('WSS仅接受Header会话，订阅后推送单调房间快照和结算事件', async t => {
  const state = await fixture(t)
  const unauthorized = new WebSocket(state.url, { headers: { authorization: 'Bearer invalid' } })
  const rejection = await new Promise(resolve => unauthorized.once('unexpected-response', (request, response) => {
    response.resume()
    resolve(response.statusCode)
  }))
  assert.equal(rejection, 401)

  const { socket, next } = await connect(state.url)
  assert.deepEqual(await next(), { type: 'ready', protocolVersion: 1, heartbeatMs: 10000 })
  socket.send(JSON.stringify({ type: 'subscribe', roomId: state.roomId, lastStateVersion: 0 }))
  const initial = await next()
  assert.equal(initial.type, 'room.snapshot')
  assert.equal(initial.room.stateVersion, 3)

  state.setVersion(4)
  await state.hub.roomChanged(state.roomId)
  const changed = await next()
  assert.equal(changed.reason, 'changed')
  assert.equal(changed.room.stateVersion, 4)

  const historyId = randomUUID()
  state.hub.roomTerminated({ roomId: state.roomId, stateVersion: 5, reason: 'settled', historyId })
  assert.deepEqual(await next(), { type: 'room.settled', roomId: state.roomId, stateVersion: 5, historyId })
  socket.close()
})

test('成员退出后停止订阅并收到权限撤销，不继续泄露快照', async t => {
  const state = await fixture(t)
  const { socket, next } = await connect(state.url)
  await next()
  socket.send(JSON.stringify({ type: 'subscribe', roomId: state.roomId }))
  await next()
  state.revoke()
  await state.hub.roomChanged(state.roomId)
  assert.deepEqual(await next(), { type: 'room.access_revoked', roomId: state.roomId, reason: 'membership_changed' })
  socket.close()
})

test('REST事务提交成功后才触发房间变更或终止发布点', async t => {
  const testRoomId = randomUUID()
  const changed = []
  const terminated = []
  const realtime = {
    roomChanged(id, options) { changed.push([id, options]) },
    roomTerminated(event) { terminated.push(event) }
  }
  const auth = { async authenticate() { return { user: { id: 'user-1' } } } }
  const rooms = {
    async settle(user, id) { return { roomId: id, roomCode: 'ABC123', stateVersion: 8, historyId: randomUUID(), deleted: false } },
    async dismiss(user, id) { return { roomId: id, roomCode: 'ABC123', stateVersion: 9, deleted: true } },
    async leave(user, id) { return { roomId: id, roomCode: 'ABC123', stateVersion: 10, deleted: false } }
  }
  const scores = { async execute(user, id) { return { roomId: id, stateVersion: 7, ledgerEntryId: randomUUID() } } }
  const app = await buildApp({ config: testConfig(), auth, rooms, scores, realtime, checkReady: async () => {}, logger: false })
  t.after(() => app.close())
  const headers = { authorization: 'Bearer test' }
  const score = await app.inject({ method: 'POST', url: `/api/v1/rooms/${testRoomId}/score`, headers,
    payload: { operationId: 'operation-score', action: 'BET', payload: { amount: 1 } } })
  assert.equal(score.statusCode, 200)
  assert.deepEqual(changed, [[testRoomId, { ledgerChanged: true }]])
  const settle = await app.inject({ method: 'POST', url: `/api/v1/rooms/${testRoomId}/settle`, headers,
    payload: { operationId: 'operation-settle' } })
  assert.equal(settle.statusCode, 200)
  assert.equal(terminated[0].reason, 'settled')
  assert.ok(terminated[0].historyId)
  const dismiss = await app.inject({ method: 'POST', url: `/api/v1/rooms/${testRoomId}/dismiss`, headers,
    payload: { operationId: 'operation-dismiss' } })
  assert.equal(dismiss.statusCode, 200)
  assert.equal(terminated[1].reason, 'deleted')
  const leave = await app.inject({ method: 'POST', url: `/api/v1/rooms/${testRoomId}/leave`, headers,
    payload: { operationId: 'operation-leave' } })
  assert.equal(leave.statusCode, 200)
  assert.deepEqual(changed[1], [testRoomId, { revokedUserId: 'user-1' }])
})
