const test = require('node:test')
const assert = require('node:assert/strict')
const { readConfig, readDatabaseConfig } = require('../src/config')
const { testEnv, testConfig } = require('../test-support/config')

test('默认本机监听、最小连接池、不信任转发头，数据库配置不需要微信密钥', () => {
  const config = testConfig()
  assert.equal(config.host, '127.0.0.1')
  assert.equal(config.trustProxyHops, 0)
  assert.equal(config.database.max, 5)
  assert.equal(config.sessionTtlSeconds, 604800)
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
    ['TRUST_PROXY_HOPS', 'true'], ['PGSSLMODE', 'no-verify'],
    ['NODE_ENV', 'prod'], ['LOG_LEVEL', 'verbose'], ['HOST', 'host\nvalue']
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
