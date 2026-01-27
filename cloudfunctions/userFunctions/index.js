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
          currentRoomId: userRes.data.currentRoomId 
        }
      } else {
        return { 
          success: true, 
          isNewUser: true, // 新用户
          currentRoomId: null 
        }
      }
    } catch (e) {
      return { success: false, error: e }
    }
  }

  // --- 动作 2：授权登录/更新资料 ---
  if (action === 'login') {
    try {
      // 使用 upsert 逻辑：有则更新，无则插入
      await db.collection('users').doc(OPENID).set({
        data: {
          nickname: userData.nickName,
          avatar: userData.avatarUrl,
          // 如果是新用户，初始化房间ID，如果是老用户，保持原样（使用 _.setOnInsert 更好，但 doc.set 简单直接）
          createTime: db.serverDate()
        }
      })
      return { success: true, openid: OPENID }
    } catch (e) {
      return { success: false, error: e }
    }
  }
}