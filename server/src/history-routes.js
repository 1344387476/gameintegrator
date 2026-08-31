const { UUID } = require('./score')

async function historyRoutes(app, { histories, requireAuth, success }) {
  app.get('/api/v1/history', {
    onRequest: requireAuth,
    schema: { querystring: { type: 'object', additionalProperties: false, properties: {
      limit: { type: 'string', pattern: '^([1-9]|[1-4][0-9]|50)$' },
      cursor: { type: 'string', pattern: '^[A-Za-z0-9_-]{1,180}$' }
    } } }
  }, async request => success(request, await histories.list(request.session.user.id, {
    limit: request.query.limit === undefined ? 20 : Number(request.query.limit), cursor: request.query.cursor ?? null
  })))
  for (const [url, parameter, method] of [['/api/v1/history/:historyId', 'historyId', 'get'], ['/api/v1/rooms/:roomId/result', 'roomId', 'forRoom']]) {
    app.get(url, { onRequest: requireAuth, schema: {
      querystring: { type: 'object', additionalProperties: false, properties: {} },
      params: { type: 'object', additionalProperties: false, required: [parameter], properties: { [parameter]: { type: 'string', pattern: UUID.source } } }
    } }, async request => success(request, await histories[method](request.session.user.id, request.params[parameter])))
  }
}

module.exports = { historyRoutes }
