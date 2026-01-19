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
    // 是否显示创建房间弹窗
    showCreateModal: false,
    // 房间名称
    roomName: '',
    // 游戏模式：'normal'(普通模式) 或 'bet'(下注模式)
    gameMode: 'normal'
  },

  /**
   * 生命周期函数 - 页面加载
   */
  onLoad() {
    // 从本地存储加载保存的用户信息
    const userInfo = wx.getStorageSync('userInfo');
    if (userInfo) {
      this.setData({
        nickname: userInfo.nickName || '',
        userInfo: userInfo
      });
    }
  },

  /**
   * 选择头像
   * @param {Object} e - 事件对象，包含用户选择的头像URL
   */
  onChooseAvatar(e) {
    const { avatarUrl } = e.detail;
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
    // 先保存昵称
    const nickname = this.data.nickname.trim();
    if (!nickname) {
      wx.showToast({
        title: '请输入昵称',
        icon: 'none'
      });
      return;
    }

    // 更新用户信息
    const userInfo = this.data.userInfo;
    userInfo.nickName = nickname;
    wx.setStorageSync('userInfo', userInfo);

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

    const userInfo = wx.getStorageSync('userInfo');

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
   * 扫码加入房间
   * 调用微信扫码功能，解析二维码获取房间ID，跳转到房间页面
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

    // 更新用户信息
    const userInfo = this.data.userInfo;
    userInfo.nickName = nickname;
    wx.setStorageSync('userInfo', userInfo);

    // 调用摄像头扫描二维码
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
});
