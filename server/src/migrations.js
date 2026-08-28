const { readFile, readdir } = require('node:fs/promises')
const path = require('node:path')
const { createHash } = require('node:crypto')
const { withTransaction } = require('./database')

async function readMigrations(directory = path.join(__dirname, '..', 'migrations')) {
  const names = (await readdir(directory)).filter(name => /^\d{3}_[a-z0-9_]+\.sql$/u.test(name)).sort()
  if (!names.length) throw new Error('没有找到数据库迁移文件')
  if (new Set(names.map(name => name.slice(0, 3))).size !== names.length) throw new Error('数据库迁移编号重复')
  return Promise.all(names.map(async name => {
    const sql = (await readFile(path.join(directory, name), 'utf8')).replace(/\r\n/g, '\n')
    return { name, sql, checksum: createHash('sha256').update(sql).digest('hex') }
  }))
}

function assertCompatible(applied, migrations, requireAll) {
  const expected = new Map(migrations.map(item => [item.name, item.checksum]))
  for (const item of applied) {
    if (expected.get(item.name) !== item.checksum) throw new Error('数据库版本与代码不一致，已执行的迁移不能修改')
  }
  const appliedNames = new Set(applied.map(item => item.name))
  // 不允许在已执行版本之前补插迁移，避免不同环境以不同顺序建表。
  const lastApplied = applied.map(item => item.name).sort().at(-1)
  if (migrations.some(item => item.name < lastApplied && !appliedNames.has(item.name))) throw new Error('数据库迁移顺序不一致')
  if (requireAll && applied.length !== migrations.length) throw new Error('请先运行 npm run db:migrate')
}

async function migrate(pool, migrations) {
  return withTransaction(pool, async client => {
    // 同一数据库的迁移串行；锁随事务自动释放，失败不留下半套表结构。
    await client.query('SELECT pg_advisory_xact_lock(73481921)')
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY,
      checksum text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`)
    const { rows } = await client.query('SELECT name, checksum FROM schema_migrations ORDER BY name')
    assertCompatible(rows, migrations, false)
    const applied = new Set(rows.map(item => item.name))
    const added = []
    for (const item of migrations) {
      if (applied.has(item.name)) continue
      await client.query(item.sql)
      await client.query('INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)', [item.name, item.checksum])
      added.push(item.name)
    }
    return added
  })
}

async function verifyMigrations(pool, migrations) {
  const { rows } = await pool.query('SELECT name, checksum FROM schema_migrations ORDER BY name')
  assertCompatible(rows, migrations, true)
  await pool.query('SELECT id FROM users LIMIT 0')
  await pool.query('SELECT token_hash FROM sessions LIMIT 0')
}

module.exports = { readMigrations, migrate, verifyMigrations }
