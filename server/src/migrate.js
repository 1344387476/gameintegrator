const { readDatabaseConfig, ConfigurationError } = require('./config')
const { createPool } = require('./database')
const { readMigrations, migrate } = require('./migrations')
const { safeErrorCode } = require('./errors')

async function main() {
  const config = readDatabaseConfig()
  const pool = createPool(config, error => console.error('数据库连接异常', safeErrorCode(error)))
  try {
    const added = await migrate(pool, await readMigrations())
    console.log(added.length ? `已应用迁移：${added.join(', ')}` : '数据库已是当前版本')
  } finally {
    await pool.end()
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error(error instanceof ConfigurationError ? error.message : `数据库迁移失败（${safeErrorCode(error)}），请核对连接、权限及迁移版本`)
    process.exitCode = 1
  })
}
