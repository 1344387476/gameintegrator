const { publicUser } = require('./identity-store')
const { withProfileRoom } = require('./room-state')

function createProfileStore(pool, appId) {
  return {
    async updateNickname(userId, nickname) {
      const result = await withProfileRoom(pool, appId, userId, async client => {
        const { rows } = await client.query(`UPDATE users SET nickname = $3, updated_at = now()
          WHERE id = $1 AND app_id = $2 RETURNING id, nickname, avatar_file_id`, [userId, appId, nickname])
        return { row: rows[0] }
      })
      return publicUser(result.row)
    },
    async replaceAvatar(userId, fileId) {
      const result = await withProfileRoom(pool, appId, userId, async (client, user) => {
        const { rows } = await client.query(`UPDATE users SET avatar_file_id = $3, updated_at = now()
          WHERE id = $1 AND app_id = $2 RETURNING id, nickname, avatar_file_id`, [userId, appId, fileId])
        return { row: rows[0], previousFileId: user.avatar_file_id }
      })
      return { user: publicUser(result.row), previousFileId: result.previousFileId }
    },
    async canReadAvatar(userId, fileId) {
      const { rows } = await pool.query(`SELECT EXISTS (
        SELECT 1 FROM users WHERE id = $1 AND app_id = $2 AND avatar_file_id = $3
        UNION ALL
        SELECT 1 FROM active_room_memberships viewer
        JOIN rooms r ON r.id = viewer.room_id AND r.app_id = $2 AND r.status = 'active'
        JOIN room_members self ON self.room_id = r.id AND self.user_id = viewer.user_id AND NOT self.is_exited
        JOIN room_members target ON target.room_id = r.id
        WHERE viewer.user_id = $1 AND target.avatar_file_id = $3
        UNION ALL
        SELECT 1 FROM active_room_memberships viewer
        JOIN rooms r ON r.id = viewer.room_id AND r.app_id = $2 AND r.status = 'active'
        JOIN room_members self ON self.room_id = r.id AND self.user_id = viewer.user_id AND NOT self.is_exited
        JOIN score_ledger entry ON entry.room_id = r.id
        WHERE viewer.user_id = $1 AND entry.actor_avatar_file_id = $3
        UNION ALL
        SELECT 1 FROM active_room_memberships viewer
        JOIN rooms r ON r.id = viewer.room_id AND r.app_id = $2 AND r.status = 'active'
        JOIN room_members self ON self.room_id = r.id AND self.user_id = viewer.user_id AND NOT self.is_exited
        JOIN score_ledger entry ON entry.room_id = r.id
        JOIN score_ledger_changes c ON c.entry_id = entry.id AND c.avatar_file_id = $3
        WHERE viewer.user_id = $1
        UNION ALL
        SELECT 1 FROM history_players viewer
        JOIN histories h ON h.id = viewer.history_id AND h.app_id = $2
        JOIN history_players target ON target.history_id = h.id AND target.avatar_file_id = $3
        WHERE viewer.user_id = $1
      ) AS allowed`, [userId, appId, fileId])
      return rows[0].allowed
    }
  }
}

module.exports = { createProfileStore }
