const { ApiError } = require('./errors')

const emptyQuery = { type: 'object', additionalProperties: false, properties: {} }
const uuid = { type: 'string', pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' }
const operationId = { type: 'string', pattern: '^[A-Za-z0-9_-]{8,80}$' }
const roomParams = { type: 'object', required: ['roomId'], additionalProperties: false, properties: { roomId: uuid } }
const body = extra => ({ type: 'object', additionalProperties: false, required: ['operationId', ...Object.keys(extra)], properties: { operationId, ...extra } })

async function roomRoutes(app, { rooms, qrcodes, realtime, requireAuth, success }) {
  app.post('/api/v1/rooms', {
    onRequest: requireAuth,
    config: { rateLimit: { max: 10, timeWindow: 60000 } },
    schema: { querystring: emptyQuery, body: body({ roomName: { type: 'string', minLength: 1, maxLength: 20 }, mode: { enum: ['normal', 'bet'] } }) }
  }, async request => {
    const roomName = request.body.roomName.trim()
    if (!roomName || /[\u0000-\u001f\u007f-\u009f\ud800-\udfff]/u.test(request.body.roomName)) throw new ApiError(400, 'INVALID_REQUEST', '房间名称无效')
    const result = await rooms.create(request.session.user.id, { ...request.body, roomName })
    realtime?.roomChanged(result.roomId)
    return success(request, result)
  })
  app.post('/api/v1/rooms/join', {
    onRequest: requireAuth,
    config: { rateLimit: { max: 20, timeWindow: 60000 } },
    schema: { querystring: emptyQuery, body: body({ roomCode: { type: 'string', pattern: '^[A-Za-z0-9]{6}$' } }) }
  }, async request => {
    const result = await rooms.joinByCode(request.session.user.id, { ...request.body, roomCode: request.body.roomCode.toUpperCase() })
    realtime?.roomChanged(result.roomId)
    return success(request, result)
  })

  app.post('/api/v1/rooms/join-scene', {
    onRequest: requireAuth,
    config: { rateLimit: { max: 20, timeWindow: 60000 } },
    schema: { querystring: emptyQuery, body: body({ scene: { type: 'string', pattern: '^r[A-Za-z0-9_-]{22}$' } }) }
  }, async request => {
    const result = await rooms.joinByScene(request.session.user.id, request.body)
    realtime?.roomChanged(result.roomId)
    return success(request, result)
  })

  for (const [route, method, extra] of [['join', 'joinById', {}], ['leave', 'leave', {}], ['owner', 'transferOwner', { toUserId: uuid }], ['settle', 'settle', {}], ['dismiss', 'dismiss', {}]]) {
    app.post(`/api/v1/rooms/:roomId/${route}`, {
      onRequest: requireAuth,
      schema: { querystring: emptyQuery, params: roomParams, body: body(extra) }
    }, async request => {
      const result = await rooms[method](request.session.user.id, request.params.roomId, request.body)
      if (route === 'settle') realtime?.roomTerminated({ ...result, reason: 'settled' })
      else if (route === 'dismiss' || result.deleted) realtime?.roomTerminated({ ...result, reason: 'deleted' })
      else realtime?.roomChanged(result.roomId, route === 'leave' ? { revokedUserId: request.session.user.id } : undefined)
      return success(request, result)
    })
  }
  app.get('/api/v1/rooms/:roomId', {
    onRequest: requireAuth, schema: { querystring: emptyQuery, params: roomParams }
  }, async request => success(request, await rooms.get(request.session.user.id, request.params.roomId)))
  app.get('/api/v1/users/me/room', {
    onRequest: requireAuth, schema: { querystring: emptyQuery }
  }, async request => success(request, { room: await rooms.current(request.session.user.id) }))
  if (qrcodes) {
    for (const method of ['GET', 'POST']) {
      app.route({ method, url: '/api/v1/rooms/:roomId/qrcode', onRequest: requireAuth,
        config: { rateLimit: { max: method === 'POST' ? 10 : 60, timeWindow: 60000 } },
        schema: { querystring: emptyQuery, params: roomParams, ...(method === 'POST' ? { body: emptyQuery } : {}) },
        handler: async (request, reply) => {
          const image = await qrcodes[method === 'POST' ? 'getOrCreate' : 'read'](request.session.user.id, request.params.roomId)
          return reply.type('image/png').header('Content-Disposition', 'inline; filename="room-qrcode.png"').send(image)
        }
      })
    }
  }
}

module.exports = { roomRoutes }
