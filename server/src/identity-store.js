const { randomInt, randomUUID } = require('node:crypto')
const { withTransaction } = require('./database')

function publicUser(row) {
  return { id: row.id, nickname: row.nickname, avatarFileId: row.avatar_file_id || null }
}

function createIdentityStore(pool, appId) {
  return {
    async createSession({ openid, tokenHash, ttlSeconds }) {
      return withTransaction(pool, async client => {
        const inserted = await client.query(`INSERT INTO users (id, app_id, openid, nickname)
          VALUES ($1, $2, $3, $4) ON CONFLICT (app_id, openid) DO NOTHING
          RETURNING id, nickname, avatar_file_id`, [randomUUID(), appId, openid, `玩家${randomInt(100, 1000)}`])
        const isNewUser = inserted.rows.length === 1
        const row = inserted.rows[0] || (await client.query(
          'SELECT id, nickname, avatar_file_id FROM users WHERE app_id = $1 AND openid = $2', [appId, openid]
        )).rows[0]
        // 清理当前用户已失效的会话，不影响其他设备仍有效的登录。
        await client.query('DELETE FROM sessions WHERE user_id = $1 AND expires_at <= now()', [row.id])
        const result = await client.query(`INSERT INTO sessions (token_hash, user_id, expires_at)
          VALUES ($1, $2, now() + $3::integer * interval '1 second') RETURNING expires_at`, [tokenHash, row.id, ttlSeconds])
        return { user: publicUser(row), isNewUser, expiresAt: new Date(result.rows[0].expires_at).toISOString() }
      })
    },
    async findSession(tokenHash) {
      const { rows } = await pool.query(`SELECT u.id, u.nickname, u.avatar_file_id, s.expires_at
        FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = $1 AND s.expires_at > now() AND u.app_id = $2`, [tokenHash, appId])
      if (!rows[0]) return null
      return { user: publicUser(rows[0]), expiresAt: new Date(rows[0].expires_at).toISOString() }
    },
    async revokeSession(tokenHash) {
      await pool.query(`DELETE FROM sessions WHERE token_hash = $1
        AND user_id IN (SELECT id FROM users WHERE app_id = $2)`, [tokenHash, appId])
    }
  }
}

module.exports = { createIdentityStore }
