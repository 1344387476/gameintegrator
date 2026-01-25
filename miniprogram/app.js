

App({
  /**
   * 生命周期函数 - 应用启动
   */
  onLaunch() {
    // 记录应用启动日志
    const logs = wx.getStorageSync('logs') || []
    logs.unshift(Date.now())
    wx.setStorageSync('logs', logs)

    if(!wx.cloud){
      console.error('云开发初始化错误')
    }else{
      wx.cloud.init({
        env:'cloud1-5gv2wyv347737dc9',
        traceUser:true,
      })
    }
    
    this.cloud = wx.cloud

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
