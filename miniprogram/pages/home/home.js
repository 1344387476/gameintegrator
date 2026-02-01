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
  },
// 测试云开发
    testCloudDB() {
    const db = wx.cloud.database();
    db.collection('test').add({
      data:{
        content:'云开发测试'
      },
      success: () => {
        wx.showToast({
          title:'测试成功',icon:'success'
        });fail:(err) =>{
          wx.showToast({
            title: '测试失败',icon:'none'
          });
          console.log(err);
        }
      }
    })
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
   * 生命周期函数 - 页面显示
   */
  onShow() {
    // 不需要检查房间状态（由 app.js 处理）
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

    console.log('=== 创建房间 - 判断用户资料是否改变 ===');
    console.log('昵称是否改变:', isNicknameChanged);
    console.log('头像是否改变:', isAvatarChanged);

    // 更新用户信息到本地存储和页面数据
    const userInfo = this.data.userInfo;
    userInfo.nickName = nickname;
    wx.setStorageSync('userInfo', userInfo);
    this.setData({ userInfo });

    // 只有用户资料改变时才调用更新接口
    if (isNicknameChanged || isAvatarChanged) {
      console.log('用户资料已改变，调用更新接口');
    } else {
      console.log('用户资料未改变，跳过更新接口');
    }

    // 调用 roomFunctions 创建房间
    wx.cloud.callFunction({
      name: 'roomFunctions',
      data: {
        action: 'create',
        payload: {
          roomName: roomName,
          mode: this.data.gameMode,
          nickname: userInfo.nickName,
          avatar: userInfo.avatarUrl || ''
        }
      },
      success: (res) => {
        if (res.result.success) {
          // 成功：获取 roomId，更新前端缓存的 currentRoomId
          const roomId = res.result.roomId;
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
              url: `/pages/room/room?roomId=${roomId}`
            });
          }, 500);
        } else {
          // 失败：获取 msg
          wx.showToast({
            title: res.result.msg || '创建失败',
            icon: 'none'
          });
        }
      },
      fail: (err) => {
        console.error('创建房间失败:', err);
        wx.showToast({
          title: '创建失败',
          icon: 'none'
        });
      }
    });
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

    console.log('=== 创建房间 - 判断用户资料是否改变 ===');
    console.log('昵称是否改变:', isNicknameChanged);
    console.log('头像是否改变:', isAvatarChanged);

    // 更新用户信息到本地存储和页面数据
    const userInfo = this.data.userInfo;
    userInfo.nickName = nickname;
    wx.setStorageSync('userInfo', userInfo);
    this.setData({ userInfo });

    // 只有用户资料改变时才调用更新接口
    if (isNicknameChanged || isAvatarChanged) {
      console.log('用户资料已改变，调用更新接口');
    } else {
      console.log('用户资料未改变，跳过更新接口');
    }
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
            // 调用 roomFunctions 加入房间
            wx.cloud.callFunction({
              name: 'roomFunctions',
              data: {
                action: 'join',
                payload: {
                  roomId: roomId,
                  nickname: userInfo.nickName,
                  avatar: userInfo.avatarUrl || ''
                }
              },
              success: (joinRes) => {
                if (joinRes.result.success) {
                  // 成功：保存 roomId，跳转到房间

                  wx.showToast({
                    title: '加入成功',
                    icon: 'success'
                  });

                  setTimeout(() => {
                    wx.navigateTo({
                      url: `/pages/room/room?roomId=${roomId}`
                    });
                  }, 500);
                } else {
                  // 失败：获取 msg
                  wx.showToast({
                    title: joinRes.result.msg || '加入失败',
                    icon: 'none'
                  });
                }
              },
              fail: (err) => {
                console.error('加入房间失败:', err);
                wx.showToast({
                  title: '加入失败',
                  icon: 'none'
                });
              }
            });
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
