const { readConfig } = require('../src/config')

const testEnv = {
  NODE_ENV: 'test',
  PGDATABASE: 'gameintegrator_test',
  PGUSER: 'test_user',
  PGPASSWORD: 'test-only-database-password',
  WECHAT_APP_ID: 'wx7687ea673d95f908',
  WECHAT_APP_SECRET: 'a'.repeat(32),
  LOG_LEVEL: 'silent'
}

function testConfig(overrides = {}) {
  return readConfig({ ...testEnv, ...overrides })
}

module.exports = { testEnv, testConfig }
