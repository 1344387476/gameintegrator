const test = require('node:test')
const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const { ledgerPostgresConfig } = require('../test-support/postgres-ledger')
const { createPool } = require('../src/database')
const { migrate, readMigrations } = require('../src/migrations')
const { exerciseLedgerConcurrency } = require('../test-support/ledger-concurrency')

test('PostgreSQL17真实多连接账本竞争（显式配置的本机隔离测试库）', {
  skip: !process.env.LEDGER_TEST_CONFIRM && '未配置专用测试库；不能用PGlite代替此验收', timeout: 90000
}, async t => {
  const config = ledgerPostgresConfig()
  const failures = []
  const admin = createPool(config, error => failures.push(error.code))
  const schema = `ledger_test_${randomUUID().replaceAll('-', '')}`
  try {
    const info = (await admin.query("SELECT current_database() AS name, current_setting('server_version_num')::integer AS version")).rows[0]
    assert.equal(info.name, config.database)
    assert.ok(info.version >= 170000 && info.version < 180000, '需要PostgreSQL17')
    // schema仅由随机UUID组成，不复用或覆盖已有schema；不执行DROP/清空操作。
    await admin.query(`CREATE SCHEMA "${schema}"`)
  } finally { await admin.end() }
  t.diagnostic(`测试数据保留在独立schema ${schema}，未自动删除`)
  const pool = createPool({ ...config, options: `${config.options} -c search_path=${schema}` }, error => failures.push(error.code))
  t.after(() => pool.end())
  await migrate(pool, await readMigrations())
  const acquired = await Promise.allSettled([pool.connect(), pool.connect()])
  const connections = acquired.filter(result => result.status === 'fulfilled').map(result => result.value)
  try {
    for (const result of acquired) if (result.status === 'rejected') throw result.reason
    const ids = await Promise.all(connections.map(client => client.query('SELECT pg_backend_pid() AS id')))
    assert.notEqual(ids[0].rows[0].id, ids[1].rows[0].id)
  } finally { for (const client of connections) client.release() }
  await exerciseLedgerConcurrency(pool)
  assert.deepEqual(failures, [])
})
