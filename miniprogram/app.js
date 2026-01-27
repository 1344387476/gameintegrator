/**
 * 打牌记账小程序 - 主应用入口
 * 功能：应用初始化、用户信息管理、登录状态维护
 * 作者：Craft
 * 创建时间：2026-01-19
 */
App({
  /**
   * 全局数据
   */
  globalData: {
    userInfo: null
  },

  /**
   * 生命周期函数 - 应用启动
   */
  onLaunch() {
    // 初始化云开发环境（使用指定环境）
    wx.cloud.init({
      env: 'cloud1-5gv2wyv347737dc9',
      traceUser: true // 记录用户访问
    })

    // 记录应用启动日志
    const logs = wx.getStorageSync('logs') || []
    logs.unshift(Date.now())
    wx.setStorageSync('logs', logs)

    // 初始化用户信息
    this.initUserInfo()
  },

  /**
   * 初始化用户信息
   * 调用 getUserInfo 接口，根据返回结果判断是新用户还是老用户
   */
  initUserInfo() {
    wx.cloud.callFunction({
      name: 'userFunctions',
      data: {
        action: 'getUserInfo'
      },
      success: (res) => {
        console.log('获取用户信息成功:', res.result);
        if (res.result.success) {
          // 保存 openid 到本地存储（用于后续判断）
          wx.setStorageSync('openid', res.result.openid);

          // 根据 currentRoomId 切换按钮文字
          if (res.result.currentRoomId) {
            wx.setStorageSync('currentRoomId', res.result.currentRoomId);
          }

          // 判断是否为新用户
          if (res.result.isNewUser) {
            // 新用户：显示默认头像和随机用户名
            const randomNickName = '玩家' + Math.floor(Math.random() * 1000);
            const userInfo = {
              nickName: randomNickName,
              avatarUrl: ''
            };
            wx.setStorageSync('userInfo', userInfo);
            this.globalData.userInfo = userInfo;
            console.log('新用户初始化:', userInfo);
          } else {
            // 老用户：从接口获取头像和用户名
            const userInfo = res.result.userInfo;
            wx.setStorageSync('userInfo', userInfo);
            this.globalData.userInfo = userInfo;
            console.log('老用户信息:', userInfo);
          }
        } else {
          console.error('获取用户信息失败:', res.result.error);
        }
      },
      fail: (err) => {
        console.error('调用 getUserInfo 接口失败:', err);
        // 接口调用失败也允许继续使用本地默认信息
      }
    });
  }
})
