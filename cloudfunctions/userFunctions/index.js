const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

/**
 * 生成默认昵称
 * @returns {string} 默认昵称，格式：玩家 + 3位随机数
 */
function generateDefaultNickname() {
  return '玩家' + Math.floor(100 + Math.random() * 900)
}

/**
 * 获取默认头像URL
 * @returns {string} 默认头像URL
 */
function getDefaultAvatar() {
  return ''
}

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  const { action, userData } = event

  // ==================== 动作 1：获取用户信息（初始化时调用）====================
  if (action === 'getUserInfo') {
    try {
      const userRes = await db.collection('users').doc(OPENID).get().catch(() => null)

      if (userRes && userRes.data) {
        // 已有用户，直接返回信息
        return {
          success: true,
          isNewUser: false,
          userInfo: {
            nickname: userRes.data.nickname || '',
            avatar: userRes.data.avatar || '',
            avatarFileID: userRes.data.avatarFileID || ''
          },
          currentRoomId: userRes.data.currentRoomId || null,
          openid: OPENID
        }
      } else {
        // 新用户，创建默认用户资料
        const defaultNickname = generateDefaultNickname()
        const defaultAvatar = getDefaultAvatar()

        const newUserData = {
          _id: OPENID,
          nickname: defaultNickname,
          avatar: defaultAvatar,
          avatarFileID: '',
          currentRoomId: null,
          createTime: db.serverDate(),
          updateTime: db.serverDate()
        }

        await db.collection('users').add({
          data: newUserData
        })

        console.log('新用户创建成功:', OPENID, defaultNickname)

        return {
          success: true,
          isNewUser: true,
          userInfo: {
            nickname: defaultNickname,
            avatar: defaultAvatar,
            avatarFileID: ''
          },
          currentRoomId: null,
          openid: OPENID
        }
      }
    } catch (e) {
      console.error('getUserInfo 失败:', e)
      return { success: false, error: e.message || e }
    }
  }

  // ==================== 动作 2：更新用户信息（创建/加入房间、编辑资料时调用）====================
  if (action === 'updateUserInfo') {
    try {
      // 参数校验
      if (!userData) {
        return { success: false, error: '缺少 userData 参数' }
      }

      // 构建更新数据（只更新提供的字段）
      const updateData = {}

      // 昵称：如果提供了就更新
      if (userData.nickname !== undefined) {
        updateData.nickname = userData.nickname
      }

      // 头像URL：如果提供了就更新
      if (userData.avatar !== undefined) {
        updateData.avatar = userData.avatar
      }

      // 头像FileID：如果提供了就更新（包括空字符串）
      if (userData.avatarFileID !== undefined) {
        updateData.avatarFileID = userData.avatarFileID
      }

      // 如果没有要更新的字段
      if (Object.keys(updateData).length === 0) {
        return { success: false, error: '没有要更新的字段' }
      }

      // 添加更新时间
      updateData.updateTime = db.serverDate()

      // 先检查用户是否存在
      const userRes = await db.collection('users').doc(OPENID).get().catch(() => null)

      if (userRes && userRes.data) {
        // 用户存在，执行更新
        await db.collection('users').doc(OPENID).update({
          data: updateData
        })
      } else {
        // 用户不存在，创建新记录（兜底逻辑，正常情况下不应发生）
        updateData._id = OPENID
        updateData.createTime = db.serverDate()
        updateData.currentRoomId = null

        // 补充必要字段
        if (!updateData.nickname) {
          updateData.nickname = generateDefaultNickname()
        }
        if (updateData.avatar === undefined) {
          updateData.avatar = ''
        }
        if (updateData.avatarFileID === undefined) {
          updateData.avatarFileID = ''
        }

        await db.collection('users').add({
          data: updateData
        })
      }

      console.log('用户信息更新成功:', OPENID, updateData)

      return {
        success: true,
        openid: OPENID,
        updatedFields: Object.keys(updateData).filter(k => k !== 'updateTime')
      }
    } catch (e) {
      console.error('updateUserInfo 失败:', e)
      return { success: false, error: e.message || e }
    }
  }

  // ==================== 动作 3：获取用户当前房间状态（保留，用于检查）====================
  if (action === 'getUserRoomStatus') {
    try {
      const userRes = await db.collection('users').doc(OPENID).get().catch(() => null)

      if (!userRes || !userRes.data) {
        return { success: true, inRoom: false, roomId: null }
      }

      const currentRoomId = userRes.data.currentRoomId

      if (!currentRoomId) {
        return { success: true, inRoom: false, roomId: null }
      }

      // 检查房间是否存在且活跃
      const roomRes = await db.collection('rooms').doc(currentRoomId).get().catch(() => null)

      if (roomRes && roomRes.data && roomRes.data.status === 'active') {
        // 检查用户是否还在房间内
        const isInRoom = roomRes.data.players.some(p => p.openid === OPENID && !p.isExited)

        if (isInRoom) {
          return { success: true, inRoom: true, roomId: currentRoomId }
        } else {
          // 用户已不在房间中，清理状态
          await db.collection('users').doc(OPENID).update({
            data: { currentRoomId: null }
          })
          return { success: true, inRoom: false, roomId: null }
        }
      } else {
        // 房间不存在或已结束，清理状态
        await db.collection('users').doc(OPENID).update({
          data: { currentRoomId: null }
        })
        return { success: true, inRoom: false, roomId: null }
      }
    } catch (e) {
      console.error('getUserRoomStatus 失败:', e)
      return { success: false, error: e.message || e }
    }
  }

  // 未知动作
  return { success: false, error: '未知动作: ' + action }
}