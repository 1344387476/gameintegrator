const { readDatabaseConfig, ConfigurationError } = require('../src/config')

function ledgerPostgresConfig(env = process.env) {
  // 专用变量，不读取PG*、服务.env或部署密码；只能指向明确命名的本机测试数据库。
  if (env.LEDGER_TEST_CONFIRM !== 'isolated-local-database' || !/^[a-z][a-z0-9_]*_ledger_test$/u.test(env.LEDGER_TEST_DATABASE || '')) {
    throw new ConfigurationError('需要明确确认独立测试库，LEDGER_TEST_DATABASE 必须以 _ledger_test 结尾')
  }
  const host = env.LEDGER_TEST_HOST || '127.0.0.1'
  if (!['127.0.0.1', '::1'].includes(host)) throw new ConfigurationError('账本并发测试仅允许连接本机独立数据库')
  return readDatabaseConfig({ NODE_ENV: 'test', PGHOST: host, PGPORT: env.LEDGER_TEST_PORT || '5432',
    PGDATABASE: env.LEDGER_TEST_DATABASE, PGUSER: env.LEDGER_TEST_USER, PGPASSWORD: env.LEDGER_TEST_PASSWORD,
    PGPOOL_MAX: '6', PGSSLMODE: 'disable' })
}

module.exports = { ledgerPostgresConfig }
