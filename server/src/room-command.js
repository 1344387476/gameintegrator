const { createHash } = require('node:crypto')
const { ApiError } = require('./errors')
const { roomTransaction, lockUser } = require('./room-state')

// 房间生命周期与计分共用操作编号空间、锁顺序和提交方式。
function createRoomCommandExecutor(pool, appId) {
  return async (userId, operationId, action, args, locateRoom, execute) => {
    const hash = createHash('sha256').update(JSON.stringify([action, args])).digest('hex')
    return roomTransaction(pool, async client => {
      const room = locateRoom ? (await locateRoom(client)).rows[0] : null
      const user = await lockUser(client, appId, userId)
      const previous = (await client.query('SELECT action, request_hash, result FROM room_commands WHERE user_id = $1 AND operation_id = $2', [userId, operationId])).rows[0]
      if (previous) {
        if (previous.action !== action || previous.request_hash !== hash) throw new ApiError(409, 'OPERATION_CONFLICT', '操作编号已用于其他请求，请勿更换原请求参数')
        return { ...previous.result, duplicated: true }
      }
      const result = await execute(client, room, user)
      await client.query(`INSERT INTO room_commands(user_id, operation_id, action, request_hash, result)
        VALUES ($1, $2, $3, $4, $5)`, [userId, operationId, action, hash, JSON.stringify(result)])
      return { ...result, duplicated: false }
    })
  }
}

module.exports = { createRoomCommandExecutor }
