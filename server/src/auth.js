const { randomBytes, createHash } = require('node:crypto')
const { ApiError } = require('./errors')

const TOKEN_PATTERN = /^gi_[A-Za-z0-9_-]{43}$/u
function hashToken(token) {
  return createHash('sha256').update(token).digest('hex')
}

function createAuth({ store, exchangeCode, sessionTtlSeconds }) {
  return {
    async login(code) {
      const { openid } = await exchangeCode(code)
      const token = `gi_${randomBytes(32).toString('base64url')}`
      const session = await store.createSession({ openid, tokenHash: hashToken(token), ttlSeconds: sessionTtlSeconds })
      return { token, ...session }
    },
    async authenticate(authorization) {
      const match = typeof authorization === 'string' && /^Bearer (\S+)$/iu.exec(authorization)
      if (!match || !TOKEN_PATTERN.test(match[1])) throw new ApiError(401, 'AUTH_REQUIRED', '请重新登录')
      const tokenHash = hashToken(match[1])
      const session = await store.findSession(tokenHash)
      if (!session) throw new ApiError(401, 'AUTH_REQUIRED', '登录已失效，请重新登录')
      return { tokenHash, ...session }
    },
    logout(tokenHash) {
      return store.revokeSession(tokenHash)
    }
  }
}

module.exports = { createAuth, hashToken }
