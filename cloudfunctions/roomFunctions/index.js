const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  const { action, payload } = event

  try {
    // === 功能 1：创建房间 ===
    if (action === 'create') {
      const roomId = Math.random().toString(36).substr(2, 6).toUpperCase()
      await db.collection('rooms').add({
        data: {
          _id: roomId,
          owner: OPENID,
          roomName: payload.roomName,
          mode: payload.mode,
          allInVal: payload.allInVal || 0,
          pot: 0,
          status: 'active',
          lastActiveTime: db.serverDate(),
          players: [{
            openid: OPENID,
            nickname: payload.nickname,
            avatar: payload.avatar,
            score: 0,
            isExited: false // 标记是否已中途退出
          }]
        }
      })
      // 同步更新用户状态
      await db.collection('users').doc(OPENID).update({ data: { currentRoomId: roomId } })
      return { success: true, roomId }
    }

    // === 功能 2：退出房间 (含房主继承) ===
    if (action === 'leave') {
      const { roomId } = payload
      return await db.runTransaction(async transaction => {
        const roomRes = await transaction.get(db.collection('rooms').doc(roomId))
        const room = roomRes.data
        let players = room.players
        
        // 1. 找到当前用户在列表中的索引
        const userIdx = players.findIndex(p => p.openid === OPENID)
        if (userIdx === -1) return { success: false, msg: '不在房间中' }

        // 2. 标记该用户为“已退出”
        players[userIdx].isExited = true
        
        // 3. 房主权限继承逻辑
        let newOwner = room.owner
        if (room.owner === OPENID) {
          // 寻找第一个还没彻底退出的玩家
          const nextPlayer = players.find(p => p.openid !== OPENID && !p.isExited)
          if (nextPlayer) {
            newOwner = nextPlayer.openid
          } else {
            // 如果没人在房间了，直接解散
            await transaction.update(db.collection('rooms').doc(roomId), { data: { status: 'dissolved' } })
          }
        }

        // 4. 更新房间数据
        await transaction.update(db.collection('rooms').doc(roomId), {
          data: { 
            players: players,
            owner: newOwner,
            lastActiveTime: db.serverDate()
          }
        })
        
        // 5. 解绑用户当前的房间状态
        await transaction.update(db.collection('users').doc(OPENID), { data: { currentRoomId: null } })
        
        return { success: true }
      })
    }

    // === 功能 3：主动结算 (仅房主) ===
    if (action === 'settle') {
      const { roomId } = payload
      const roomRes = await db.collection('rooms').doc(roomId).get()
      const room = roomRes.data

      if (room.owner !== OPENID) throw new Error('只有房主可以结算')
      if (room.pot > 0) throw new Error('奖池尚有积分，请先收回')

      // A. 执行你写的 Winners/Losers 归类逻辑 (生成快照)
      const winners = room.players.filter(p => p.score > 0)
      const losers = room.players.filter(p => p.score < 0)

      // B. 存入历史战绩
      await db.collection('history').add({
        data: {
          roomId,
          roomName: room.roomName,
          mode: room.mode,
          endTime: db.serverDate(),
          winners,
          losers
        }
      })

      // C. 变更状态 & 物理删除流水
      await db.collection('rooms').doc(roomId).update({ data: { status: 'dissolved' } })
      await db.collection('messages').where({ roomId }).remove()
      
      return { success: true }
    }

  } catch (e) {
    return { success: false, msg: e.message }
  }
}