const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { readConfig, readDatabaseConfig } = require('../src/config')
const { testEnv, testConfig } = require('../test-support/config')
const { ledgerPostgresConfig } = require('../test-support/postgres-ledger')

test('默认本机监听、最小连接池、不信任转发头，数据库配置不需要微信密钥', () => {
  const config = testConfig()
  assert.equal(config.host, '127.0.0.1')
  assert.equal(config.trustProxyHops, 0)
  assert.equal(config.database.max, 5)
  assert.equal(config.sessionTtlSeconds, 604800)
  assert.equal(config.websocketMaxConnections, 200)
  assert.equal(config.websocketHeartbeatMs, 30000)
  const { WECHAT_APP_SECRET, ...withoutWechat } = testEnv
  assert.doesNotThrow(() => readDatabaseConfig(withoutWechat))
  assert.throws(() => readConfig(withoutWechat), /WECHAT_APP_SECRET/)
})

test('缺失、占位或格式错误的配置启动失败且不泄露原值', () => {
  for (const [name, value] of [
    ['PGPASSWORD', undefined], ['PGPASSWORD', 'replace-with-secret'],
    ['WECHAT_APP_SECRET', 'sensitive-value-should-not-appear'],
    ['WECHAT_APP_ID', 'wrong-app'], ['PORT', '3000x'], ['PORT', '0'],
    ['PGPOOL_MAX', '100'], ['SESSION_TTL_SECONDS', '60'],
    ['WEBSOCKET_MAX_CONNECTIONS', '0'], ['WEBSOCKET_HEARTBEAT_MS', '9999'],
    ['TRUST_PROXY_HOPS', 'true'], ['PGSSLMODE', 'no-verify'],
    ['NODE_ENV', 'prod'], ['LOG_LEVEL', 'verbose'], ['HOST', 'host\nvalue'],
    ['AVATAR_STORAGE_DIR', '../avatars'], ['AVATAR_STORAGE_DIR', path.parse(process.cwd()).root]
  ]) {
    assert.throws(() => testConfig({ [name]: value }), error => {
      assert.match(error.message, new RegExp(name))
      if (name === 'WECHAT_APP_SECRET') assert.ok(!error.message.includes(value))
      return true
    })
  }
})

test('生产配置拒绝短数据库密码，跨主机TLS必须验证证书', () => {
  assert.throws(() => testConfig({ NODE_ENV: 'production', PGPASSWORD: 'short' }), /PGPASSWORD/)
  const config = testConfig({ NODE_ENV: 'production', PGSSLMODE: 'verify-full' })
  assert.deepEqual(config.database.ssl, { rejectUnauthorized: true })
})

test('真实并发测试只能使用明确确认的本机独立库，不继承部署PG变量', () => {
  assert.throws(() => ledgerPostgresConfig(testEnv), /独立测试库/)
  const env = { LEDGER_TEST_CONFIRM: 'isolated-local-database', LEDGER_TEST_DATABASE: 'gameintegrator_ledger_test',
    LEDGER_TEST_USER: 'test_user', LEDGER_TEST_PASSWORD: 'local-test-password' }
  assert.equal(ledgerPostgresConfig(env).max, 6)
  assert.throws(() => ledgerPostgresConfig({ ...env, LEDGER_TEST_DATABASE: 'gameintegrator' }), /独立测试库/)
  assert.throws(() => ledgerPostgresConfig({ ...env, LEDGER_TEST_HOST: 'example.com' }), /本机/)
  assert.throws(() => ledgerPostgresConfig({ ...testEnv, ...env, LEDGER_TEST_PASSWORD: undefined }), /PGPASSWORD/)
})
