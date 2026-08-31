const { randomUUID } = require('node:crypto')
const { ApiError } = require('./errors')
const { withTransaction } = require('./database')
const { createRoomCommandExecutor } = require('./room-command')
const { bumpRoom, currentRoomId } = require('./room-state')
const { normalizeScoreCommand, calculateScore, UUID } = require('./score')

function createScoreStore(pool, appId) {
  const command = createRoomCommandExecutor(pool, appId)
  return {
    execute(userId, roomId, input) {
      if (typeof roomId !== 'string' || !UUID.test(roomId)) throw new ApiError(400, 'INVALID_REQUEST', '房间编号无效')
      const normalized = normalizeScoreCommand(input)
      const { operationId, action, payload } = normalized
      return command(userId, operationId, action, { roomId, payload },
        client => client.query('SELECT * FROM rooms WHERE app_id = $1 AND id = $2 FOR UPDATE', [appId, roomId]),
        async (client, room) => {
          if (!room) throw new ApiError(404, 'ROOM_NOT_FOUND', '房间不存在')
          if (room.status !== 'active') throw new ApiError(409, 'ROOM_ENDED', '房间已结束')
          if (await currentRoomId(client, userId) !== roomId) throw new ApiError(403, 'ROOM_MEMBER_REQUIRED', '只有在房玩家可以计分')
          const members = (await client.query('SELECT * FROM room_members WHERE room_id = $1 ORDER BY seat FOR UPDATE', [roomId])).rows
          const result = calculateScore(room, members, userId, normalized)
          for (const change of result.changes) {
            await client.query('UPDATE room_members SET score = $3 WHERE room_id = $1 AND user_id = $2', [roomId, change.member.user_id, change.after.toString()])
          }
          if (result.deposit) {
            await client.query(`UPDATE room_members SET last_deposit_amount = $3, last_deposit_at = now()
              WHERE room_id = $1 AND user_id = $2`, [roomId, userId, result.amount.toString()])
          }
          await client.query('UPDATE rooms SET pot = $2, base_bet_value = $3 WHERE id = $1', [roomId, result.pot.toString(), result.baseBetValue?.toString() ?? null])
          const updated = await bumpRoom(client, roomId)
          const entryId = randomUUID()
          await client.query(`INSERT INTO score_ledger(id,room_id,actor_user_id,operation_id,action,state_version,amount,
            pot_before,pot_after,base_bet_before,base_bet_after,actor_nickname,actor_avatar_file_id)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
          [entryId, roomId, userId, operationId, action, updated.state_version, result.amount.toString(),
            room.pot, result.pot.toString(), room.base_bet_value, result.baseBetValue?.toString() ?? null,
            result.actor.nickname, result.actor.avatar_file_id])
          for (const change of result.changes) {
            await client.query(`INSERT INTO score_ledger_changes(entry_id,user_id,nickname,avatar_file_id,score_before,score_after)
              VALUES ($1,$2,$3,$4,$5,$6)`, [entryId, change.member.user_id, change.member.nickname,
              change.member.avatar_file_id, change.before.toString(), change.after.toString()])
          }
          // 最小回执长期去重，不保存奖池/积分/个人资料；客户端必须重新读取最新快照。
          return { roomId, stateVersion: Number(updated.state_version), ledgerEntryId: entryId }
        })
    },
    async list(userId, roomId, { limit = 20, beforeVersion = null } = {}) {
      if (!UUID.test(roomId) || !Number.isInteger(limit) || limit < 1 || limit > 50 ||
        (beforeVersion !== null && (typeof beforeVersion !== 'string' || !/^[1-9]\d{0,15}$/u.test(beforeVersion) || !Number.isSafeInteger(Number(beforeVersion))))) {
        throw new ApiError(400, 'INVALID_REQUEST', '流水分页参数无效')
      }
      return withTransaction(pool, async client => {
        const room = (await client.query('SELECT id, status FROM rooms WHERE app_id = $1 AND id = $2 FOR SHARE', [appId, roomId])).rows[0]
        const allowed = room?.status === 'active' && (await client.query(`SELECT 1 FROM active_room_memberships a
          JOIN room_members m ON m.room_id=a.room_id AND m.user_id=a.user_id
          WHERE a.room_id=$1 AND a.user_id=$2 AND NOT m.is_exited`, [roomId, userId])).rows.length > 0
        if (!allowed) throw new ApiError(404, 'ROOM_NOT_FOUND', '房间不存在或无权访问')
        const rows = (await client.query(`SELECT * FROM score_ledger WHERE room_id=$1
          AND ($2::bigint IS NULL OR state_version < $2) ORDER BY state_version DESC LIMIT $3`, [roomId, beforeVersion, limit + 1])).rows
        const page = rows.slice(0, limit)
        const changes = page.length ? (await client.query(`SELECT * FROM score_ledger_changes
          WHERE entry_id = ANY($1::uuid[]) ORDER BY entry_id, user_id`, [page.map(entry => entry.id)])).rows : []
        return {
          items: page.map(entry => ({ id: entry.id, roomId: entry.room_id, operationId: entry.operation_id,
            action: entry.action, stateVersion: Number(entry.state_version), amount: Number(entry.amount),
            potBefore: Number(entry.pot_before), potAfter: Number(entry.pot_after),
            baseBetBefore: entry.base_bet_before === null ? null : Number(entry.base_bet_before),
            baseBetAfter: entry.base_bet_after === null ? null : Number(entry.base_bet_after),
            actor: { userId: entry.actor_user_id, nickname: entry.actor_nickname, avatarFileId: entry.actor_avatar_file_id },
            changes: changes.filter(change => change.entry_id === entry.id).map(change => ({ userId: change.user_id,
              nickname: change.nickname, avatarFileId: change.avatar_file_id,
              scoreBefore: Number(change.score_before), scoreAfter: Number(change.score_after) })),
            createdAt: new Date(entry.created_at).toISOString() })),
          nextBeforeVersion: rows.length > limit ? String(page.at(-1).state_version) : null
        }
      })
    }
  }
}

module.exports = { createScoreStore }
