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
   * 只监听一次用户信息加载完成事件，避免重复渲染
   * 统一处理：显示用户信息 + 检查待加入房间
   */
  onLoad() {
    // 统一监听用户信息加载状态，只触发一次
    this.waitForUserInfoAndInit();
  },

  /**
   * 统一等待用户信息加载完成
   * 使用单次监听器，避免轮询导致的重复渲染
   */
  waitForUserInfoAndInit() {
    const app = getApp();
    
    // 清除可能存在的旧监听器
    if (this._userInfoWatcher) {
      clearTimeout(this._userInfoWatcher);
    }

    const checkStatus = () => {
      const status = app.globalData.userInfoStatus;
      console.log('waitForUserInfoAndInit 状态:', status);

      if (status === 'success') {
        // 用户信息已加载，统一初始化
        this.initializeUserInfo();
      } else if (status === 'fail') {
        // 加载失败，显示错误状态
        this.setData({
          isLoading: false,
          nickname: '',
          avatarFileID: '',
          avatarUrl: ''
        });
        wx.showModal({
          title: '提示',
          content: '获取用户信息失败，请检查网络',
          showCancel: false
        });
      } else {
        // 仍在加载，继续等待（使用单次定时器）
        this._userInfoWatcher = setTimeout(checkStatus, 300);
      }
    };

    checkStatus();
  },

  /**
   * 统一初始化用户信息
   * 只执行一次setData，避免重复渲染
   * 注意：Home页面直接使用avatarFileID显示头像，不申请临时URL
   * 因为fileID不会过期，且自己创建的文件自己有读取权限
   */
  initializeUserInfo() {
    const app = getApp();
    const userInfo = app.globalData.userInfo;

    console.log('统一初始化用户信息:', userInfo);

    // Home页面直接使用fileID显示头像，不申请临时URL
    // 微信image组件支持cloud://协议直接显示
    this.setData({
      isLoading: false,
      nickname: userInfo.nickname || '',
      avatarFileID: userInfo.avatarFileID || '',
      avatarUrl: userInfo.avatarUrl || ''  // 保留临时URL备用
    });

    this.checkPendingRoomIdAfterInit();
  },

  /**
   * 初始化完成后检查待加入房间
   * 确保在用户信息加载完成后再执行
   */
  checkPendingRoomIdAfterInit() {
    const app = getApp();
    const pendingRoomId = app.globalData.pendingRoomId;

    if (pendingRoomId) {
      console.log('初始化完成后检测到待处理房间ID:', pendingRoomId);
      this.handleAutoJoinRoom(pendingRoomId);
    }
  },

  /**
   * 页面卸载时清理定时器
   */
  onUnload() {
    if (this._userInfoWatcher) {
      clearTimeout(this._userInfoWatcher);
    }
  },

  /**
   * 自动加入房间（从外部进入的场景）
   * @param {string} roomId - 房间ID
   */
  handleAutoJoinRoom(roomId) {
    const app = getApp();
    const userInfo = app.globalData.userInfo;

    // 检查昵称
    if (!userInfo || !userInfo.nickname) {
      wx.showModal({
        title: '提示',
        content: '请先设置昵称后再加入房间',
        showCancel: false
      });
      // 清除pendingRoomId，让用户手动点击加入房间
      app.globalData.pendingRoomId = null;
      return;
    }

    // 设置本地数据
    this.setData({
      nickname: userInfo.nickname,
      avatarUrl: userInfo.avatarUrl || '',
      avatarFileID: userInfo.avatarFileID || ''
    });

    // 显示加载状态
    this.setData({ isCreatingOrJoining: true });

    // 上传用户信息后执行加入房间
    this.uploadUserInfo((uploadSuccess) => {
      if (!uploadSuccess) {
        this.setData({ isCreatingOrJoining: false });
        wx.showToast({ title: '保存用户信息失败', icon: 'none' });
        // 失败时不清除pendingRoomId，允许用户重试
        return;
      }

      // 上传成功，加入房间
      this.joinRoomAction(roomId);
      // 清除pendingRoomId
      app.globalData.pendingRoomId = null;
    });
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
    console.log('选择新头像，临时路径:', avatarUrl);
    
    // 显示加载中
    wx.showLoading({ title: '上传头像...' });
    
    // 立即上传到云存储获取fileID
    // 因为home页面使用avatarFileID显示头像（永不过期）
    wx.cloud.uploadFile({
      cloudPath: 'avatars/' + Date.now() + '.jpg',
      filePath: avatarUrl,
      success: (uploadRes) => {
        console.log('头像上传成功，fileID:', uploadRes.fileID);
        
        // 更新本地数据，使用fileID显示头像
        this.setData({
          avatarUrl: '',  // 清空临时URL
          avatarFileID: uploadRes.fileID  // 使用fileID显示（永不过期）
        });
        
        // 同步更新globalData
        const app = getApp();
        app.globalData.userInfo.avatarFileID = uploadRes.fileID;
        
        wx.hideLoading();
        wx.showToast({ title: '头像上传成功', icon: 'success' });
      },
      fail: (err) => {
        console.error('上传头像失败:', err);
        wx.hideLoading();
        wx.showToast({ title: '上传失败，请重试', icon: 'none' });
        
        // 上传失败时保留旧头像
        this.setData({
          avatarUrl: ''
        });
      }
    });
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
    // 不要在函数开头解构，每次使用都直接从this.data获取最新值
    // const { nickname, avatarUrl, avatarFileID } = this.data;

    // 检查是否是临时文件，需要上传到云存储
    if (this.data.avatarUrl && (this.data.avatarUrl.startsWith('wxfile://') || this.data.avatarUrl.startsWith('http://tmp'))) {
      console.log('检测到临时头像，先上传到云存储，当前昵称:', this.data.nickname);

      wx.cloud.uploadFile({
        cloudPath: 'avatars/' + Date.now() + '.jpg',
        filePath: this.data.avatarUrl,
        success: (uploadRes) => {
          // 获取永久 URL
          wx.cloud.getTempFileURL({
            fileList: [uploadRes.fileID],
            success: (urlRes) => {
              const permanentUrl = urlRes.fileList[0].tempFileURL;
              console.log('头像已转换为永久URL:', permanentUrl, 'fileID:', uploadRes.fileID);

               // 关键：更新本地 avatarUrl 和 avatarFileID
               this.setData({
                 avatarUrl: permanentUrl,
                 avatarFileID: uploadRes.fileID
               });

               // 同步更新 globalData，确保返回首页后数据一致
               const app = getApp();
               app.globalData.userInfo.avatarUrl = permanentUrl;
               app.globalData.userInfo.avatarFileID = uploadRes.fileID;

               // 用临时URL和fileID上传到数据库 - 使用最新的nickname
               console.log('上传用户信息到数据库，昵称:', this.data.nickname, 'fileID:', uploadRes.fileID);
               this.doUploadUserInfo(this.data.nickname, permanentUrl, uploadRes.fileID, callback);
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
      // 已经是URL或为空，直接上传（使用已有的avatarFileID）
      // 同步更新 globalData 的 avatarUrl 和 avatarFileID
      const app = getApp();
      if (this.data.avatarUrl) {
        app.globalData.userInfo.avatarUrl = this.data.avatarUrl;
      }
      if (this.data.avatarFileID) {
        app.globalData.userInfo.avatarFileID = this.data.avatarFileID;
      }
      console.log('使用已有头像上传，昵称:', this.data.nickname, 'avatarFileID:', this.data.avatarFileID);
      this.doUploadUserInfo(this.data.nickname, this.data.avatarUrl, this.data.avatarFileID || '', callback);
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
        action: 'updateUserInfo',
        userData: {
          nickname: nickname,
          avatar: avatarUrl,        // 临时 URL
          avatarFileID: avatarFileID   // fileID（永久）
        }
      },
      success: (res) => {
        if (res.result.success) {
          console.log('用户资料更新成功，更新字段:', res.result.updatedFields);
          callback && callback(true);
        } else {
          console.error('用户资料更新失败:', res.result.error);
          callback && callback(false);
        }
      },
      fail: (err) => {
        console.error('调用 userFunctions.updateUserInfo 失败:', err);
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

