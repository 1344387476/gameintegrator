const { randomInt, randomUUID } = require('node:crypto')
const { ApiError } = require('./errors')
const { withTransaction } = require('./database')
const { currentRoomId, bumpRoom } = require('./room-state')
const { createRoomCommandExecutor } = require('./room-command')
const { saveHistory } = require('./history-store')
const { assertBalanced } = require('./score')
const { roomIdFromScene } = require('./qrcode')

function generateRoomCode() {
  return randomInt(36 ** 6).toString(36).padStart(6, '0').toUpperCase()
}

function receipt(room, deleted = false) {
  return { roomId: room.id, roomCode: room.room_code, stateVersion: Number(room.state_version), deleted }
}

function requireActive(room) {
  if (!room) throw new ApiError(404, 'ROOM_NOT_FOUND', '房间不存在或邀请已失效')
  if (room.status !== 'active') throw new ApiError(409, 'ROOM_ENDED', '房间已结束')
}

function createRoomStore(pool, appId, { makeCode = generateRoomCode } = {}) {
  const command = createRoomCommandExecutor(pool, appId)
  const byId = roomId => client => client.query('SELECT * FROM rooms WHERE app_id = $1 AND id = $2 FOR UPDATE', [appId, roomId])

  async function insertMember(client, roomId, user, seat) {
    await client.query(`INSERT INTO room_members(room_id, user_id, app_id, seat, nickname, avatar_file_id)
      VALUES ($1, $2, $3, $4, $5, $6)`, [roomId, user.id, appId, seat, user.nickname, user.avatar_file_id])
  }
  async function requireMembership(client, roomId, userId, allowExited = false) {
    const member = (await client.query('SELECT * FROM room_members WHERE room_id = $1 AND user_id = $2', [roomId, userId])).rows[0]
    if (!member || (!allowExited && member.is_exited)) throw new ApiError(403, 'ROOM_MEMBER_REQUIRED', '只有在房玩家可以操作')
    return member
  }
  async function join(client, room, user) {
    requireActive(room)
    const current = await currentRoomId(client, user.id)
    if (current && current !== room.id) throw new ApiError(409, 'ALREADY_IN_ROOM', '请先退出当前房间')
    const members = (await client.query('SELECT * FROM room_members WHERE room_id = $1 ORDER BY seat', [room.id])).rows
    const member = members.find(item => item.user_id === user.id)
    if (member && !member.is_exited && current === room.id) return receipt(room)
    if (member) {
      // 原席位、积分不变，只恢复在房状态并同步用户当前资料。
      await client.query(`UPDATE room_members SET is_exited = false, nickname = $3, avatar_file_id = $4
        WHERE room_id = $1 AND user_id = $2`, [room.id, user.id, user.nickname, user.avatar_file_id])
    } else {
      if (members.length >= 8) throw new ApiError(409, 'ROOM_FULL', '本局已达到8位参与者上限')
      await insertMember(client, room.id, user, members.length + 1)
    }
    await client.query('INSERT INTO active_room_memberships(user_id, room_id) VALUES ($1, $2)', [user.id, room.id])
    return receipt(await bumpRoom(client, room.id))
  }
  async function snapshot(client, room, userId) {
    if (!room) throw new ApiError(404, 'ROOM_NOT_FOUND', '房间不存在或无权访问')
    const current = await currentRoomId(client, userId)
    if (current !== room.id || room.status !== 'active') throw new ApiError(404, 'ROOM_NOT_FOUND', '房间不存在或无权访问')
    await requireMembership(client, room.id, userId)
    const members = (await client.query('SELECT * FROM room_members WHERE room_id = $1 ORDER BY seat', [room.id])).rows
    return {
      id: room.id, roomCode: room.room_code, roomName: room.room_name, mode: room.mode,
      status: room.status, ownerId: room.owner_user_id, stateVersion: Number(room.state_version), maxPlayers: 8,
      pot: Number(room.pot), baseBetValue: room.base_bet_value === null ? null : Number(room.base_bet_value),
      createdAt: new Date(room.created_at).toISOString(), updatedAt: new Date(room.updated_at).toISOString(),
      players: members.map(member => ({ userId: member.user_id, nickname: member.nickname,
        avatarFileId: member.avatar_file_id, score: Number(member.score), isExited: member.is_exited, seat: member.seat,
        lastDepositAmount: member.last_deposit_amount === null ? null : Number(member.last_deposit_amount),
        lastDepositAt: member.last_deposit_at ? new Date(member.last_deposit_at).toISOString() : null }))
    }
  }
  return {
    create(userId, { operationId, roomName, mode }) {
      return command(userId, operationId, 'create', { roomName, mode }, null, async (client, unused, user) => {
        if (await currentRoomId(client, userId)) throw new ApiError(409, 'ALREADY_IN_ROOM', '请先退出当前房间')
        let room
        for (let attempt = 0; attempt < 5; attempt++) {
          room = (await client.query(`INSERT INTO rooms(id, app_id, room_code, room_name, mode, owner_user_id)
            VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (app_id, room_code) DO NOTHING RETURNING *`,
          [randomUUID(), appId, makeCode(), roomName, mode, userId])).rows[0]
          if (room) break
        }
        if (!room) throw new ApiError(503, 'ROOM_CODE_UNAVAILABLE', '房间号分配繁忙，请稍后重试')
        await insertMember(client, room.id, user, 1)
        await client.query('INSERT INTO active_room_memberships(user_id, room_id) VALUES ($1, $2)', [userId, room.id])
        return receipt(room)
      })
    },
    joinByCode(userId, { operationId, roomCode }) {
      return command(userId, operationId, 'join_code', { roomCode },
        client => client.query('SELECT * FROM rooms WHERE app_id = $1 AND room_code = $2 FOR UPDATE', [appId, roomCode]), join)
    },
    joinById(userId, roomId, { operationId }) {
      return command(userId, operationId, 'join_id', { roomId }, byId(roomId), join)
    },
    joinByScene(userId, { operationId, scene }) {
      const roomId = roomIdFromScene(scene)
      return command(userId, operationId, 'join_scene', { scene }, byId(roomId), join)
    },
    settle(userId, roomId, { operationId }) {
      return command(userId, operationId, 'settle', { roomId }, byId(roomId), async (client, room) => {
        requireActive(room)
        await requireMembership(client, roomId, userId)
        if (room.owner_user_id !== userId) throw new ApiError(403, 'ROOM_OWNER_REQUIRED', '只有房主可以结算')
        if (await currentRoomId(client, userId) !== roomId) throw new ApiError(403, 'ROOM_MEMBER_REQUIRED', '只有在房玩家可以操作')
        if (BigInt(room.pot) !== 0n) throw new ApiError(409, 'POT_NOT_EMPTY', '请先领完奖池再结算')
        const members = (await client.query('SELECT * FROM room_members WHERE room_id=$1 ORDER BY seat FOR UPDATE', [roomId])).rows
        assertBalanced(room, members)
        const updated = await bumpRoom(client, roomId)
        const historyId = await saveHistory(client, updated, members, userId)
        await client.query("UPDATE rooms SET status='settled' WHERE id=$1", [roomId])
        // 只清除此局的关联，退出后已经加入别局的人不受影响。
        await client.query('DELETE FROM active_room_memberships WHERE room_id=$1', [roomId])
        await client.query('DELETE FROM room_qrcodes WHERE room_id=$1', [roomId])
        return { ...receipt(updated), historyId }
      })
    },
    dismiss(userId, roomId, { operationId }) {
      return command(userId, operationId, 'dismiss', { roomId }, byId(roomId), async (client, room) => {
        requireActive(room)
        await requireMembership(client, roomId, userId)
        if (room.owner_user_id !== userId) throw new ApiError(403, 'ROOM_OWNER_REQUIRED', '只有房主可以解散')
        if (await currentRoomId(client, userId) !== roomId) throw new ApiError(403, 'ROOM_MEMBER_REQUIRED', '只有在房玩家可以操作')
        const updated = await bumpRoom(client, roomId)
        await client.query('DELETE FROM rooms WHERE id=$1', [roomId])
        return receipt(updated, true)
      })
    },
    leave(userId, roomId, { operationId }) {
      return command(userId, operationId, 'leave', { roomId }, byId(roomId), async (client, room) => {
        requireActive(room)
        const member = await requireMembership(client, room.id, userId, true)
        if (member.is_exited) return receipt(room)
        await client.query('DELETE FROM active_room_memberships WHERE user_id = $1 AND room_id = $2', [userId, roomId])
        await client.query('UPDATE room_members SET is_exited = true WHERE room_id = $1 AND user_id = $2', [roomId, userId])
        const remaining = (await client.query('SELECT user_id FROM room_members WHERE room_id = $1 AND NOT is_exited ORDER BY seat', [roomId])).rows
        const updated = await bumpRoom(client, roomId)
        if (!remaining.length) {
          await client.query('DELETE FROM rooms WHERE id = $1', [roomId])
          return receipt(updated, true)
        }
        if (room.owner_user_id === userId) {
          await client.query('UPDATE rooms SET owner_user_id = $2 WHERE id = $1', [roomId, remaining[0].user_id])
        }
        return receipt(updated)
      })
    },
    transferOwner(userId, roomId, { operationId, toUserId }) {
      return command(userId, operationId, 'transfer_owner', { roomId, toUserId }, byId(roomId), async (client, room) => {
        requireActive(room)
        await requireMembership(client, roomId, userId)
        if (room.owner_user_id !== userId) throw new ApiError(403, 'ROOM_OWNER_REQUIRED', '只有房主可以转交房主')
        await requireMembership(client, roomId, toUserId)
        if (toUserId === userId) return receipt(room)
        await client.query('UPDATE rooms SET owner_user_id = $2 WHERE id = $1', [roomId, toUserId])
        return receipt(await bumpRoom(client, roomId))
      })
    },
    get(userId, roomId) {
      // 共享房间锁保证资料、成员、版本来自同一状态，不读到一半新一半旧。
      return withTransaction(pool, async client => {
        const room = (await client.query('SELECT * FROM rooms WHERE app_id = $1 AND id = $2 FOR SHARE', [appId, roomId])).rows[0]
        return snapshot(client, room, userId)
      })
    },
    current(userId) {
      return withTransaction(pool, async client => {
        const room = (await client.query(`SELECT r.* FROM rooms r JOIN active_room_memberships a ON a.room_id = r.id
          WHERE r.app_id = $1 AND a.user_id = $2 AND r.status = 'active' FOR SHARE OF r`, [appId, userId])).rows[0]
        if (!room || await currentRoomId(client, userId) !== room.id) return null
        return snapshot(client, room, userId)
      })
    }
  }
}

module.exports = { createRoomStore }
