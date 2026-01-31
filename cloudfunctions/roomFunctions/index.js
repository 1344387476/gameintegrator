const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  const { action, payload } = event

  try {
    const userRef = db.collection('users').doc(OPENID)

    // === 动作 1：获取用户当前状态 (自愈系统) ===
    if (action === 'checkUserStatus') {
      const userRes = await userRef.get().catch(() => ({ data: {} }))
      const roomId = userRes.data ? userRes.data.currentRoomId : null

      if (!roomId) return { success: true, inRoom: false }

      const roomRes = await db.collection('rooms').doc(roomId).get().catch(() => null)
      
      // 判定逻辑：如果房间不存在，或者房间已结算且超过1小时
      //（这里 checkUserStatus 发现过期也会清理用户状态）
      if (!roomRes) {
        await userRef.update({ data: { currentRoomId: null } })
        return { success: true, inRoom: false }
      }

      const room = roomRes.data
      // 如果房间已结算，检查是否超过1小时（物理删除交由定时器或后续逻辑，这里先判定为不可用）
      if (room.status === 'settled') {
         // 前端收到 settled 状态可以展示结算页，但不能再进行转账
         return { success: true, inRoom: true, status: 'settled', roomInfo: room }
      }

      return { success: true, inRoom: true, status: 'active', roomInfo: room }
    }

    // === 动作 A：加入房间 ===
    if (action === 'join') {
      const { roomId, nickname, avatar } = payload
      
      // 先检查房间是否存在（非事务查询）
      const roomCheck = await db.collection('rooms').doc(roomId).get().catch(() => null)
      
      if (!roomCheck || !roomCheck.data) {
        throw new Error('房间不存在')
      }

      const room = roomCheck.data
      
      // 检查房间状态
      if (room.status !== 'active') {
        throw new Error('房间已结束，无法加入')
      }

      // 检查玩家数量
      if (room.players.length >= 8) {
        throw new Error('房间人数已达上限（8人）')
      }

      // 检查是否已在房间中
      const existingPlayer = room.players.find(p => p.openid === OPENID)
      if (existingPlayer && !existingPlayer.isExited) {
        throw new Error('您已在房间中')
      }

      // 启动事务
      const transaction = await db.startTransaction()
      try {
        // 添加玩家到房间
        const players = room.players

        // 如果是已退出的玩家，重新加入
        const exitedPlayerIdx = players.findIndex(p => p.openid === OPENID)
        if (exitedPlayerIdx > -1) {
          players[exitedPlayerIdx].isExited = false
          players[exitedPlayerIdx].nickname = nickname
          players[exitedPlayerIdx].avatar = avatar
        } else {
          // 新玩家加入
          players.push({
            openid: OPENID,
            nickname: nickname,
            avatar: avatar,
            score: 0,
            isExited: false
          })
        }

        await transaction.collection('rooms').doc(roomId).update({
          data: { players }
        })

        // 更新用户的 currentRoomId
        await transaction.collection('users').doc(OPENID).update({
          data: { currentRoomId: roomId }
        })

        // 写入欢迎消息到 messages 集合
        await transaction.collection('messages').add({
          data: {
            roomId,
            fromOpenid: OPENID,
            fromNickname: nickname,
            fromAvatar: avatar,
            content: `欢迎 ${nickname} 进入房间【${room.roomName}】`,
            displayContent: `${nickname} 进入了房间`,
            messageType: 'welcome',
            timestamp: db.serverDate()
          }
        })

        await transaction.commit()
        return { success: true }
      } catch (error) {
        await transaction.rollback()
        throw error
      }
    }

    // === 动作 B：创建房间 ===
    if (action === 'create') {
      // 检查用户是否在其他活跃房间中
      const userRes = await db.collection('users').doc(OPENID).get().catch(() => ({ data: null }))
      if (userRes.data && userRes.data.currentRoomId) {
        const oldRoomRes = await db.collection('rooms').doc(userRes.data.currentRoomId).get().catch(() => null)
        if (oldRoomRes && oldRoomRes.data && oldRoomRes.data.status === 'active') {
          throw new Error('您当前已在其他活跃房间中')
        }
      }

      const roomId = Math.random().toString(36).substr(2, 6).toUpperCase()

      // 启动事务
      const transaction = await db.startTransaction()
      try {
        await transaction.collection('rooms').doc(roomId).set({
          data: {
            owner: OPENID,
            roomName: payload.roomName,
            mode: payload.mode,
            status: 'active',
            pot: 0,
            lastActiveTime: db.serverDate(),
            createTime: db.serverDate(),
            players: [{
              openid: OPENID,
              nickname: payload.nickname,
              avatar: payload.avatar,
              score: 0,
              isExited: false
            }]
          }
        })
        await transaction.collection('users').doc(OPENID).update({ data: { currentRoomId: roomId } })

        // 写入欢迎消息到 messages 集合
        await transaction.collection('messages').add({
          data: {
            roomId,
            fromOpenid: OPENID,
            fromNickname: payload.nickname,
            fromAvatar: payload.avatar,
            content: `欢迎 ${payload.nickname} 创建了房间【${payload.roomName}】`,
            displayContent: `${payload.nickname} 创建了房间`,
            messageType: 'welcome',
            timestamp: db.serverDate()
          }
        })

        await transaction.commit()
        return { success: true, roomId }
      } catch (error) {
        await transaction.rollback()
        throw error
      }
    }
    if (action === 'leave') {
      const { roomId } = payload

      // 先检查房间是否存在（非事务查询）
      const roomExists = await db.collection('rooms').doc(roomId).get().catch(() => null)

      let isLastUser = false

      if (roomExists && roomExists.data) {
        // 房间存在，启动事务处理房间相关操作
        const transaction = await db.startTransaction()
        try {
          const roomRes = await transaction.collection('rooms').doc(roomId).get()
          const room = roomRes.data

          if (room) {
            let players = room.players
            const idx = players.findIndex(p => p.openid === OPENID)

            if (idx > -1) {
              // 检查是否为最后一个玩家（不管是否活跃）
              const playersAfterRemove = [...players]
              playersAfterRemove.splice(idx, 1)

              if (playersAfterRemove.length === 0) {
                // 如果是最后一个玩家，删除房间
                await transaction.collection('rooms').doc(roomId).remove()
                // 消息不在这里删除，由定时任务清理，避免事务超时
              } else {
                // 如果不是最后一个玩家，正常标记退出
                let newOwner = room.owner
                if (newOwner === OPENID) {
                  // 房主退出，转移给第一个活跃玩家
                  newOwner = playersAfterRemove.find(p => p.openid !== OPENID && !p.isExited)?.openid || OPENID
                }
                await transaction.collection('rooms').doc(roomId).update({
                  data: { players: playersAfterRemove, owner: newOwner }
                })
              }
            }
          }

          await transaction.commit()

          // 判断是否是最后一个用户（在事务提交后）
          isLastUser = roomExists && roomExists.data && roomExists.data.players && roomExists.data.players.length <= 1
        } catch (error) {
          await transaction.rollback()
          throw error
        }
      }

      // 清理用户的 currentRoomId（非事务操作，移到最后执行）
      await db.collection('users').doc(OPENID).update({ data: { currentRoomId: null } })

      return { success: true, isLastUser }
    }

    // === 动作 D：结算 (更新状态 + 存历史 + 标记删除时间) ===
    if (action === 'settle') {
      const { roomId } = payload
      
      // 先检查房间是否存在（非事务查询）
      const roomCheck = await db.collection('rooms').doc(roomId).get().catch(() => null)
      
      if (!roomCheck || !roomCheck.data) {
        throw new Error('房间不存在')
      }
      
      if (roomCheck.data.owner !== OPENID) throw new Error('权限不足')
      
      // 房间存在且用户有权限，启动事务
      const transaction = await db.startTransaction()
      try {
        const roomRes = await transaction.collection('rooms').doc(roomId).get()
        const room = roomRes.data
        
        if (!room) {
          throw new Error('房间不存在')
        }

        // 1. 存入历史战绩
        await transaction.collection('history').add({
          data: {
            roomId,
            roomName: room.roomName,
            endTime: db.serverDate(),
            players: room.players,
            mode: room.mode
          }
        })

        // 2. 更新房间状态为 settled，并设置 1小时后的删除时间戳
        const deleteAt = Date.now() + 3600000
        await transaction.collection('rooms').doc(roomId).update({
          data: {
            status: 'settled',
            deleteTime: deleteAt
          }
        })

        // 3. 释放房主状态
        await transaction.collection('users').doc(OPENID).update({ data: { currentRoomId: null } })
        await transaction.commit()
        return { success: true, msg: '结算完成，房间将于1小时后自动销毁' }
      } catch (error) {
        await transaction.rollback()
        throw error
      }
    }

    // === 动作 E：解散 (物理删除 + 不存战绩) ===
    if (action === 'dismiss') {
      const { roomId } = payload
      
      // 先检查房间是否存在（非事务查询）
      const roomCheck = await db.collection('rooms').doc(roomId).get().catch(() => null)
      
      if (!roomCheck || !roomCheck.data) {
        throw new Error('房间不存在')
      }
      
      if (roomCheck.data.owner !== OPENID) throw new Error('权限不足')
      
      // 房间存在且用户有权限，启动事务
      const transaction = await db.startTransaction()
      try {
        // 直接删除房间
        await transaction.collection('rooms').doc(roomId).remove()
        // 释放房主状态
        await transaction.collection('users').doc(OPENID).update({ data: { currentRoomId: null } })
        await transaction.commit()
        return { success: true, msg: '房间已直接销毁' }
      } catch (error) {
        await transaction.rollback()
        throw error
      }
    }
  } catch (e) {
    return { success: false, msg: e.message }
  }
}