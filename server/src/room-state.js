const { setTimeout: delay } = require('node:timers/promises')
const { randomInt } = require('node:crypto')
const { withTransaction } = require('./database')
const { ApiError } = require('./errors')

async function roomTransaction(pool, execute) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try { return await withTransaction(pool, execute) } catch (error) {
      // 仅重试明确回滚的锁竞争/序列化失败；网络或COMMIT结果未知不自动重放。
      if (!['40P01', '40001', '55P03', 'ROOM_ASSOCIATION_CHANGED'].includes(error.code)) throw error
      if (attempt === 2) throw new ApiError(503, 'ROOM_BUSY', '房间正在更新，请稍后重试')
      await delay(randomInt(10, 40) * (attempt + 1))
    }
  }
}

async function lockUser(client, appId, userId) {
  // 不修改用户主键，使用NO KEY UPDATE，避免与房主/成员外键检查的KEY SHARE互锁。
  const { rows } = await client.query(`SELECT id, nickname, avatar_file_id FROM users
    WHERE app_id = $1 AND id = $2 FOR NO KEY UPDATE`, [appId, userId])
  if (!rows[0]) throw new ApiError(401, 'AUTH_REQUIRED', '请重新登录')
  return rows[0]
}

async function currentRoomId(client, userId) {
  const { rows } = await client.query('SELECT room_id FROM active_room_memberships WHERE user_id = $1', [userId])
  return rows[0]?.room_id || null
}

async function bumpRoom(client, roomId) {
  const { rows } = await client.query(`UPDATE rooms SET state_version = state_version + 1, updated_at = now()
    WHERE id = $1 AND state_version < 9007199254740991 RETURNING *`, [roomId])
  if (!rows[0]) throw new ApiError(409, 'ROOM_VERSION_EXHAUSTED', '房间版本已达上限')
  return rows[0]
}

async function withProfileRoom(pool, appId, userId, execute) {
  return roomTransaction(pool, async client => {
    const observed = await currentRoomId(client, userId)
    let room
    if (observed) {
      room = (await client.query('SELECT * FROM rooms WHERE app_id = $1 AND id = $2 FOR UPDATE', [appId, observed])).rows[0]
    }
    // 所有已有房间操作统一先锁房间、再锁调用者，不能反过来。
    const user = await lockUser(client, appId, userId)
    const current = await currentRoomId(client, userId)
    if (observed !== current) throw Object.assign(new Error('room association changed'), { code: 'ROOM_ASSOCIATION_CHANGED' })
    if (current && (!room || room.status !== 'active')) throw new ApiError(409, 'ROOM_STATE_INVALID', '房间关联异常，请稍后重试')
    if (current) {
      const member = (await client.query('SELECT is_exited FROM room_members WHERE room_id = $1 AND user_id = $2', [current, userId])).rows[0]
      if (!member || member.is_exited) throw new ApiError(409, 'ROOM_STATE_INVALID', '房间关联异常，请稍后重试')
    }
    const result = await execute(client, user)
    if (current) {
      const changed = await client.query(`UPDATE room_members SET nickname = $3, avatar_file_id = $4
        WHERE room_id = $1 AND user_id = $2 AND NOT is_exited
        AND (nickname IS DISTINCT FROM $3 OR avatar_file_id IS DISTINCT FROM $4) RETURNING user_id`,
      [current, userId, result.row.nickname, result.row.avatar_file_id])
      if (changed.rows.length) await bumpRoom(client, current)
    }
    result.row.current_room_id = current
    return result
  })
}

module.exports = { roomTransaction, lockUser, currentRoomId, bumpRoom, withProfileRoom }
