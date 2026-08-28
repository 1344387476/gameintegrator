const { Pool } = require('pg')

function createPool(config, onError) {
  const pool = new Pool(config)
  // 空闲连接也可能报错；必须监听，且不能把含凭证的原始错误直接输出。
  pool.on('error', onError)
  return pool
}

async function withTransaction(pool, execute) {
  const client = await pool.connect()
  let broken = false
  try {
    await client.query('BEGIN')
    const result = await execute(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    try {
      await client.query('ROLLBACK')
    } catch {
      broken = true
    }
    throw error
  } finally {
    client.release(broken)
  }
}

module.exports = { createPool, withTransaction }
