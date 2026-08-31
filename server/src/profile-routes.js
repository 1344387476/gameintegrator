const multipart = require('@fastify/multipart')
const { ApiError } = require('./errors')
const { MAX_AVATAR_BYTES } = require('./profile')

const emptyQuery = { type: 'object', additionalProperties: false, properties: {} }
const MAX_UPLOAD_BODY = MAX_AVATAR_BYTES + 16 * 1024

async function profileRoutes(app, { profile, realtime, requireAuth, success }) {
  await app.register(multipart, {
    limits: { fileSize: MAX_AVATAR_BYTES, files: 1, fields: 0, parts: 1, headerPairs: 32, fieldNameSize: 100 }
  })
  app.patch('/api/v1/users/me', {
    onRequest: requireAuth,
    schema: {
      querystring: emptyQuery,
      body: {
        type: 'object', additionalProperties: false, required: ['nickname'],
        properties: { nickname: { type: 'string', minLength: 1, maxLength: 10 } }
      }
    }
  }, async request => {
    const user = await profile.update(request.session.user.id, request.body.nickname)
    if (user.currentRoomId) realtime?.roomChanged(user.currentRoomId)
    return success(request, user)
  })

  app.post('/api/v1/users/me/avatar', {
    onRequest: async request => {
      await requireAuth(request)
      if (Number(request.headers['content-length']) > MAX_UPLOAD_BODY) {
        throw new ApiError(413, 'REQUEST_TOO_LARGE', '请求内容过大')
      }
    },
    config: { rateLimit: { max: 10, timeWindow: 60000 } },
    schema: { querystring: emptyQuery }
  }, async request => {
    if (!request.isMultipart()) throw new ApiError(415, 'UNSUPPORTED_MEDIA_TYPE', '请使用multipart/form-data上传头像')
    const user = await profile.upload(request.session.user.id, async () => {
      let upload
      let received = 0
      const countBytes = chunk => {
        received += chunk.length
        // 插件直接读取raw，不能用preParsing变换流限总量。无Content-Length的超大流直接断开。
        if (received > MAX_UPLOAD_BODY) request.raw.destroy(new ApiError(413, 'REQUEST_TOO_LARGE', '请求内容过大'))
      }
      request.raw.on('data', countBytes)
      try {
        for await (const part of request.parts()) {
          if (part.type !== 'file' || part.fieldname !== 'avatar' || upload) {
            if (part.type === 'file') part.file.resume()
            throw new ApiError(400, 'INVALID_REQUEST', '只允许一个名为avatar的文件字段')
          }
          upload = { buffer: await part.toBuffer(), mimetype: part.mimetype }
        }
      } catch (error) {
        if (['FST_PARTS_LIMIT', 'FST_FILES_LIMIT', 'FST_FIELDS_LIMIT', 'FST_INVALID_MULTIPART_CONTENT_TYPE'].includes(error.code)) {
          throw new ApiError(400, 'INVALID_REQUEST', '只允许一个名为avatar的文件字段')
        }
        if (error instanceof ApiError || error.statusCode === 413) throw error
        throw new ApiError(400, 'INVALID_REQUEST', '上传格式不完整或无效')
      } finally { request.raw.removeListener('data', countBytes) }
      if (!upload) throw new ApiError(400, 'INVALID_REQUEST', '请选择头像文件')
      return upload
    }, request.log)
    if (user.currentRoomId) realtime?.roomChanged(user.currentRoomId)
    return success(request, user)
  })

  app.get('/api/v1/avatars/:fileId', {
    onRequest: requireAuth,
    schema: { querystring: emptyQuery, params: {
      type: 'object', required: ['fileId'], additionalProperties: false,
      properties: { fileId: { type: 'string', maxLength: 80 } }
    } }
  }, async (request, reply) => {
    const buffer = await profile.read(request.session.user.id, request.params.fileId)
    return reply.type('image/jpeg').header('Content-Disposition', 'inline; filename="avatar.jpg"').send(buffer)
  })
}

module.exports = { profileRoutes }
