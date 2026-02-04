/**
 * 首页 - 打牌记账小程序
 * 功能：用户信息管理、创建房间、扫码加入房间
 * 作者：Craft
 * 创建时间：2026-01-19
 */
const app = getApp();

Page({
  /**
   * 页面初始数据
   */
  data: {
    // 当前显示的昵称
    nickname: '',
    // 临时URL
    avatarUrl: '',
    // 当前头像的 fileID（永久，用于重新获取URL）
    avatarFileID: '',
    // 是否显示创建房间弹窗
    showCreateModal: false,
    // 房间名称
    roomName: '',
    // 游戏模式：'normal'(普通模式) 或 'bet'(下注模式)
    gameMode: 'normal',
    // 加入房间按钮文字
    joinButtonText: '加入房间',
    // 是否正在加载用户信息
    isLoading: true,
    // 是否正在创建或加入房间
    isCreatingOrJoining: false
  },

  /**
   * 生命周期函数 - 页面加载
   * 轮询检查 app.globalData.userInfoStatus
   * loading -> 显示 loading 动画，继续轮询
   * success -> 显示用户信息（调用 displayUserInfo）
   * fail -> 弹窗 Modal "获取用户信息失败，请检查网络"，然后显示空资料
   */
  onLoad() {
    this.checkUserInfoStatus();
  },

  /**
   * 检查用户信息状态并相应处理
   */
  checkUserInfoStatus() {
    const status = app.globalData.userInfoStatus;
    console.log('检查用户信息状态:', status);

    if (status === 'success') {
      const userInfo = app.globalData.userInfo;
      
      // 如果有 fileID，先获取 URL 再统一 setData，避免多次渲染
      if (userInfo?.avatarFileID) {
        wx.cloud.getTempFileURL({
          fileList: [userInfo.avatarFileID],
          success: (res) => {
            // 统一 setData，只渲染一次
            this.setData({
              isLoading: false,
              nickname: userInfo?.nickname || '',
              avatarFileID: userInfo?.avatarFileID || '',
              avatarUrl: res.fileList[0]?.tempFileURL || userInfo?.avatarUrl || ''
            });
          },
          fail: (err) => {
            console.error('获取头像URL失败:', err);
            // 获取失败，使用原有 URL
            this.setData({
              isLoading: false,
              nickname: userInfo?.nickname || '',
              avatarFileID: userInfo?.avatarFileID || '',
              avatarUrl: userInfo?.avatarUrl || ''
            });
          }
        });
      } else {
        // 没有 fileID，直接 setData
        this.setData({
          isLoading: false,
          nickname: userInfo?.nickname || '',
          avatarFileID: userInfo?.avatarFileID || '',
          avatarUrl: userInfo?.avatarUrl || ''
        });
      }
    } else if (status === 'fail') {
      // 一次性设置空数据并显示错误
      this.setData({
        isLoading: false,
        nickname: '',
        avatarFileID:'',
        avatarUrl: ''
      });
      wx.showModal({
        title: '提示',
        content: '获取用户信息失败，请检查网络',
        showCancel: false
      });
    } else if (status === 'loading') {
      // 继续轮询
      setTimeout(() => this.checkUserInfoStatus(), 300);
    }
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
   */
  onChooseAvatar(e) {
    const { avatarUrl } = e.detail;
    this.setData({ avatarUrl });
  },

  /**
   * 昵称输入事件
   * @param {Object} e - 事件对象，包含输入的昵称
   */
  onNicknameInput(e) {
    this.setData({ nickname: e.detail.value });
  },

  /**
   * 上传用户资料到云端
   * 如果头像是临时文件，先上传到云存储获取永久URL
   * @param {Function} callback - 回调函数，参数为 boolean 表示是否成功
   */
  uploadUserInfo(callback) {
    const { nickname, avatarUrl } = this.data;
    
    // 检查是否是临时文件，需要上传到云存储
    if (avatarUrl && (avatarUrl.startsWith('wxfile://') || avatarUrl.startsWith('http://tmp'))) {
      console.log('检测到临时头像，先上传到云存储');
      
      wx.cloud.uploadFile({
        cloudPath: 'avatars/' + Date.now() + '.jpg',
        filePath: avatarUrl,
        success: (uploadRes) => {
          // 获取永久 URL
          wx.cloud.getTempFileURL({
            fileList: [uploadRes.fileID],
            success: (urlRes) => {
              const permanentUrl = urlRes.fileList[0].tempFileURL;
              console.log('头像已转换为永久URL:', permanentUrl);
              
               // 关键：更新本地 avatarUrl 和 avatarFileID
               this.setData({ 
                 avatarUrl: permanentUrl,
                 avatarFileID: uploadRes.fileID
               });
               
               // 同步更新 globalData，确保返回首页后数据一致
               const app = getApp();
               app.globalData.userInfo.avatarUrl = permanentUrl;
               app.globalData.userInfo.avatarFileID = uploadRes.fileID;
               
               // 用临时URL和fileID上传到数据库
               this.doUploadUserInfo(nickname, permanentUrl, uploadRes.fileID, callback);
            },
            fail: (err) => {
              console.error('获取临时URL失败:', err);
              callback && callback(false);
            }
          });
        },
        fail: (err) => {
          console.error('上传头像到云存储失败:', err);
          callback && callback(false);
        }
      });
    } else {
      // 已经是URL或为空，直接上传（没有fileID）
      // 同步更新 globalData 的 avatarUrl
      if (avatarUrl) {
        const app = getApp();
        app.globalData.userInfo.avatarUrl = avatarUrl;
      }
      this.doUploadUserInfo(nickname, avatarUrl, '', callback);
    }
  },

  /**
   * 执行用户资料上传（内部方法）
   * @param {string} nickname - 昵称
   * @param {string} avatarUrl - 头像URL（临时）
   * @param {string} avatarFileID - 头像fileID（永久）
   * @param {Function} callback - 回调函数
   */
  doUploadUserInfo(nickname, avatarUrl, avatarFileID, callback) {
    wx.cloud.callFunction({
      name: 'userFunctions',
      data: {
        action: 'login',
        userData: {
          nickName: nickname,
          avatarUrl: avatarUrl,        // 临时 URL
          avatarFileID: avatarFileID   // fileID（永久）
        }
      },
      success: (res) => {
        if (res.result.success) {
          console.log('用户资料上传成功');
          callback && callback(true);
        } else {
          console.error('用户资料上传失败:', res.result.error);
          callback && callback(false);
        }
      },
      fail: (err) => {
        console.error('调用 userFunctions.login 失败:', err);
        callback && callback(false);
      }
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
   * 如果之前是 fail 状态，重新获取成功后要刷新页面显示
   * 获取成功后上传资料到云端（userFunctions.login）
   * 上传成功后创建房间
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

    // 验证昵称
    const nickname = this.data.nickname.trim();
    if (!nickname) {
      wx.showToast({
        title: '请输入昵称',
        icon: 'none'
      });
      return;
    }

    // 显示处理中 loading
    this.setData({ isCreatingOrJoining: true });

    // 上传用户资料到云端并处理创建房间
    this.uploadUserInfo((success) => {
      if (!success) {
        this.setData({ isCreatingOrJoining: false });
        wx.showToast({
          title: '保存用户信息失败',
          icon: 'none'
        });
        return;
      }

      // 上传成功，继续创建房间
      this.createRoom(roomName);
    });
  },

  /**
   * 创建房间
   * @param {string} roomName - 房间名称
   */
  createRoom(roomName) {
    wx.cloud.callFunction({
      name: 'roomFunctions',
      data: {
        action: 'create',
        payload: {
          roomName: roomName,
          mode: this.data.gameMode,
          nickname: this.data.nickname,
          avatar: this.data.avatarUrl || '',        // 临时 URL（2小时内有效）
          avatarFileID: this.data.avatarFileID || ''  // fileID（永久）
        }
      },
       success: (res) => {
         if (res.result.success) {
           // 成功：获取 roomId
           const roomId = res.result.roomId;
           wx.showToast({
             icon: 'success'
           });

           // 关闭弹窗和 loading
           this.setData({
             showCreateModal: false,
             isCreatingOrJoining: false
           });
           // 进入新房间
             wx.reLaunch({
               url: `/pages/room/room?roomId=${roomId}`
             });

         } else {
           // 失败：获取 msg
           this.setData({ isCreatingOrJoining: false });
           wx.showToast({
             title: res.result.msg || '创建失败',
             icon: 'none'
           });
         }
       },
       fail: (err) => {
         console.error('创建房间失败:', err);
         this.setData({ isCreatingOrJoining: false });
         wx.showToast({
           title: '创建失败',
           icon: 'none'
         });
       }
    });
  },

  /**
   * 加入房间/扫码加入房间
   * 扫码成功后才显示 loading 并执行上传和加入
   */
  joinRoom() {
    const nickname = this.data.nickname.trim();
    if (!nickname) {
      wx.showToast({ title: '请输入昵称', icon: 'none' });
      return;
    }

    // 直接扫码，不显示 loading
    wx.scanCode({
      scanType: 'qrCode',
      success: (res) => {
        console.log('扫码结果:', res.result);
        console.log('扫码结果:', res);
        let roomId = '';
        if (res.path.includes('roomId=')) {
          const match = res.path.match(/roomId=([^&]+)/);
          if (match && match[1]) {
            roomId = match[1];
          }
        } else if (res.path.includes('room/')) {
          const parts = res.path.split('/');
          roomId = parts[parts.length - 1];
        } else {
          roomId = res.path;
        }

        if (roomId) {
          // 扫码成功，显示 loading
          this.setData({ isCreatingOrJoining: true });

          // 上传用户信息
          this.uploadUserInfo((uploadSuccess) => {
            if (!uploadSuccess) {
              this.setData({ isCreatingOrJoining: false });
              wx.showToast({ title: '保存用户信息失败', icon: 'none' });
              return;
            }

            // 上传成功，加入房间
            this.joinRoomAction(roomId);
          });
        } else {
          wx.showToast({ title: '二维码无效', icon: 'none' });
        }
      },
      fail: (err) => {
        console.log('扫码失败:', err);
        if (err.errMsg.includes('scanCode:fail cancel')) {
          return;
        }
        wx.showToast({ title: '扫码失败，请重试', icon: 'none' });
      }
    });
  },

  /**
   * 执行加入房间操作
   * @param {string} roomId - 房间ID
   */
  joinRoomAction(roomId) {
    wx.cloud.callFunction({
      name: 'roomFunctions',
       data: {
         action: 'join',
         payload: {
           roomId: roomId,
           nickname: this.data.nickname,
           avatar: this.data.avatarUrl || '',        // 临时 URL（2小时内有效）
           avatarFileID: this.data.avatarFileID || ''  // fileID（永久，用于重新获取URL）
         }
       },
      success: (res) => {
        if (res.result.success) {
          this.setData({ isCreatingOrJoining: false });
            wx.reLaunch({
              url: `/pages/room/room?roomId=${roomId}`
            });
        } else {
          this.setData({ isCreatingOrJoining: false });
          wx.showToast({ title: res.result.msg || '加入失败', icon: 'none' });
        }
      },
      fail: (err) => {
        console.error('加入房间失败:', err);
        this.setData({ isCreatingOrJoining: false });
        wx.showToast({ title: '加入失败', icon: 'none' });
      }
    });
  }
});

