App({
  /**
   * 全局数据
   */
  globalData: {
    userInfo: null,
    userInfoStatus: 'loading'
  },

  /**
   * 生命周期函数 - 应用启动
   */
  onLaunch() {
    wx.cloud.init({
      env: 'cloud1-5gv2wyv347737dc9',
      traceUser: true
    })

    const logs = wx.getStorageSync('logs') || []
    logs.unshift(Date.now())
    wx.setStorageSync('logs', logs)

    wx.login({
      success: () => {}
    })

   
  },

  onShow() {

   this.initUserInfo()
  },

  /**
   * 初始化用户信息
   */
  initUserInfo() {
    this.globalData.userInfoStatus = 'loading'
    
    wx.cloud.callFunction({
      name: 'userFunctions',
      data: { action: 'getUserInfo' },
      success: (res) => {
        console.log('获取用户信息成功:', res.result)
        if (res.result.success) {
          wx.setStorageSync('openid', res.result.openid)
          
          if (res.result.currentRoomId) {
            this.checkAndNavigateToRoom(res.result.currentRoomId)
          }
          
          if (res.result.isNewUser) {
            const randomNickName = '玩家' + Math.floor(Math.random() * 1000)
            this.globalData.userInfo = {
              nickname: randomNickName,
              avatarUrl: '',
              avatarFileID:'',
              isNewUser: true
            }
            console.log('新用户初始化:', this.globalData.userInfo)
          } else {
            this.globalData.userInfo = {
              nickname: res.result.userInfo.nickname || '',
              avatarUrl: res.result.userInfo.avatar || '',
              avatarFileID: res.result.userInfo.avatarFileID || '',
              isNewUser: false
            }
            console.log('老用户信息:', this.globalData.userInfo)
          }
          this.globalData.userInfoStatus = 'success'
        } else {
          console.error('获取用户信息失败:', res.result.error)
          this.globalData.userInfoStatus = 'fail'
          this.globalData.userInfo = {
            nickname: '',
            avatarUrl: '',
            avatarFileID:'',
            isNewUser: true
          }
        }
      },
      fail: (err) => {
        console.error('调用 getUserInfo 接口失败:', err)
        this.globalData.userInfoStatus = 'fail'
        this.globalData.userInfo = {
          nickname: '',
          avatarUrl: '',
          avatarFileID:'',
          isNewUser: true
        }
      }
    })
  },

  checkAndNavigateToRoom(roomId) {
    wx.cloud.database().collection('rooms').doc(roomId).get({
      success: (res) => {
        const room = res.data
        console.log('查询房间' + room)
        if (!room) {
          wx.removeStorageSync('currentRoomId')
          return
        }
        
        if (room.status === 'active') {
          this.checkUserStatusAndNavigate(roomId)
        } else if (room.status === 'settled') {
          this.deleteSettledRoom(roomId)
        }
      },
      fail: () => {
        wx.removeStorageSync('currentRoomId')
      }
    })
  },

  checkUserStatusAndNavigate(roomId) {
    wx.cloud.callFunction({
      name: 'roomFunctions',
      data: { action: 'checkUserStatus' },
      success: (res) => {
        if (res.result.success && res.result.inRoom) {
          wx.reLaunch({
            url: `/pages/room/room?roomId=${roomId}`
          })
        } else {
          wx.removeStorageSync('currentRoomId')
        }
      },
      fail: (err) => {
        console.error('检查用户状态失败:', err)
        wx.removeStorageSync('currentRoomId')
      }
    })
  },

  deleteSettledRoom(roomId) {
    wx.cloud.callFunction({
      name: 'roomFunctions',
      data: {
        action: 'deleteSettledRoom',
        payload: { roomId }
      },
      complete: () => {
        wx.removeStorageSync('currentRoomId')
      }
    })
  }
})
