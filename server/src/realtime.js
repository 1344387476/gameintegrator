const { WebSocket, WebSocketServer } = require('ws')

const ROOM_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
const PROTOCOL_VERSION = 1

function createRealtimeHub({ auth, rooms, scores, maxConnections = 200, heartbeatMs = 30000, logger = console }) {
  const wss = new WebSocketServer({ noServer: true, clientTracking: true, maxPayload: 4096, perMessageDeflate: false })
  let server
  let heartbeat
  let pendingUpgrades = 0

  function log(level, message, details = {}) {
    const target = logger && typeof logger[level] === 'function' ? logger[level].bind(logger) : null
    if (target) target(details, message)
  }

  function send(socket, message) {
    if (socket.readyState !== WebSocket.OPEN) return false
    try {
      socket.send(JSON.stringify(message))
      return true
    } catch {
      return false
    }
  }

  function detach(socket) {
    socket.roomId = null
    socket.deliveredVersion = 0
  }

  async function subscribe(socket, message) {
    if (!ROOM_ID.test(message.roomId) || (message.lastStateVersion !== undefined &&
      (!Number.isSafeInteger(message.lastStateVersion) || message.lastStateVersion < 0))) {
      send(socket, { type: 'error', code: 'INVALID_MESSAGE', message: '订阅参数无效' })
      return
    }
    try {
      const room = await rooms.get(socket.session.user.id, message.roomId)
      if (socket.readyState !== WebSocket.OPEN) return
      socket.roomId = room.id
      socket.deliveredVersion = room.stateVersion
      send(socket, { type: 'room.snapshot', reason: 'subscribed', room })
    } catch (error) {
      send(socket, { type: 'error', code: error.code === 'ROOM_NOT_FOUND' ? 'ROOM_NOT_FOUND' : 'SUBSCRIBE_FAILED',
        message: error.code === 'ROOM_NOT_FOUND' ? '房间不存在或无权订阅' : '实时订阅暂不可用' })
    }
  }

  function handleMessage(socket, data, isBinary) {
    if (isBinary) {
      socket.close(1008, 'text messages only')
      return
    }
    const now = Date.now()
    if (now - socket.messageWindowStartedAt >= 10000) {
      socket.messageWindowStartedAt = now
      socket.messageCount = 0
    }
    socket.messageCount += 1
    if (socket.messageCount > 20) {
      socket.close(1008, 'message rate exceeded')
      return
    }
    let message
    try { message = JSON.parse(data.toString('utf8')) } catch {
      send(socket, { type: 'error', code: 'INVALID_MESSAGE', message: '消息格式无效' })
      return
    }
    if (!message || typeof message !== 'object' || Array.isArray(message) || message.type !== 'subscribe' ||
      Object.keys(message).some(key => !['type', 'roomId', 'lastStateVersion'].includes(key))) {
      send(socket, { type: 'error', code: 'INVALID_MESSAGE', message: '不支持的实时消息' })
      return
    }
    subscribe(socket, message)
  }

  wss.on('connection', (socket, request, session) => {
    socket.session = session
    socket.isAlive = true
    socket.roomId = null
    socket.deliveredVersion = 0
    socket.messageWindowStartedAt = Date.now()
    socket.messageCount = 0
    socket.sessionExpiresAt = session.expiresAt ? new Date(session.expiresAt).getTime() : Number.POSITIVE_INFINITY
    socket.nextSessionCheckAt = Date.now() + 60000
    socket.sessionCheckPending = false
    socket.on('pong', () => { socket.isAlive = true })
    socket.on('message', (data, isBinary) => handleMessage(socket, data, isBinary))
    socket.on('close', () => detach(socket))
    socket.on('error', () => {})
    send(socket, { type: 'ready', protocolVersion: PROTOCOL_VERSION, heartbeatMs })
  })

  async function upgrade(request, socket, head) {
    socket.on('error', () => {})
    let pathname = ''
    let search = ''
    try {
      const url = new URL(request.url, 'http://localhost')
      pathname = url.pathname
      search = url.search
    } catch {}
    if (pathname !== '/api/v1/ws' || search) {
      socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n')
      socket.destroy()
      return
    }
    if (wss.clients.size + pendingUpgrades >= maxConnections) {
      socket.write('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\nRetry-After: 5\r\n\r\n')
      socket.destroy()
      return
    }
    let session
    pendingUpgrades += 1
    try { session = await auth.authenticate(request.headers.authorization) } catch {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\nWWW-Authenticate: Bearer\r\n\r\n')
      socket.destroy()
      return
    } finally { pendingUpgrades -= 1 }
    if (socket.destroyed) return
    wss.handleUpgrade(request, socket, head, client => wss.emit('connection', client, request, session))
  }

  async function roomChanged(roomId, { revokedUserId = null, ledgerChanged = false } = {}) {
    const targets = [...wss.clients].filter(socket => socket.roomId === roomId && socket.readyState === WebSocket.OPEN)
    const active = []
    for (const socket of targets) {
      if (revokedUserId && socket.session.user.id === revokedUserId) {
        detach(socket)
        send(socket, { type: 'room.access_revoked', roomId, reason: 'membership_changed' })
      } else active.push(socket)
    }
    if (!active.length) return

    // 同一房间一次提交只读取一次可信快照，再广播给仍有权限的连接，避免人数越多数据库读放大越严重。
    let source
    let room
    for (const socket of active) {
      try {
        room = await rooms.get(socket.session.user.id, roomId)
        source = socket
        break
      } catch {
        detach(socket)
        send(socket, { type: 'room.access_revoked', roomId, reason: 'membership_changed' })
      }
    }
    if (!room) return
    let ledger = null
    if (ledgerChanged && scores && typeof scores.list === 'function') {
      try { ledger = (await scores.list(source.session.user.id, roomId, { limit: 50 })).items } catch {}
    }
    for (const socket of active) {
      if (!socket.roomId || socket.readyState !== WebSocket.OPEN || room.stateVersion <= socket.deliveredVersion) continue
      socket.deliveredVersion = room.stateVersion
      send(socket, { type: 'room.snapshot', reason: 'changed', ledgerChanged, ...(ledger ? { ledger } : {}), room })
    }
  }

  function roomTerminated({ roomId, stateVersion, reason, historyId = null }) {
    for (const socket of wss.clients) {
      if (socket.roomId !== roomId) continue
      detach(socket)
      send(socket, { type: reason === 'settled' ? 'room.settled' : 'room.deleted', roomId, stateVersion, historyId })
    }
  }

  function attach(httpServer) {
    if (server) throw new Error('realtime hub already attached')
    server = httpServer
    server.on('upgrade', upgrade)
    heartbeat = setInterval(() => {
      const now = Date.now()
      for (const socket of wss.clients) {
        if (now >= socket.sessionExpiresAt) {
          socket.close(4001, 'session expired')
          continue
        }
        if (typeof auth.validate === 'function' && now >= socket.nextSessionCheckAt && !socket.sessionCheckPending) {
          socket.nextSessionCheckAt = now + 60000
          socket.sessionCheckPending = true
          auth.validate(socket.session.tokenHash).then(current => {
            socket.session = current
            socket.sessionExpiresAt = current.expiresAt ? new Date(current.expiresAt).getTime() : socket.sessionExpiresAt
          }, () => socket.close(4001, 'session revoked')).finally(() => { socket.sessionCheckPending = false })
        }
        if (!socket.isAlive) {
          socket.terminate()
          continue
        }
        socket.isAlive = false
        try { socket.ping() } catch {}
      }
    }, heartbeatMs)
    heartbeat.unref()
  }

  async function close() {
    if (heartbeat) clearInterval(heartbeat)
    heartbeat = null
    if (server) server.off('upgrade', upgrade)
    server = null
    for (const socket of wss.clients) socket.terminate()
    await new Promise(resolve => wss.close(() => resolve()))
  }

  return {
    attach,
    close,
    roomChanged: (roomId, options) => roomChanged(roomId, options).catch(error => log('warn', 'realtime snapshot publish failed', { code: error.code || 'REALTIME_ERROR' })),
    roomTerminated,
    get connectionCount() { return wss.clients.size }
  }
}

module.exports = { PROTOCOL_VERSION, ROOM_ID, createRealtimeHub }
