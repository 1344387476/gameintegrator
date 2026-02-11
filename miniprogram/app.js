App({
  /**
   * 全局数据
   */
  globalData: {
    userInfo: null,
    userInfoStatus: 'loading',
    // 存储从外部进入时传入的房间ID，用于home页面自动加入房间
    pendingRoomId: null
  },

  /**
   * 生命周期函数 - 应用启动
   */
  onLaunch(options) {
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

    // 处理从外部进入的场景（扫码、分享卡片等）
    this.handleLaunchOptions(options)
  },

  /**
   * 处理启动参数
   * 如果是从外部扫码或分享卡片进入且带有roomId，记录到globalData供home页面处理
   */
  handleLaunchOptions(options) {
    console.log('启动参数:', options)

    // 获取scene值（数字，表示进入场景）
    const scene = options.scene || 0
    // 扫码进入的场景值：1007（单人聊天）、1008（群聊）、1044（带shareTicket的小程序消息卡片）等
    const scanScenes = [1007, 1008, 1011, 1012, 1013, 1025, 1036, 1044, 1047, 1048, 1049, 1154]

    // 从query中获取参数
    const query = options.query || {}
    let roomId = query.roomId

    // 处理小程序码的scene参数
    // 小程序码扫码后，scene参数内容会放在query.scene中（形如 "roomId=XXXXXX"）
    if (!roomId && query.scene) {
      const sceneStr = decodeURIComponent(query.scene)
      console.log('小程序码scene参数:', sceneStr)
      if (sceneStr.includes('roomId=')) {
        const match = sceneStr.match(/roomId=([^&]+)/)
        if (match && match[1]) {
          roomId = match[1]
          console.log('从小程序码解析到roomId:', roomId)
        }
      }
    }

    console.log('场景值:', scene, 'roomId:', roomId)

    // 如果是从外部进入且带有roomId，记录到globalData
    if (roomId && (scanScenes.includes(scene) || query.from === 'share')) {
      console.log('从外部进入，房间ID:', roomId)
      this.globalData.pendingRoomId = roomId
    }
  },

  onShow(options) {
    // 处理小程序已在运行时，用户扫码进入的情况
    if (options) {
      this.handleLaunchOptions(options)
    }

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

          // 优先处理外部进入的场景（扫码/分享卡片）
          // 如果有pendingRoomId，说明用户是通过外部方式进入的，
          // 此时不应自动导航到旧房间，而应由home页面处理加入新房间
          if (this.globalData.pendingRoomId) {
            console.log('检测到pendingRoomId，跳过自动导航到旧房间')
          } else if (res.result.currentRoomId) {
            this.checkAndNavigateToRoom(res.result.currentRoomId)
          }
          
          // 云函数已统一处理新老用户，直接获取返回的用户信息
          this.globalData.userInfo = {
            nickname: res.result.userInfo.nickname || '',
            avatarUrl: res.result.userInfo.avatar || '',
            avatarFileID: res.result.userInfo.avatarFileID || '',
            isNewUser: res.result.isNewUser
          }
          console.log(res.result.isNewUser ? '新用户创建成功:' : '老用户信息:', this.globalData.userInfo)
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
    // 获取当前页面栈，如果已经在房间页面，不再重复跳转
    const pages = getCurrentPages()
    if (pages.length > 0) {
      const currentPage = pages[pages.length - 1]
      if (currentPage && currentPage.route === "pages/room/room") {
        console.log("当前已在房间页面，跳过自动跳转")
        return
      }
    }
    
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
