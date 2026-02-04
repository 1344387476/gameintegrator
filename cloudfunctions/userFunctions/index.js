const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  const { action, userData } = event

  // --- 动作 1：静默获取用户信息（用于判断新老用户） ---
  if (action === 'getUserInfo') {
    try {
      const userRes = await db.collection('users').doc(OPENID).get().catch(() => null)
      if (userRes) {
        return { 
          success: true, 
          isNewUser: false, 
          userInfo: userRes.data,
          currentRoomId: userRes.data.currentRoomId,
          openid: OPENID
        }
      } else {
        return { 
          success: true, 
          isNewUser: true, // 新用户
          currentRoomId: null,
          openid: OPENID
        }
      }
    } catch (e) {
      return { success: false, error: e }
    }
  }

  // --- 动作 2：授权登录/更新资料 ---
  if (action === 'login') {
    try {
      // 构建更新数据，只更新非空字段，避免覆盖原有数据
      const updateData = {
        nickname: userData.nickName,
        avatar: userData.avatarUrl
      }
      
      // 只在 avatarFileID 有值时才更新，避免清空已有数据
      if (userData.avatarFileID) {
        updateData.avatarFileID = userData.avatarFileID
      }
      
      // 使用 update 而非 set，避免覆盖其他字段
      await db.collection('users').doc(OPENID).update({
        data: updateData
      })
      
      return { success: true, openid: OPENID }
    } catch (e) {
      return { success: false, error: e }
    }
  }
}