const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  // 参数标准化：使用 action/payload 格式
  const { action, payload } = event
  const { roomId, amount, toOpenid, transferList, nickname, toNickname } = payload || {}

  try {
    // 创建事务（使用新版 API）
    const transaction = await db.startTransaction()
    try {
      // 1. 获取房间实时数据
      let roomRes
      try {
        roomRes = await transaction.collection('rooms').doc(roomId).get()
      } catch (error) {
        throw new Error('房间已不存在')
      }
      
      if (!roomRes.data) throw new Error('房间已不存在')

      let logTasks = [] // 用于记录需要插入 messages 的流水
      const room = roomRes.data
      let players = room.players

      // === A. 批量转账逻辑 (核心新增) ===
      if (action === 'BATCH_TRANSFER') {
        let totalOut = 0
        transferList.forEach(item => {
          totalOut += item.amount
          // 给每个收款人加分
          const receiverPlayer = players.find(p => p.openid === item.openid)
          if (receiverPlayer) {
            receiverPlayer.score += item.amount
          }
          // 准备拆分的流水记录
          logTasks.push({
            content: `转给 ${item.nickname} ${item.amount} 分`,
            toOpenid: item.openid,
            messageType: 'transfer'
          })
        })
        // 扣除转账人的总分
        const senderPlayer = players.find(p => p.openid === OPENID)
        if (senderPlayer) {
          senderPlayer.score -= totalOut
        }
        // 更新整个 players 数组
        await transaction.collection('rooms').doc(roomId).update({
          data: { players }
        })
      }

      // === B. 单人普通转账 ===
      else if (action === 'TRANSFER') {
        const senderPlayer = players.find(p => p.openid === OPENID)
        const receiverPlayer = players.find(p => p.openid === toOpenid)

        if (senderPlayer) {
          senderPlayer.score -= amount
        }
        if (receiverPlayer) {
          receiverPlayer.score += amount
        }
        // 更新整个 players 数组
        await transaction.collection('rooms').doc(roomId).update({
          data: { players }
        })
        logTasks.push({ content: `转给 ${toNickname} ${amount} 分`, toOpenid, messageType: 'transfer' })
      }

      // === C. 下注/All-in (进入奖池) ===
      else if (action === 'BET' || action === 'ALLIN') {
        const player = players.find(p => p.openid === OPENID)
        if (player) {
          player.score -= amount
        }
        // 更新整个 players 数组和奖池
        await transaction.collection('rooms').doc(roomId).update({
          data: {
            players,
            pot: room.pot + amount
          }
        })
        const msgType = action === 'ALLIN' ? 'allin' : 'bet'
        logTasks.push({ content: `${action === 'ALLIN' ? 'All-in' : '下注'} ${amount} 分`, toOpenid: 'POT', messageType: msgType })
      }

      // === D. 领取奖池 ===
      else if (action === 'CLAIM') {
        const potAmount = room.pot
        const player = players.find(p => p.openid === OPENID)
        if (player) {
          player.score += potAmount
        }
        // 更新整个 players 数组和奖池
        await transaction.collection('rooms').doc(roomId).update({
          data: {
            players,
            pot: 0
          }
        })
        logTasks.push({ content: `收走了奖池 ${potAmount} 分`, toOpenid: OPENID, messageType: 'claim' })
      }

      // === E. 跳过回合 ===
      else if (action === 'PASS') {
        logTasks.push({ 
          content: `${nickname} 跳过了这回合`,
          toOpenid: 'PASS',
          messageType: 'pass'
        })
      }

      // 2. 统一写入流水记录 & 更新活跃时间
      const senderAvatar = room.players.find(p => p.openid === OPENID)?.avatar || ''

      // 移出事务，使用数组追加消息
      for (const log of logTasks) {
        let receiverAvatar = ''
        let toNickname = ''

        if (log.toOpenid && log.toOpenid !== 'PASS' && log.toOpenid !== 'POT') {
          const receiverPlayer = room.players.find(p => p.openid === log.toOpenid)
          receiverAvatar = receiverPlayer?.avatar || ''
          toNickname = receiverPlayer?.nickname || ''
        }

        await db.collection('messages').doc(roomId).update({
          data: {
            messages: db.command.push({
              fromOpenid: OPENID,
              fromNickname: nickname,
              fromAvatar: senderAvatar,
              content: log.content,
              messageType: log.messageType,
              toOpenid: log.toOpenid || '',
              toNickname: toNickname,
              toAvatar: receiverAvatar,
              timestamp: db.serverDate()
            })
          }
        })
      }
      await transaction.collection('rooms').doc(roomId).update({
        data: { lastActiveTime: db.serverDate() }
      })

      // 提交事务
      await transaction.commit()
      return { success: true }
    } catch (error) {
      // 发生错误，回滚事务
      await transaction.rollback()
      throw error
    }
  } catch (e) {
    return { success: false, msg: e.message }
  }
}
