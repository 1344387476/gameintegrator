const { ApiError } = require('./errors')
const { UUID } = require('./score')
const { withTransaction } = require('./database')

function roomScene(roomId) {
  if (typeof roomId !== 'string' || !UUID.test(roomId)) throw new ApiError(400, 'INVALID_REQUEST', '房间编号无效')
  return 'r' + Buffer.from(roomId.replaceAll('-', ''), 'hex').toString('base64url')
}
function roomIdFromScene(scene) {
  if (typeof scene !== 'string' || !/^r[A-Za-z0-9_-]{22}$/u.test(scene)) throw new ApiError(400, 'INVALID_REQUEST', '邀请参数无效')
  const hex = Buffer.from(scene.slice(1), 'base64url').toString('hex')
  const id = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
  if (!UUID.test(id) || roomScene(id) !== scene) throw new ApiError(400, 'INVALID_REQUEST', '邀请参数无效')
  return id
}

function createQRCodeService(pool, appId, generate) {
  let pending = null
  async function access(userId, roomId, image) {
    roomScene(roomId)
    return withTransaction(pool, async client => {
      const room = (await client.query('SELECT id,status FROM rooms WHERE app_id=$1 AND id=$2 FOR SHARE', [appId, roomId])).rows[0]
      const member = room?.status === 'active' && (await client.query(`SELECT 1 FROM active_room_memberships a
        JOIN room_members m ON m.room_id=a.room_id AND m.user_id=a.user_id
        WHERE a.room_id=$1 AND a.user_id=$2 AND NOT m.is_exited`, [roomId, userId])).rows.length
      if (!member) throw new ApiError(404, 'ROOM_NOT_FOUND', '房间不存在或无权访问')
      if (image) await client.query('INSERT INTO room_qrcodes(room_id,image) VALUES ($1,$2) ON CONFLICT (room_id) DO NOTHING', [roomId, image])
      const row = (await client.query('SELECT image FROM room_qrcodes WHERE room_id=$1', [roomId])).rows[0]
      return row ? Buffer.from(row.image) : null
    })
  }
  return {
    async read(userId, roomId) {
      const image = await access(userId, roomId)
      if (!image) throw new ApiError(404, 'QRCODE_NOT_READY', '请先生成邀请二维码')
      return image
    },
    async getOrCreate(userId, roomId) {
      const existing = await access(userId, roomId)
      if (existing) return existing
      if (pending && pending.roomId !== roomId) throw new ApiError(503, 'QRCODE_BUSY', '二维码正在生成，请稍后重试')
      if (!pending) {
        // 网络与图像解码在事务之外；单进程只生成一张，同房间请求共享结果。
        const task = { roomId, promise: null }
        task.promise = Promise.resolve().then(() => generate(roomScene(roomId))).finally(() => { if (pending === task) pending = null })
        pending = task
      }
      const image = await pending.promise
      if (!Buffer.isBuffer(image) || image.length === 0 || image.length > 262144) throw new ApiError(502, 'QRCODE_UNAVAILABLE', '二维码生成失败')
      // 网络等待期间可能退出、解散或结算，保存与返回前必须在锁内重新检查。
      return access(userId, roomId, image)
    }
  }
}

module.exports = { createQRCodeService, roomScene, roomIdFromScene }
