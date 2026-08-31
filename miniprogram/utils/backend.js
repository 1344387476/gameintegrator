const config = require('../config')

const SESSION_KEY = 'selfHostedSession'
const API_OVERRIDE_KEY = 'backendApiBaseUrl'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
const ROOM_CODE = /^[A-Z0-9]{6}$/u
const SCENE = /^r[A-Za-z0-9_-]{22}$/u
const TOKEN = /^gi_[A-Za-z0-9_-]{43}$/u
const avatarCache = new Map()
const roomMessageCache = new Map()
const historyCursors = new Map([[1, null]])
let session = null
let loginPromise = null
let newUserPending = false

class BackendError extends Error {
  constructor(message, code = 'NETWORK_ERROR', statusCode = 0) {
    super(message)
    this.name = 'BackendError'
    this.code = code
    this.statusCode = statusCode
    this.errMsg = message
    if (code === 'ROOM_NOT_FOUND') this.errCode = -502001
  }
}

function readStoredSession() {
  if (session) return session
  const stored = wx.getStorageSync(SESSION_KEY)
  if (!stored || !TOKEN.test(stored.token || '') || !stored.user || !stored.user.id ||
      !stored.expiresAt || new Date(stored.expiresAt).getTime() <= Date.now() + 30000) return null
  session = stored
  return session
}

function apiBaseUrl() {
  const configured = String(wx.getStorageSync(API_OVERRIDE_KEY) || config.apiBaseUrl || '').trim().replace(/\/+$/u, '')
  if (!/^https:\/\/[A-Za-z0-9.-]+(?::\d+)?(?:\/[^?#]*)?$/u.test(configured) &&
      !/^http:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?(?:\/[^?#]*)?$/u.test(configured)) {
    throw new BackendError('尚未配置自建服务HTTPS地址', 'BACKEND_NOT_CONFIGURED')
  }
  return configured
}

function websocketUrl() {
  return `${apiBaseUrl().replace(/^https:/u, 'wss:').replace(/^http:/u, 'ws:')}/api/v1/ws`
}

function clearSession() {
  session = null
  avatarCache.clear()
  roomMessageCache.clear()
  historyCursors.clear()
  historyCursors.set(1, null)
  wx.removeStorageSync(SESSION_KEY)
}

function wxLogin() {
  return new Promise((resolve, reject) => wx.login({
    success: result => result.code ? resolve(result.code) : reject(new BackendError('微信登录未返回有效code', 'WECHAT_LOGIN_FAILED')),
    fail: error => reject(new BackendError(error.errMsg || '微信登录失败', 'WECHAT_LOGIN_FAILED'))
  }))
}

function rawRequest({ method = 'GET', path, data, authorization = '', responseType = 'text' }) {
  return new Promise((resolve, reject) => {
    try {
      wx.request({
        url: `${apiBaseUrl()}${path}`,
        method,
        data,
        responseType,
        timeout: config.requestTimeoutMs,
        header: {
          ...(authorization ? { Authorization: authorization } : {}),
          ...(data !== undefined ? { 'Content-Type': 'application/json' } : {})
        },
        success: resolve,
        fail: error => reject(new BackendError(error.errMsg || '网络请求失败'))
      })
    } catch (error) {
      reject(error instanceof BackendError ? error : new BackendError(error.errMsg || error.message || '网络请求失败'))
    }
  })
}

function responseData(response) {
  const body = response && response.data
  if (response.statusCode >= 200 && response.statusCode < 300 && body && body.success === true) return body.data
  const error = body && body.error
  throw new BackendError(error && error.message || '服务请求失败', error && error.code || 'HTTP_ERROR', response.statusCode || 0)
}

async function ensureSession(force = false) {
  if (!force && readStoredSession()) return session
  if (loginPromise) return loginPromise
  loginPromise = (async () => {
    if (force) clearSession()
    const code = await wxLogin()
    const result = responseData(await rawRequest({ method: 'POST', path: '/api/v1/auth/wechat', data: { code } }))
    session = { token: result.token, user: result.user, expiresAt: result.expiresAt }
    newUserPending = Boolean(result.isNewUser)
    wx.setStorageSync(SESSION_KEY, session)
    // 页面内部仍沿用openid字段名，但值是自建数据库的用户UUID，服务端从不信任客户端传入该值。
    wx.setStorageSync('openid', result.user.id)
    wx.setStorageSync('userId', result.user.id)
    return session
  })().finally(() => { loginPromise = null })
  return loginPromise
}

function retryDelay(attemptsLeft) {
  return new Promise(resolve => setTimeout(resolve, attemptsLeft === 2 ? 200 : 600))
}

async function request(options, retryAuth = true, retriesLeft = 2) {
  const active = await ensureSession()
  let response
  try {
    response = await rawRequest({ ...options, authorization: `Bearer ${active.token}` })
  } catch (error) {
    if (retriesLeft > 0 && error.statusCode === 0) {
      await retryDelay(retriesLeft)
      return request(options, retryAuth, retriesLeft - 1)
    }
    throw error
  }
  if (response.statusCode === 401 && retryAuth) {
    await ensureSession(true)
    return request(options, false, retriesLeft)
  }
  if (response.statusCode >= 500 && retriesLeft > 0) {
    await retryDelay(retriesLeft)
    return request(options, retryAuth, retriesLeft - 1)
  }
  return responseData(response)
}

function operationId(prefix = 'op') {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`
}

function callbackPromise(promise, options) {
  return promise.then(value => {
    if (typeof options.success === 'function') options.success(value)
    if (typeof options.complete === 'function') options.complete(value)
    return value
  }, error => {
    if (typeof options.fail === 'function') {
      options.fail(error)
      if (typeof options.complete === 'function') options.complete(error)
      return undefined
    }
    if (typeof options.complete === 'function') options.complete(error)
    throw error
  })
}

function userResult(user, isNewUser = false) {
  return {
    success: true,
    openid: user.id,
    currentRoomId: user.currentRoomId || null,
    isNewUser,
    userInfo: {
      nickname: user.nickname || '',
      avatar: '',
      avatarFileID: user.avatarFileId || '',
      isNewUser
    }
  }
}

async function downloadAvatar(fileId, retryAuth = true) {
  if (!fileId) return ''
  if (avatarCache.has(fileId)) return avatarCache.get(fileId)
  const active = await ensureSession()
  const path = await new Promise((resolve, reject) => wx.downloadFile({
    url: `${apiBaseUrl()}/api/v1/avatars/${encodeURIComponent(fileId)}`,
    header: { Authorization: `Bearer ${active.token}` },
    timeout: config.requestTimeoutMs,
    success: response => {
      if (response.statusCode === 200) resolve(response.tempFilePath)
      else reject(new BackendError('头像读取失败', response.statusCode === 404 ? 'NOT_FOUND' : 'HTTP_ERROR', response.statusCode))
    },
    fail: error => reject(new BackendError(error.errMsg || '头像下载失败'))
  })).catch(async error => {
    if (error.statusCode === 401 && retryAuth) {
      await ensureSession(true)
      return downloadAvatar(fileId, false)
    }
    throw error
  })
  avatarCache.set(fileId, path)
  return path
}

async function avatarUrls(fileIds) {
  const pairs = await Promise.all((fileIds || []).map(async fileId => {
    try { return [fileId, await downloadAvatar(fileId)] } catch { return [fileId, ''] }
  }))
  return Object.fromEntries(pairs.filter(([, value]) => value))
}

function ledgerMessage(entry, change = null) {
  const actor = entry.actor || {}
  const recipient = change && change.userId !== actor.userId ? change : null
  const action = entry.action
  let messageType = 'system'
  let content = action
  let toOpenid = ''
  if (action === 'TRANSFER' || action === 'BATCH_TRANSFER') {
    messageType = 'transfer'
    toOpenid = recipient ? recipient.userId : ''
    content = `转给 ${recipient ? recipient.nickname : '玩家'} ${recipient ? recipient.scoreAfter - recipient.scoreBefore : entry.amount} 分`
  } else if (action === 'BET') {
    messageType = 'bet'; content = `下注 ${entry.amount} 分`
  } else if (action === 'BASE_BET') {
    messageType = 'bet'; content = `底注 ${entry.amount} 分`
  } else if (action === 'ALLIN') {
    messageType = 'allin'; content = `All-in ${entry.amount} 分`
  } else if (action === 'CLAIM') {
    messageType = 'claim'; content = `收走了奖池 ${entry.amount} 分`
  } else if (action === 'SET_BASE_BET') {
    content = `设置底注 ${entry.baseBetAfter || entry.amount} 分`
  }
  return {
    operationId: entry.operationId,
    messageType,
    fromOpenid: actor.userId || '',
    fromNickname: actor.nickname || '玩家',
    fromAvatarFileID: actor.avatarFileId || '',
    toOpenid,
    toNickname: recipient ? recipient.nickname : '',
    amount: recipient ? recipient.scoreAfter - recipient.scoreBefore : entry.amount,
    content,
    timestamp: entry.createdAt
  }
}

function ledgerMessages(entries) {
  return (entries || []).flatMap(entry => {
    if (entry.action !== 'BATCH_TRANSFER') return [ledgerMessage(entry, (entry.changes || []).find(change => change.userId !== entry.actor.userId))]
    const recipients = (entry.changes || []).filter(change => change.userId !== entry.actor.userId && change.scoreAfter > change.scoreBefore)
    return recipients.map(change => ledgerMessage(entry, change))
  })
}

async function loadLedgerMessages(roomId, maximum = 100) {
  const entries = []
  let beforeVersion = null
  while (entries.length < maximum) {
    const query = `limit=50${beforeVersion ? `&beforeVersion=${encodeURIComponent(beforeVersion)}` : ''}`
    const page = await request({ path: `/api/v1/rooms/${roomId}/ledger?${query}` })
    entries.push(...page.items)
    if (!page.nextBeforeVersion) break
    beforeVersion = page.nextBeforeVersion
  }
  return ledgerMessages(entries.slice(0, maximum))
}

function mapRoom(room, messages = []) {
  return {
    _id: room.id,
    roomCode: room.roomCode,
    roomName: room.roomName,
    mode: room.mode,
    status: room.status,
    owner: room.ownerId,
    stateVersion: room.stateVersion,
    pot: room.pot,
    baseBetVal: room.baseBetValue,
    createTime: room.createdAt,
    recentMessages: messages,
    players: (room.players || []).map(player => ({
      openid: player.userId,
      nickname: player.nickname,
      avatar: '',
      avatarFileID: player.avatarFileId || '',
      score: player.score,
      isExited: player.isExited,
      seat: player.seat,
      lastDepositAmount: player.lastDepositAmount,
      lastDepositTime: player.lastDepositAt
    }))
  }
}

function mapSettledHistory(history, messages = []) {
  return mapRoom({
    id: history.roomId,
    roomCode: '',
    roomName: history.roomName,
    mode: history.mode,
    status: 'settled',
    ownerId: history.ownerId,
    stateVersion: history.stateVersion,
    pot: 0,
    baseBetValue: null,
    createdAt: history.endedAt,
    players: (history.players || []).map(player => ({
      userId: player.userId,
      nickname: player.nickname,
      avatarFileId: player.avatarFileId,
      score: player.score,
      isExited: player.isExited,
      seat: player.seat,
      lastDepositAmount: null,
      lastDepositAt: null
    }))
  }, messages)
}

async function getRoomDocument(roomId) {
  try {
    const room = await request({ path: `/api/v1/rooms/${roomId}` })
    const messages = await loadLedgerMessages(roomId).catch(() => [])
    roomMessageCache.set(roomId, messages)
    return mapRoom(room, messages)
  } catch (error) {
    if (error.code !== 'ROOM_NOT_FOUND') throw error
    const history = await request({ path: `/api/v1/rooms/${roomId}/result` })
    return mapSettledHistory(history)
  }
}

async function uploadAvatar(filePath, retryAuth = true) {
  const active = await ensureSession()
  const user = await new Promise((resolve, reject) => wx.uploadFile({
    url: `${apiBaseUrl()}/api/v1/users/me/avatar`,
    filePath,
    name: 'avatar',
    timeout: config.requestTimeoutMs,
    header: { Authorization: `Bearer ${active.token}` },
    success: response => {
      let body
      try { body = JSON.parse(response.data) } catch {}
      if (response.statusCode >= 200 && response.statusCode < 300 && body && body.success) resolve(body.data)
      else reject(new BackendError(body && body.error && body.error.message || '头像上传失败',
        body && body.error && body.error.code || 'HTTP_ERROR', response.statusCode || 0))
    },
    fail: error => reject(new BackendError(error.errMsg || '头像上传失败'))
  })).catch(async error => {
    if (error.statusCode === 401 && retryAuth) {
      await ensureSession(true)
      return uploadAvatar(filePath, false)
    }
    throw error
  })
  if (session) {
    session = { ...session, user }
    wx.setStorageSync(SESSION_KEY, session)
  }
  avatarCache.clear()
  return user
}

async function downloadQRCode(roomId, retryAuth = true) {
  const active = await ensureSession()
  const response = await rawRequest({ method: 'POST', path: `/api/v1/rooms/${roomId}/qrcode`, data: {},
    authorization: `Bearer ${active.token}`, responseType: 'arraybuffer' })
  if (response.statusCode === 401 && retryAuth) {
    await ensureSession(true)
    return downloadQRCode(roomId, false)
  }
  if (response.statusCode !== 200) {
    const decoder = typeof TextDecoder === 'function' ? new TextDecoder() : null
    let body
    try { body = JSON.parse(decoder ? decoder.decode(response.data) : '') } catch {}
    throw new BackendError(body && body.error && body.error.message || '二维码生成失败',
      body && body.error && body.error.code || 'HTTP_ERROR', response.statusCode || 0)
  }
  const filePath = `${wx.env.USER_DATA_PATH}/room-qrcode-${roomId}.png`
  await new Promise((resolve, reject) => wx.getFileSystemManager().writeFile({
    filePath, data: response.data, success: resolve,
    fail: error => reject(new BackendError(error.errMsg || '二维码保存失败', 'FILE_WRITE_FAILED'))
  }))
  return filePath
}

function scorePayload(action, payload) {
  if (action === 'TRANSFER') return { toUserId: payload.toOpenid, amount: payload.amount }
  if (action === 'BATCH_TRANSFER') return { transferList: (payload.transferList || []).map(item => ({ toUserId: item.openid, amount: item.amount })) }
  if (['BET'].includes(action)) return { amount: payload.amount }
  return {}
}

async function dispatchFunction(name, data = {}) {
  if (name === 'userFunctions') {
    if (data.action === 'getUserInfo') {
      await ensureSession()
      const user = await request({ path: '/api/v1/users/me' })
      const result = userResult(user, newUserPending)
      newUserPending = false
      return result
    }
    if (data.action === 'updateUserInfo') {
      const user = await request({ method: 'PATCH', path: '/api/v1/users/me', data: { nickname: data.userData && data.userData.nickname } })
      return { ...userResult(user), user }
    }
    if (data.action === 'getUserRoomStatus') {
      const current = await request({ path: '/api/v1/users/me/room' })
      return { success: true, inRoom: Boolean(current.room), roomId: current.room && current.room.id }
    }
  }
  if (name === 'roomFunctions') {
    const payload = data.payload || {}
    if (data.action === 'checkUserStatus') {
      const current = await request({ path: '/api/v1/users/me/room' })
      return { success: true, inRoom: Boolean(current.room), roomId: current.room && current.room.id }
    }
    if (data.action === 'create') {
      return { success: true, ...(await request({ method: 'POST', path: '/api/v1/rooms', data: {
        operationId: payload.operationId || operationId('create'), roomName: payload.roomName, mode: payload.mode
      } })) }
    }
    if (data.action === 'join') {
      const invite = String(payload.scene || payload.roomId || payload.roomCode || '')
      let path
      let body
      if (SCENE.test(invite)) {
        path = '/api/v1/rooms/join-scene'; body = { operationId: payload.operationId || operationId('join'), scene: invite }
      } else if (UUID.test(invite)) {
        path = `/api/v1/rooms/${invite}/join`; body = { operationId: payload.operationId || operationId('join') }
      } else {
        path = '/api/v1/rooms/join'; body = { operationId: payload.operationId || operationId('join'), roomCode: invite.toUpperCase() }
      }
      return { success: true, ...(await request({ method: 'POST', path, data: body })) }
    }
    if (['leave', 'settle', 'dismiss'].includes(data.action)) {
      const result = await request({ method: 'POST', path: `/api/v1/rooms/${payload.roomId}/${data.action}`, data: {
        operationId: payload.operationId || operationId(data.action)
      } })
      return { success: true, roomDeleted: Boolean(result.deleted), ...result }
    }
    if (data.action === 'updateProfile') {
      const user = await request({ method: 'PATCH', path: '/api/v1/users/me', data: { nickname: payload.nickname } })
      return { success: true, user }
    }
    if (data.action === 'deleteSettledRoom') return { success: true }
    if (data.action === 'updateBaseBetValue') {
      const result = await request({ method: 'POST', path: `/api/v1/rooms/${payload.roomId}/score`, data: {
        operationId: payload.operationId || operationId('base'), action: 'SET_BASE_BET', payload: { amount: payload.baseBetValue }
      } })
      return { success: true, ...result }
    }
    if (data.action === 'getAvatarUrls') return { success: true, avatarUrls: await avatarUrls(payload.fileIDs) }
    if (data.action === 'generateQRCode') {
      const fileID = await downloadQRCode(payload.roomId)
      return { success: true, fileID, tempFileURL: fileID }
    }
    if (data.action === 'listHistory') {
      const page = payload.page || 1
      if (page === 1) { historyCursors.clear(); historyCursors.set(1, null) }
      const cursor = historyCursors.get(page)
      const result = await request({ path: `/api/v1/history?limit=${payload.pageSize || 20}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}` })
      historyCursors.set(page + 1, result.nextCursor)
      const userId = (await ensureSession()).user.id
      return { success: true, items: result.items.map(item => ({ ...item, historyId: item.id, endTime: item.endedAt,
        myScore: (item.players.find(player => player.userId === userId) || {}).score || 0 })), hasMore: Boolean(result.nextCursor) }
    }
    if (data.action === 'getHistoryDetail') {
      const detail = await request({ path: `/api/v1/history/${payload.historyId}` })
      const mappedPlayers = detail.players.map(player => ({ ...player, openid: player.userId, avatarFileID: player.avatarFileId || '' }))
      return { success: true, detail: { ...detail, historyId: detail.id, endTime: detail.endedAt,
        players: mappedPlayers, avatarUrls: await avatarUrls(mappedPlayers.map(player => player.avatarFileID).filter(Boolean)) } }
    }
  }
  if (name === 'gameLogic') {
    const payload = data.payload || {}
    const result = await request({ method: 'POST', path: `/api/v1/rooms/${payload.roomId}/score`, data: {
      operationId: payload.operationId || operationId('score'), action: data.action, payload: scorePayload(data.action, payload)
    } })
    return { success: true, ...result }
  }
  throw new BackendError('不支持的客户端接口映射', 'UNSUPPORTED_CLIENT_ACTION')
}

function callFunction(options) {
  const promise = dispatchFunction(options.name, options.data).then(result => ({ result }), error => {
    if (error instanceof BackendError && error.statusCode > 0) {
      return { result: { success: false, msg: error.message, code: error.code } }
    }
    throw error
  })
  return callbackPromise(promise, options)
}

function uploadFile(options) {
  return callbackPromise(uploadAvatar(options.filePath).then(user => ({ fileID: user.avatarFileId, user })), options)
}

function getTempFileURL(options) {
  const promise = Promise.all((options.fileList || []).map(async fileID => ({
    fileID,
    tempFileURL: /^wxfile:|^https?:|^[A-Za-z]:\\|^\//u.test(fileID) ? fileID : await downloadAvatar(fileID)
  }))).then(fileList => ({ fileList }))
  return callbackPromise(promise, options)
}

function watcher(roomId, options) {
  let closed = false
  let socket
  let lastVersion = 0
  let lastRoom = null
  let lastMessages = roomMessageCache.get(roomId) || []
  let delivery = Promise.resolve()
  const fail = error => {
    if (closed) return
    closed = true
    if (socket) socket.close({ code: 1000, reason: 'fallback' })
    options.onError(error instanceof Error ? error : new BackendError('实时连接已断开'))
  }
  ensureSession().then(active => {
    if (closed) return
    socket = wx.connectSocket({ url: websocketUrl(), header: { Authorization: `Bearer ${active.token}` }, timeout: config.requestTimeoutMs })
    socket.onOpen(() => socket.send({ data: JSON.stringify({ type: 'subscribe', roomId, lastStateVersion: lastVersion }) }))
    socket.onMessage(event => {
      let message
      try { message = JSON.parse(event.data) } catch { return }
      if (message.type === 'room.snapshot') {
        delivery = delivery.then(async () => {
          if (closed || message.room.stateVersion <= lastVersion) return
          if (Array.isArray(message.ledger)) {
            const latest = ledgerMessages(message.ledger)
            const seen = new Set()
            lastMessages = latest.concat(lastMessages).filter(item => {
              const key = `${item.operationId}:${item.toOpenid || ''}`
              if (seen.has(key)) return false
              seen.add(key)
              return true
            }).slice(0, 100)
            roomMessageCache.set(roomId, lastMessages)
          } else if (!roomMessageCache.has(roomId) || message.ledgerChanged) {
            lastMessages = await loadLedgerMessages(roomId).catch(() => lastMessages)
            roomMessageCache.set(roomId, lastMessages)
          }
          lastRoom = message.room
          lastVersion = message.room.stateVersion
          options.onChange({ docs: [mapRoom(message.room, lastMessages)], docChanges: [{ dataType: 'update' }] })
        })
      } else if (message.type === 'room.settled') {
        delivery = delivery.then(async () => {
          if (closed || message.stateVersion < lastVersion) return
          let settled
          try {
            settled = await getRoomDocument(roomId)
            settled.recentMessages = lastMessages
          } catch {
            if (!lastRoom) return
            settled = mapRoom({ ...lastRoom, status: 'settled', stateVersion: message.stateVersion }, lastMessages)
          }
          lastVersion = message.stateVersion
          options.onChange({ docs: [settled], docChanges: [{ dataType: 'update' }] })
        })
      } else if (message.type === 'room.deleted') {
        roomMessageCache.delete(roomId)
        avatarCache.clear()
        options.onChange({ docs: [], docChanges: [{ dataType: 'remove' }] })
      } else if (message.type === 'room.access_revoked') {
        roomMessageCache.delete(roomId)
        avatarCache.clear()
        options.onChange({ docs: [], docChanges: [{ dataType: 'access_revoked' }] })
      } else if (message.type === 'error') {
        fail(new BackendError(message.message || '实时订阅失败', message.code || 'REALTIME_ERROR'))
      }
    })
    socket.onError(error => fail(new BackendError(error.errMsg || '实时连接失败')))
    socket.onClose(event => {
      if (!closed) fail(new BackendError(`实时连接已关闭（${event.code || 1006}）`, 'REALTIME_CLOSED'))
    })
  }).catch(fail)
  return { close() { closed = true; if (socket) socket.close({ code: 1000, reason: 'page hidden' }) } }
}

function document(collection, id) {
  return {
    get(options = {}) {
      const promise = collection === 'rooms'
        ? getRoomDocument(id).then(data => ({ data }))
        : loadLedgerMessages(id).then(messages => ({ data: { _id: id, messages } }))
      return callbackPromise(promise, options)
    },
    watch(options) {
      if (collection !== 'rooms') throw new BackendError('仅房间支持实时订阅', 'UNSUPPORTED_WATCH')
      return watcher(id, options)
    }
  }
}

function database() {
  return { collection: name => ({ doc: id => document(name, id) }) }
}

module.exports = {
  BackendError,
  callFunction,
  database,
  ensureSession,
  getRoomDocument,
  getTempFileURL,
  uploadFile,
  websocketUrl
}
