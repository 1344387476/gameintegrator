const { randomUUID } = require('node:crypto')
const { ApiError } = require('./errors')
const { UUID } = require('./score')

async function saveHistory(client, room, members, userId) {
  const id = randomUUID()
  await client.query(`INSERT INTO histories(id,room_id,app_id,room_name,mode,owner_user_id,settled_by,state_version)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [id, room.id, room.app_id, room.room_name, room.mode, room.owner_user_id, userId, room.state_version])
  for (const member of members) {
    await client.query(`INSERT INTO history_players(history_id,user_id,seat,nickname,avatar_file_id,score,is_exited)
      VALUES ($1,$2,$3,$4,$5,$6,$7)`, [id, member.user_id, member.seat, member.nickname, member.avatar_file_id, member.score, member.is_exited])
  }
  return id
}

function invalid() { throw new ApiError(400, 'INVALID_REQUEST', '战绩分页参数无效') }
function decodeCursor(cursor) {
  if (cursor === null) return null
  if (typeof cursor !== 'string' || !/^[A-Za-z0-9_-]{1,180}$/u.test(cursor)) invalid()
  try {
    const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))
    if (!Array.isArray(value) || value.length !== 2 || typeof value[0] !== 'string' || typeof value[1] !== 'string' ||
      !UUID.test(value[1]) || new Date(value[0]).toISOString() !== value[0] ||
      Buffer.from(JSON.stringify(value)).toString('base64url') !== cursor) invalid()
    return value
  } catch { invalid() }
}

function createHistoryStore(pool, appId) {
  async function present(rows) {
    if (!rows.length) return []
    // 战绩和成员快照提交后不可修改，分页读取无需长期持有房间锁。
    const players = (await pool.query('SELECT * FROM history_players WHERE history_id=ANY($1::uuid[]) ORDER BY seat', [rows.map(row => row.id)])).rows
    return rows.map(row => ({ id: row.id, roomId: row.room_id, roomName: row.room_name, mode: row.mode,
      ownerId: row.owner_user_id, settledBy: row.settled_by, stateVersion: Number(row.state_version),
      endedAt: new Date(row.ended_at).toISOString(),
      players: players.filter(player => player.history_id === row.id).map(player => ({ userId: player.user_id,
        nickname: player.nickname, avatarFileId: player.avatar_file_id, score: Number(player.score), isExited: player.is_exited, seat: player.seat })) }))
  }
  async function detail(userId, id, byRoom) {
    if (typeof id !== 'string' || !UUID.test(id)) throw new ApiError(400, 'INVALID_REQUEST', '战绩编号无效')
    const rows = (await pool.query(`SELECT h.* FROM histories h WHERE h.app_id=$1 AND h.${byRoom ? 'room_id' : 'id'}=$2
      AND EXISTS (SELECT 1 FROM history_players p WHERE p.history_id=h.id AND p.user_id=$3)`, [appId, id, userId])).rows
    if (!rows.length) throw new ApiError(404, 'HISTORY_NOT_FOUND', '战绩不存在或无权访问')
    return (await present(rows))[0]
  }
  return {
    async list(userId, { limit = 20, cursor = null } = {}) {
      if (!Number.isInteger(limit) || limit < 1 || limit > 50) invalid()
      const position = decodeCursor(cursor)
      const rows = (await pool.query(`SELECT h.* FROM histories h WHERE h.app_id=$1
        AND EXISTS (SELECT 1 FROM history_players p WHERE p.history_id=h.id AND p.user_id=$2)
        AND ($3::timestamptz IS NULL OR (h.ended_at,h.id) < ($3::timestamptz,$4::uuid))
        ORDER BY h.ended_at DESC,h.id DESC LIMIT $5`, [appId, userId, position?.[0] ?? null, position?.[1] ?? null, limit + 1])).rows
      const items = await present(rows.slice(0, limit))
      const last = items.at(-1)
      return { items, nextCursor: rows.length > limit ? Buffer.from(JSON.stringify([last.endedAt, last.id])).toString('base64url') : null }
    },
    get: (userId, id) => detail(userId, id, false),
    forRoom: (userId, roomId) => detail(userId, roomId, true)
  }
}

module.exports = { createHistoryStore, saveHistory }
