

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

    // 微信登录
    wx.login({
      success: (res) => {
        console.log(res);
        // TODO: 将 code 发送到后台换取 openId, sessionKey, unionId
      }
    })

    this.initUserInfo();

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
          wx.setStorageSync('openid', res.result.openid);
          
          if (res.result.currentRoomId) {
            // 新增：验证房间有效性并自动跳转
            this.checkAndNavigateToRoom(res.result.currentRoomId);
          }
          
          // 判断是否为新用户
          if (res.result.isNewUser) {
            // 新用户：显示默认头像和 randomNickName = '玩家' + Math.floor(Math.random() * 1000);
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
            const mappedUserInfo = {
              nickName: userInfo.nickname || '',
              avatarUrl: userInfo.avatar || ''
            };
            wx.setStorageSync('userInfo', mappedUserInfo);
            this.globalData.userInfo = mappedUserInfo;
            console.log('老用户信息:', userInfo);
            console.log('映射后的用户信息:', mappedUserInfo);
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
  },

  checkAndNavigateToRoom(roomId) {
    wx.cloud.callFunction({
      name: 'roomFunctions',
      data: {
        action: 'checkUserStatus'
      },
      success: (res) => {
        if (res.result.success && res.result.inRoom && res.result.status === 'active') {
          wx.reLaunch({
            url: `/pages/room/room?roomId=${roomId}`
          });
        } 
      },
      fail: (err) => {
        console.error('检查房间状态失败:', err);
      }
    });
  }

  

})
