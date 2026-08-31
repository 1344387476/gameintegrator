const { readConfig, ConfigurationError } = require('./config')
const { createPool } = require('./database')
const { readMigrations, verifyMigrations } = require('./migrations')
const { createWechatClient } = require('./wechat')
const { createIdentityStore } = require('./identity-store')
const { createAuth } = require('./auth')
const { createProfileStore } = require('./profile-store')
const { createProfile } = require('./profile')
const { createAvatarStorage } = require('./avatar-storage')
const { createRoomStore } = require('./room-store')
const { createScoreStore } = require('./score-store')
const { createHistoryStore } = require('./history-store')
const { createQRCodeService } = require('./qrcode')
const { createWechatQRCodeClient } = require('./wechat-qrcode')
const { createRealtimeHub } = require('./realtime')
const { buildApp } = require('./app')
const { safeErrorCode } = require('./errors')

async function start() {
  const config = readConfig()
  const pool = createPool(config.database, error => console.error('数据库连接异常', safeErrorCode(error)))
  let app
  try {
    const migrations = await readMigrations()
    const checkReady = () => verifyMigrations(pool, migrations)
    await checkReady()
    const auth = createAuth({ store: createIdentityStore(pool, config.wechat.appId), exchangeCode: createWechatClient(config.wechat), sessionTtlSeconds: config.sessionTtlSeconds })
    const storage = await createAvatarStorage(config.avatarDirectory)
    const profile = createProfile({ store: createProfileStore(pool, config.wechat.appId), storage })
    const rooms = createRoomStore(pool, config.wechat.appId)
    const scores = createScoreStore(pool, config.wechat.appId)
    const histories = createHistoryStore(pool, config.wechat.appId)
    const qrcodes = createQRCodeService(pool, config.wechat.appId, createWechatQRCodeClient(config.wechat))
    const realtime = createRealtimeHub({ auth, rooms, scores, maxConnections: config.websocketMaxConnections,
      heartbeatMs: config.websocketHeartbeatMs })
    app = await buildApp({ config, auth, profile, rooms, scores, histories, qrcodes, realtime, checkReady })
    realtime.attach(app.server)
    app.addHook('onClose', async () => { await realtime.close(); await pool.end() })
    await app.listen({ host: config.host, port: config.port })
  } catch (error) {
    if (app) await app.close()
    else await pool.end()
    throw error
  }
  let closing = false
  const shutdown = async () => {
    if (closing) return
    closing = true
    const deadline = setTimeout(() => process.exit(1), 10000)
    deadline.unref()
    try { await app.close() } catch { process.exitCode = 1 } finally { clearTimeout(deadline) }
  }
  process.once('SIGTERM', shutdown)
  process.once('SIGINT', shutdown)
  return app
}

if (require.main === module) {
  start().catch(error => {
    console.error(error instanceof ConfigurationError ? error.message : `启动失败（${safeErrorCode(error)}），请检查数据库连接、迁移版本、头像目录权限和服务端配置`)
    process.exitCode = 1
  })
}

module.exports = { start }
