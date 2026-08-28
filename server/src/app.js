const Fastify = require('fastify')
const rateLimit = require('@fastify/rate-limit')
const { randomUUID } = require('node:crypto')
const { ApiError, safeErrorCode } = require('./errors')

const emptyQuery = { type: 'object', additionalProperties: false, properties: {} }

async function buildApp({ config, auth, checkReady, logger }) {
  const app = Fastify({
    logger: logger === false ? false : {
      level: config.logLevel,
      ...logger,
      serializers: {
        req: request => ({ method: request.method }),
        res: reply => ({ statusCode: reply.statusCode }),
        err: error => ({ code: safeErrorCode(error) })
      },
      redact: ['req.headers.authorization', 'req.body', 'res.headers["set-cookie"]']
    },
    logController: new Fastify.LogController({ disableRequestLogging: true }),
    requestIdHeader: false,
    genReqId: () => randomUUID(),
    trustProxy: config.trustProxyHops || false,
    bodyLimit: 16 * 1024,
    requestTimeout: 15000,
    connectionTimeout: 20000,
    ajv: { customOptions: { coerceTypes: false, removeAdditional: false, useDefaults: false } }
  })
  await app.register(rateLimit, { global: true, max: 120, timeWindow: 60000, cache: 10000 })
  app.decorateRequest('session', null)
  app.addHook('onSend', async (request, reply, payload) => {
    reply.header('Cache-Control', 'no-store')
    reply.header('X-Content-Type-Options', 'nosniff')
    reply.header('X-Request-Id', request.id)
    return payload
  })
  app.addHook('onResponse', async (request, reply) => {
    // 不记录原始URL、查询参数、请求体、headers或会话，避免凭证进入日志。
    request.log.info({ method: request.method, route: request.routeOptions.url || 'unmatched', statusCode: reply.statusCode }, 'request completed')
  })
  function failure(request, reply, statusCode, code, message) {
    if (statusCode === 401) reply.header('WWW-Authenticate', 'Bearer')
    return reply.code(statusCode).send({ success: false, error: { code, message }, requestId: request.id })
  }
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ApiError) return failure(request, reply, error.statusCode, error.code, error.message)
    if (error.statusCode === 429) return failure(request, reply, 429, 'RATE_LIMITED', '请求过于频繁，请稍后重试')
    if (error.statusCode === 413) return failure(request, reply, 413, 'REQUEST_TOO_LARGE', '请求内容过大')
    if (error.statusCode === 415) return failure(request, reply, 415, 'UNSUPPORTED_MEDIA_TYPE', '请使用 application/json')
    if (error.validation || error.statusCode === 400) return failure(request, reply, 400, 'INVALID_REQUEST', '请求参数无效')
    request.log.error({ code: safeErrorCode(error) }, 'request failed')
    return failure(request, reply, 500, 'INTERNAL_ERROR', '服务暂不可用，请稍后重试')
  })
  app.setNotFoundHandler((request, reply) => failure(request, reply, 404, 'NOT_FOUND', '接口不存在'))
  const success = (request, data) => ({ success: true, data, requestId: request.id })
  const requireAuth = async request => { request.session = await auth.authenticate(request.headers.authorization) }

  app.get('/health/live', { config: { rateLimit: false } }, async request => success(request, { status: 'alive' }))
  app.get('/health/ready', async request => {
    try { await checkReady() } catch { throw new ApiError(503, 'NOT_READY', '服务尚未就绪') }
    return success(request, { status: 'ready' })
  })
  app.post('/api/v1/auth/wechat', {
    config: { rateLimit: { max: config.loginRateLimitMax, timeWindow: 60000 } },
    schema: {
      querystring: emptyQuery,
      body: {
        type: 'object', additionalProperties: false, required: ['code'],
        properties: { code: { type: 'string', minLength: 1, maxLength: 128, pattern: '^[^\\s\\u0000-\\u001f\\u007f]+$' } }
      }
    }
  }, async request => success(request, await auth.login(request.body.code)))
  app.get('/api/v1/users/me', { schema: { querystring: emptyQuery }, preHandler: requireAuth }, async request => success(request, request.session.user))
  app.post('/api/v1/auth/logout', {
    schema: { querystring: emptyQuery }, preHandler: requireAuth
  }, async request => {
    await auth.logout(request.session.tokenHash)
    return success(request, { loggedOut: true })
  })
  return app
}

module.exports = { buildApp }
