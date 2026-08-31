const theme = require('./utils/theme')
const backend = require('./utils/backend')
const { extractInvite } = require('./utils/room-entry')

App({
  /**
   * 全局数据
   */
  globalData: {
    userInfo: null,
    userInfoStatus: 'loading',
    // 存储从外部进入时传入的房间ID，用于home页面自动加入房间
    pendingRoomId: null,
    // 当前用户仍在进行中的房间ID，由首页提供“返回房间”入口
    currentRoomId: null,
    // 标记新用户通过外部方式（扫码/分享）首次进入房间
    isNewUserFromExternal: false,
    appearanceTheme: ''
  },

  /**
   * 生命周期函数 - 应用启动
   */
  onLaunch(options) {
    this.globalData.appearanceTheme = theme.getTheme()
    const logs = wx.getStorageSync('logs') || []
    logs.unshift(Date.now())
    wx.setStorageSync('logs', logs)

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
    const roomId = extractInvite(query.roomId || '') || extractInvite(query.scene || '')

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

    const pages = getCurrentPages()
    const route = pages.length ? pages[pages.length - 1].route : 'pages/home/home'
    const pageType = route === 'pages/room/room' ? 'room' : (route === 'pages/record/record' ? 'record' : 'home')
    theme.applyNativeChrome(pageType, this.globalData.appearanceTheme)
    this.initUserInfo()
  },

  /**
   * 初始化用户信息
   */
  initUserInfo() {
    this.globalData.userInfoStatus = 'loading'

    backend.callFunction({
      name: 'userFunctions',
      data: { action: 'getUserInfo' },
      success: (res) => {
        console.log('获取用户信息成功:', res.result)
        if (res.result.success) {
          wx.setStorageSync('openid', res.result.openid)

          // 不再自动跳转到旧房间；由首页显示“返回房间”入口。
          this.globalData.currentRoomId = res.result.currentRoomId || null
          
          // 云函数已统一处理新老用户，直接获取返回的用户信息
          this.globalData.userInfo = {
            nickname: res.result.userInfo.nickname || '',
            avatarUrl: res.result.userInfo.avatar || '',
            avatarFileID: res.result.userInfo.avatarFileID || '',
            isNewUser: res.result.isNewUser
          }
          console.log(res.result.isNewUser ? '新用户创建成功:' : '老用户信息:', this.globalData.userInfo)
          
          // 标记新用户通过外部方式（扫码/分享）进入，需要在房间页面自动弹出编辑资料弹窗
          if (res.result.isNewUser && this.globalData.pendingRoomId) {
            this.globalData.isNewUserFromExternal = true
            console.log('新用户通过外部方式进入，标记isNewUserFromExternal为true')
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
    // 获取当前页面栈，如果已经在房间页面，不再重复跳转
    const pages = getCurrentPages()
    if (pages.length > 0) {
      const currentPage = pages[pages.length - 1]
      if (currentPage && currentPage.route === "pages/room/room") {
        console.log("当前已在房间页面，跳过自动跳转")
        return
      }
    }
    
    backend.database().collection('rooms').doc(roomId).get({
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
    backend.callFunction({
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
    backend.callFunction({
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
