/**
 * 首页 - 打牌记账小程序
 * 功能：用户信息管理、创建房间、扫码加入房间
 * 作者：Craft
 * 创建时间：2026-01-19
 */
Page({
  /**
   * 页面初始数据
   */
  data: {
    // 用户昵称
    nickname: '',
    // 用户信息（包含昵称和头像）
    userInfo: {
      nickName: '',
      avatarUrl: ''
    },
    // 原始用户信息（用于对比是否修改）
    originalUserInfo: {
      nickName: '',
      avatarUrl: ''
    },
    // 是否显示创建房间弹窗
    showCreateModal: false,
    // 房间名称
    roomName: '',
    // 游戏模式：'normal'(普通模式) 或 'bet'(下注模式)
    gameMode: 'normal',
    // 加入房间按钮文字
    joinButtonText: '加入房间'
  },

  /**
   * 生命周期函数 - 页面加载
   */
  onLoad() {

    // 从本地存储读取已初始化的用户信息
    const userInfo = wx.getStorageSync('userInfo');
    if (userInfo && userInfo.nickName) {
      // 如果存在有效的用户信息，保存为原始用户信息
      const userInfoClone = JSON.parse(JSON.stringify(userInfo)); // 深拷贝
      this.setData({
        nickname: userInfo.nickName,
        userInfo: userInfo,
        originalUserInfo: userInfoClone
      });
      console.log('页面加载 - 用户信息:', userInfo);
      console.log('页面加载 - 原始用户信息:', userInfoClone);
    } else {
      // 如果没有用户信息，等待 app.js 初始化完成后再获取
      // 使用定时器轮询获取用户信息
      this.waitForUserInfo();
    }

    // 根据 currentRoomId 切换按钮文字
    const currentRoomId = wx.getStorageSync('currentRoomId');
    if (currentRoomId) {
      this.setData({
        joinButtonText: '回到房间'
      });
    } else {
      this.setData({
        joinButtonText: '加入房间'
      });
    }
  },

  /**
   * 等待用户信息初始化完成
   * 用于解决 app.js 异步初始化导致的页面加载时用户信息不存在的问题
   */
  waitForUserInfo() {
    let attempts = 0;
    const maxAttempts = 10;

    const checkUserInfo = () => {
      attempts++;
      const userInfo = wx.getStorageSync('userInfo');

      if (userInfo && userInfo.nickName) {
        // 获取到用户信息后初始化
        const userInfoClone = JSON.parse(JSON.stringify(userInfo)); // 深拷贝
        this.setData({
          nickname: userInfo.nickName,
          userInfo: userInfo,
          originalUserInfo: userInfoClone
        });
        console.log('等待初始化 - 用户信息:', userInfo);
        console.log('等待初始化 - 原始用户信息:', userInfoClone);
      } else if (attempts < maxAttempts) {
        // 继续等待
        setTimeout(checkUserInfo, 300);
      } else {
        console.warn('等待用户信息超时');
      }
    };

    checkUserInfo();
  },

  /**
   * 调用 userFunctions 登录接口
   * 更新用户资料到服务器
   */
  loginUser() {
    const userInfo = this.data.userInfo;
    if (!userInfo || !userInfo.nickName) {
      console.log('用户信息不完整，暂不调用登录接口');
      return;
    }

    wx.cloud.callFunction({
      name: 'userFunctions',
      data: {
        action: 'login',
        userData: userInfo
      },
      success: (res) => {
        console.log('更新用户信息成功:', res.result);
        if (res.result.success) {
          // 保存 openid 到本地存储（用于后续判断）
          wx.setStorageSync('openid', res.result.openid);
        } else {
          console.error('更新用户信息失败:', res.result.error);
        }
      },
      fail: (err) => {
        console.error('调用 login 接口失败:', err);
        // 更新失败不影响后续流程
      }
    });
  },

  /**
   * 选择头像
   * @param {Object} e - 事件对象，包含用户选择的头像URL
   * 只更新本地状态，不在此时调用更新接口
   */
  onChooseAvatar(e) {
    const { avatarUrl } = e.detail;

    // 更新用户信息到本地存储和页面数据
    const userInfo = this.data.userInfo;
    userInfo.avatarUrl = avatarUrl;
    wx.setStorageSync('userInfo', userInfo);
    this.setData({ userInfo });
  },

  /**
   * 昵称输入事件
   * @param {Object} e - 事件对象，包含输入的昵称
   */
  onNicknameInput(e) {
    this.setData({
      nickname: e.detail.value
    });
  },

  /**
   * 打开创建房间弹窗
   * 验证昵称后显示创建房间弹窗
   */
  openCreateRoomModal() {
    // 验证昵称
    const nickname = this.data.nickname.trim();
    if (!nickname) {
      wx.showToast({
        title: '请输入昵称',
        icon: 'none'
      });
      return;
    }

    // 打开弹窗，默认房间名为用户昵称+"的房间"
    this.setData({
      showCreateModal: true,
      roomName: `${nickname}的房间`
    });
  },

  /**
   * 关闭创建房间弹窗
   */
  closeCreateRoomModal() {
    this.setData({
      showCreateModal: false
    });
  },

  /**
   * 房间名输入事件
   * @param {Object} e - 事件对象，包含输入的房间名称
   */
  onRoomNameInput(e) {
    this.setData({
      roomName: e.detail.value
    });
  },

  /**
   * 选择游戏模式
   * @param {Object} e - 事件对象，包含选中的模式
   */
  selectMode(e) {
    const mode = e.currentTarget.dataset.mode;
    this.setData({
      gameMode: mode
    });
  },

  /**
   * 提交创建房间
   * 验证输入后创建新房间并跳转到房间页面
   * 在确认创建房间时判断是否需要更新用户信息
   */
  submitCreateRoom() {
    const roomName = this.data.roomName.trim();
    if (!roomName) {
      wx.showToast({
        title: '请输入房间名称',
        icon: 'none'
      });
      return;
    }

    // 先保存昵称
    const nickname = this.data.nickname.trim();
    if (!nickname) {
      wx.showToast({
        title: '请输入昵称',
        icon: 'none'
      });
      return;
    }

    // 判断用户资料是否改变（使用原始用户信息进行对比）
    const originalUserInfo = this.data.originalUserInfo;
    const isNicknameChanged = originalUserInfo.nickName !== nickname;
    const isAvatarChanged = originalUserInfo.avatarUrl !== this.data.userInfo.avatarUrl;

    console.log('=== 加入房间 - 判断用户资料是否改变 ===');
    console.log('原始昵称:', originalUserInfo.nickName);
    console.log('当前昵称:', nickname);
    console.log('昵称是否改变:', isNicknameChanged);
    console.log('原始头像:', originalUserInfo.avatarUrl);
    console.log('当前头像:', this.data.userInfo.avatarUrl);
    console.log('头像是否改变:', isAvatarChanged);

    // 更新用户信息到本地存储和页面数据
    const userInfo = this.data.userInfo;
    userInfo.nickName = nickname;
    wx.setStorageSync('userInfo', userInfo);
    this.setData({ userInfo });

    // 只有用户资料改变时才调用更新接口
    if (isNicknameChanged || isAvatarChanged) {
      console.log('用户资料已改变，调用更新接口');
      this.loginUser();
    } else {
      console.log('用户资料未改变，跳过更新接口');
    }

    // 创建新房间（包含所有必要字段）
    const newRoom = {
      _id: Date.now().toString(),
      roomName: roomName,
      members: [{ name: userInfo.nickName, avatarUrl: userInfo.avatarUrl || '', score: 0 }],
      records: [],
      gameMode: this.data.gameMode,
      status: 'playing',
      createTime: new Date().toISOString(),
      creator: userInfo.nickName,
      creatorAvatar: userInfo.avatarUrl || '',
      prizePool: {
        total: 0,
        receiver: '',
        receivedTime: ''
      }
    };

    // 保存到本地存储
    const rooms = wx.getStorageSync('rooms') || [];
    rooms.unshift(newRoom);
    wx.setStorageSync('rooms', rooms);

    wx.showToast({
      title: '创建成功',
      icon: 'success'
    });

    // 关闭弹窗
    this.setData({
      showCreateModal: false
    });

    // 进入新房间
    setTimeout(() => {
      wx.navigateTo({
        url: `/pages/room/room?roomId=${newRoom._id}`
      });
    }, 500);
  },

  /**
   * 加入房间/回到房间
   * 根据按钮文字判断是扫码加入还是回到当前房间
   * 只在用户资料改变时才调用更新接口
   */
  joinRoom() {
    // 先保存昵称
    const nickname = this.data.nickname.trim();
    if (!nickname) {
      wx.showToast({
        title: '请输入昵称',
        icon: 'none'
      });
      return;
    }

    // 判断用户资料是否改变（使用原始用户信息进行对比）
    const originalUserInfo = this.data.originalUserInfo;
    const isNicknameChanged = originalUserInfo.nickName !== nickname;
    const isAvatarChanged = originalUserInfo.avatarUrl !== this.data.userInfo.avatarUrl;

    console.log('=== 加入房间 - 判断用户资料是否改变 ===');
    console.log('原始昵称:', originalUserInfo.nickName);
    console.log('当前昵称:', nickname);
    console.log('昵称是否改变:', isNicknameChanged);
    console.log('原始头像:', originalUserInfo.avatarUrl);
    console.log('当前头像:', this.data.userInfo.avatarUrl);
    console.log('头像是否改变:', isAvatarChanged);

    // 更新用户信息到本地存储和页面数据
    const userInfo = this.data.userInfo;
    userInfo.nickName = nickname;
    wx.setStorageSync('userInfo', userInfo);
    this.setData({ userInfo });

    // 只有用户资料改变时才调用更新接口
    if (isNicknameChanged || isAvatarChanged) {
      console.log('用户资料已改变，调用更新接口');
      this.loginUser();
    } else {
      console.log('用户资料未改变，跳过更新接口');
    }

    // 判断是回到房间还是扫码加入
    if (this.data.joinButtonText === '回到房间') {
      // 回到当前房间
      const currentRoomId = wx.getStorageSync('currentRoomId');
      if (currentRoomId) {
        wx.navigateTo({
          url: `/pages/room/room?roomId=${currentRoomId}`
        });
      } else {
        wx.showToast({
          title: '房间不存在',
          icon: 'none'
        });
      }
    } else {
      // 扫码加入房间
      wx.scanCode({
        scanType: 'qrCode',
        success: (res) => {
          console.log('扫码结果:', res.result);

          // 解析二维码结果，提取房间ID
          // 假设二维码格式为: https://xxx.com/pages/room/room?roomId=xxx 或直接是roomId
          let roomId = '';

          if (res.result.includes('roomId=')) {
            // 从URL中提取roomId
            const match = res.result.match(/roomId=([^&]+)/);
            if (match && match[1]) {
              roomId = match[1];
            }
          } else if (res.result.includes('room/')) {
            // 从路径中提取roomId
            const parts = res.result.split('/');
            roomId = parts[parts.length - 1];
          } else {
            // 直接使用扫码结果作为roomId
            roomId = res.result;
          }

          if (roomId) {
            wx.showToast({
              title: '扫描成功',
              icon: 'success'
            });

            // 跳转到房间
            setTimeout(() => {
              wx.navigateTo({
                url: `/pages/room/room?roomId=${roomId}`
              });
            }, 500);
          } else {
            wx.showToast({
              title: '二维码无效',
              icon: 'none'
            });
          }
        },
        fail: (err) => {
          console.log('扫码失败:', err);
          if (err.errMsg.includes('scanCode:fail cancel')) {
            // 用户取消扫码
            return;
          }

          wx.showToast({
            title: '扫码失败，请重试',
            icon: 'none'
          });
        }
      });
    }
  }
});
