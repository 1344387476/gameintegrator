const { UUID } = require('./score')

const params = { type: 'object', required: ['roomId'], additionalProperties: false, properties: { roomId: { type: 'string', pattern: UUID.source } } }
async function scoreRoutes(app, { scores, realtime, requireAuth, success }) {
  app.post('/api/v1/rooms/:roomId/score', {
    onRequest: requireAuth,
    schema: {
      params, querystring: { type: 'object', additionalProperties: false, properties: {} },
      body: { type: 'object', additionalProperties: false, required: ['operationId', 'action', 'payload'], properties: {
        operationId: { type: 'string', pattern: '^[A-Za-z0-9_-]{8,80}$' },
        action: { enum: ['TRANSFER', 'BATCH_TRANSFER', 'BET', 'BASE_BET', 'ALLIN', 'CLAIM', 'SET_BASE_BET'] },
        payload: { type: 'object' }
      } }
    }
  }, async request => {
    const result = await scores.execute(request.session.user.id, request.params.roomId, request.body)
    realtime?.roomChanged(result.roomId, { ledgerChanged: true })
    return success(request, result)
  })
  app.get('/api/v1/rooms/:roomId/ledger', {
    onRequest: requireAuth,
    schema: { params, querystring: { type: 'object', additionalProperties: false, properties: {
      limit: { type: 'string', pattern: '^([1-9]|[1-4][0-9]|50)$' },
      beforeVersion: { type: 'string', pattern: '^[1-9][0-9]{0,15}$' }
    } } }
  }, async request => success(request, await scores.list(request.session.user.id, request.params.roomId, {
    limit: request.query.limit === undefined ? 20 : Number(request.query.limit),
    beforeVersion: request.query.beforeVersion ?? null
  })))
}

module.exports = { scoreRoutes }
