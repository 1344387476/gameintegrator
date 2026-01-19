/**
 * 打牌记账小程序 - 主应用入口
 * 功能：应用初始化、用户信息管理、登录状态维护
 * 作者：Craft
 * 创建时间：2026-01-19
 */
App({
  /**
   * 生命周期函数 - 应用启动
   */
  onLaunch() {
    // 记录应用启动日志
    const logs = wx.getStorageSync('logs') || []
    logs.unshift(Date.now())
    wx.setStorageSync('logs', logs)

    // 微信登录
    wx.login({
      success: () => {
        // TODO: 将 code 发送到后台换取 openId, sessionKey, unionId
      }
    })

    // 初始化用户信息（首次启动）
    const userInfo = wx.getStorageSync('userInfo');
    if (!userInfo) {
      // 如果没有用户信息，生成默认昵称
      wx.setStorageSync('userInfo', {
        nickName: '玩家' + Math.floor(Math.random() * 1000),
        avatarUrl: ''
      });
    }
  },

  /**
   * 全局数据
   */
  globalData: {
    userInfo: null
  }
})
