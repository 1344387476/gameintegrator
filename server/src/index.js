const { readConfig, ConfigurationError } = require('./config')
const { createPool } = require('./database')
const { readMigrations, verifyMigrations } = require('./migrations')
const { createWechatClient } = require('./wechat')
const { createIdentityStore } = require('./identity-store')
const { createAuth } = require('./auth')
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
    app = await buildApp({ config, auth, checkReady })
    app.addHook('onClose', () => pool.end())
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
    console.error(error instanceof ConfigurationError ? error.message : `启动失败（${safeErrorCode(error)}），请检查数据库连接、迁移版本和服务端配置`)
    process.exitCode = 1
  })
}

module.exports = { start }
