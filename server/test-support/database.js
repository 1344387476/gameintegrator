const { PGlite } = require('@electric-sql/pglite')

// 仅测试使用：真正执行PostgreSQL SQL，但单连接串行，不证明真实pg连接池/并发锁行为。
async function createTestDatabase() {
  const engine = await PGlite.create()
  let pending = Promise.resolve()
  async function connect() {
    const previous = pending
    let unlock
    pending = new Promise(resolve => { unlock = resolve })
    await previous
    let released = false
    return {
      async query(sql, values) {
        if (released) throw new Error('test client already released')
        const result = values === undefined ? (await engine.exec(sql)).at(-1) : await engine.query(sql, values)
        return { ...result, rowCount: result.affectedRows ?? result.rows.length }
      },
      release() {
        if (!released) { released = true; unlock() }
      }
    }
  }
  return {
    connect,
    async query(sql, values) {
      const client = await connect()
      try { return await client.query(sql, values) } finally { client.release() }
    },
    async end() { await pending; await engine.close() }
  }
}

module.exports = { createTestDatabase }
