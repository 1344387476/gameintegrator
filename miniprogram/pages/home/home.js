/**
 * 首页 - 计分小程序
 * 功能：用户信息管理、创建房间、扫码加入房间
 * 作者：zdsun
 * 创建时间：2026-01-19
 */
const app = getApp();
const theme = require('../../utils/theme');
const motion = require('../../utils/motion');
const { parseScannedRoomId } = require('../../utils/room-entry');
const backend = require('../../utils/backend');

Page({
  /**
   * 页面初始数据
   */
  data: {
    appearanceTheme: app.globalData.appearanceTheme || 'light',
    motionLevel: motion.getMotionLevel(),
    pageSafeTop: 72,
    pageActionTop: 78,
    showAppearanceSettings: false,
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
    // 当前用户可返回的进行中房间
    currentRoomId: '',
    hasActiveRoom: false,
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
    this.setData({ appearanceTheme: theme.getTheme() });
    theme.applyNativeChrome('home', this.data.appearanceTheme);
    this.updatePageSafeTop();
    // 统一监听用户信息加载状态，只触发一次
    this.waitForUserInfoAndInit();
  },

  openAppearanceSettings() {
    this.setData({ showAppearanceSettings: true });
  },

  closeAppearanceSettings() {
    this.setData({ showAppearanceSettings: false });
  },

  selectAppearanceTheme(e) {
    theme.setTheme(e.currentTarget.dataset.theme, this, 'home');
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

    // 自建头像受鉴权保护，页面先显示已缓存的本地路径，再按资源ID刷新。
    const currentRoomId = app.globalData.currentRoomId || '';

    this.setData({
      isLoading: false,
      nickname: userInfo.nickname || '',
      avatarFileID: userInfo.avatarFileID || '',
      avatarUrl: userInfo.avatarUrl || '',  // 保留临时URL备用
      currentRoomId,
      hasActiveRoom: false
    });
    this._lastSavedProfile = {
      nickname: this.normalizeNickname(userInfo.nickname || ''),
      avatarFileID: userInfo.avatarFileID || '',
      syncedRoomId: currentRoomId
    };
    this._profileDraftVersion = 0;

    if (userInfo.avatarFileID) {
      backend.getTempFileURL({
        fileList: [userInfo.avatarFileID],
        success: result => {
          const avatarUrl = result.fileList && result.fileList[0] && result.fileList[0].tempFileURL;
          if (avatarUrl) {
            this.setData({ avatarUrl });
            getApp().globalData.userInfo.avatarUrl = avatarUrl;
          }
        },
        fail: error => console.error('读取本人头像失败:', error)
      });
    }

    // 外部扫码/分享进入的待加入房间优先于旧房间返回入口。
    if (app.globalData.pendingRoomId) {
      this.checkPendingRoomIdAfterInit();
    } else {
      this.checkCurrentRoomStatus(currentRoomId);
    }
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

  updatePageSafeTop() {
    const { safeTop } = theme.getCustomNavMetrics();
    this.setData({ pageSafeTop: safeTop, pageActionTop: safeTop + 6 });
  },

  onResize() {
    this.updatePageSafeTop();
  },

  onHide() {
    if (!this._lastSavedProfile) return;
    this.ensureProfileSaved().then((success) => {
      if (!success) wx.showToast({ title: '资料保存失败，请重试', icon: 'none' });
    });
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

    // 保存屏障完成后再加入，确保房间快照使用最新资料。
    this.ensureProfileSaved().then((uploadSuccess) => {
      if (!uploadSuccess) {
        this.setData({ isCreatingOrJoining: false });
        wx.showToast({ title: '资料保存失败，请重试', icon: 'none' });
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
    const appearanceTheme = theme.getTheme();
    if (appearanceTheme !== this.data.appearanceTheme) this.setData({ appearanceTheme });
    theme.applyNativeChrome('home', appearanceTheme);
    // 用户从 room 页返回时，重新校验“返回房间”入口。
    const app = getApp();
    if (!app.globalData.pendingRoomId) {
      this.checkCurrentRoomStatus(app.globalData.currentRoomId || this.data.currentRoomId);
    }
  },

  /**
   * 校验当前用户是否仍在一个可返回的进行中房间。
   * @param {string} roomId - getUserInfo 返回的当前房间 ID
   */
  checkCurrentRoomStatus(roomId) {
    if (!roomId) {
      this.setData({ currentRoomId: '', hasActiveRoom: false });
      return;
    }

    backend.callFunction({
      name: 'roomFunctions',
      data: { action: 'checkUserStatus' },
      success: (res) => {
        const result = res.result || {};
        const activeRoomId = result.success && result.inRoom ? result.roomId : '';
        getApp().globalData.currentRoomId = activeRoomId || null;
        this.setData({
          currentRoomId: activeRoomId,
          hasActiveRoom: Boolean(activeRoomId)
        });
      },
      fail: (err) => {
        console.error('检查当前房间状态失败:', err);
        this.setData({ currentRoomId: '', hasActiveRoom: false });
      }
    });
  },

  /**
   * 返回仍在进行中的房间。
   */
  returnToRoom() {
    const roomId = this.data.currentRoomId;
    if (!roomId) return;

    this.setData({ isCreatingOrJoining: true });
    this.ensureProfileSaved().then((profileSaved) => {
      if (!profileSaved) {
        this.setData({ isCreatingOrJoining: false });
        wx.showToast({ title: '资料保存失败，请重试', icon: 'none' });
        return;
      }
      backend.callFunction({
      name: 'roomFunctions',
      data: { action: 'checkUserStatus' },
      success: (res) => {
        const result = res.result || {};
        if (result.success && result.inRoom && result.roomId === roomId) {
          this.setData({ isCreatingOrJoining: false });
          wx.navigateTo({ url: `/pages/room/room?roomId=${roomId}` });
          return;
        }

        getApp().globalData.currentRoomId = null;
        this.setData({
          isCreatingOrJoining: false,
          currentRoomId: '',
          hasActiveRoom: false
        });
        wx.showToast({ title: '房间已结束或已退出', icon: 'none' });
      },
      fail: (err) => {
        console.error('返回房间前校验失败:', err);
        this.setData({ isCreatingOrJoining: false });
        wx.showToast({ title: '房间状态检查失败，请重试', icon: 'none' });
      }
      });
    });
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
    
    // 立即上传到自建服务并取得永久资源ID。
    const uploadPromise = new Promise((resolve, reject) => {
      backend.uploadFile({
        filePath: avatarUrl,
        success: resolve,
        fail: reject
      });
    });
    this._avatarUploadPromise = uploadPromise;

    uploadPromise.then((uploadRes) => {
        console.log('头像上传成功，fileID:', uploadRes.fileID);
        
        // 更新本地数据，使用fileID显示头像
        this.setData({
          avatarUrl,
          avatarFileID: uploadRes.fileID  // 使用fileID显示（永不过期）
        });
        this._profileDraftVersion = (this._profileDraftVersion || 0) + 1;
        this._avatarUploadPromise = null;
        return this.ensureProfileSaved();
      }).then((saved) => {
        wx.hideLoading();
        if (saved) {
          wx.showToast({ title: '头像保存成功', icon: 'success' });
        } else {
          wx.showToast({ title: '资料保存失败，请重试', icon: 'none' });
        }
      }).catch((err) => {
        console.error('上传头像失败:', err);
        this._avatarUploadPromise = null;
        wx.hideLoading();
        wx.showToast({ title: '上传失败，请重试', icon: 'none' });
        
        // 上传失败时保留旧头像
        this.setData({
          avatarUrl: ''
        });
      });
  },

  /**
   * 昵称输入事件
   * @param {Object} e - 事件对象，包含输入的昵称
   */
  onNicknameInput(e) {
    const value = e.detail.value;
    if (value !== this.data.nickname) {
      this._profileDraftVersion = (this._profileDraftVersion || 0) + 1;
    }
    this.setData({ nickname: value });
  },

  onNicknameBlur(e) {
    const nickname = this.normalizeNickname(e.detail.value);
    if (!nickname) {
      wx.showToast({ title: '请输入昵称', icon: 'none' });
      return;
    }
    if ([...nickname].length > 10) {
      wx.showToast({ title: '昵称最多10个字符', icon: 'none' });
      return;
    }
    if (nickname !== this.data.nickname) {
      this._profileDraftVersion = (this._profileDraftVersion || 0) + 1;
      this.setData({ nickname });
    }
    this.ensureProfileSaved().then((success) => {
      if (!success) wx.showToast({ title: '资料保存失败，请重试', icon: 'none' });
    });
  },

  normalizeNickname(value) {
    return String(value || '').trim().replace(/\s+/g, ' ');
  },

  getProfileDraft() {
    return {
      nickname: this.normalizeNickname(this.data.nickname),
      avatarFileID: this.data.avatarFileID || ''
    };
  },

  getActiveProfileRoomId() {
    return this.data.hasActiveRoom
      ? (this.data.currentRoomId || getApp().globalData.currentRoomId || '')
      : '';
  },

  saveProfileSnapshot(profile, activeRoomId) {
    const request = activeRoomId
      ? {
          name: 'roomFunctions',
          data: {
            action: 'updateProfile',
            payload: { roomId: activeRoomId, nickname: profile.nickname, avatarFileID: profile.avatarFileID }
          }
        }
      : {
          name: 'userFunctions',
          data: {
            action: 'updateUserInfo',
            userData: { nickname: profile.nickname, avatar: '', avatarFileID: profile.avatarFileID }
          }
        };

    return new Promise((resolve) => {
      backend.callFunction({
        ...request,
        success: (res) => resolve(Boolean(res.result && res.result.success)),
        fail: (err) => {
          console.error('保存用户资料失败:', err);
          resolve(false);
        }
      });
    });
  },

  async runProfileSaveLoop() {
    while (true) {
      const profile = this.getProfileDraft();
      if (!profile.nickname || [...profile.nickname].length > 10) return false;
      const activeRoomId = this.getActiveProfileRoomId();
      const saved = this._lastSavedProfile || { nickname: '', avatarFileID: '', syncedRoomId: '' };
      if (profile.nickname === saved.nickname &&
          profile.avatarFileID === saved.avatarFileID &&
          activeRoomId === (saved.syncedRoomId || '')) return true;

      const version = this._profileDraftVersion || 0;
      const success = await this.saveProfileSnapshot(profile, activeRoomId);
      if (!success) return false;

      this._lastSavedProfile = { ...profile, syncedRoomId: activeRoomId };
      const userInfo = getApp().globalData.userInfo || {};
      getApp().globalData.userInfo = {
        ...userInfo,
        nickname: profile.nickname,
        avatarUrl: '',
        avatarFileID: profile.avatarFileID
      };
      if ((this._profileDraftVersion || 0) === version && this.data.nickname !== profile.nickname) {
        this.setData({ nickname: profile.nickname });
      }
      // 保存期间产生了新修改时继续循环，直到最新版本真正落库。
      if ((this._profileDraftVersion || 0) === version && this.getActiveProfileRoomId() === activeRoomId) return true;
    }
  },

  async ensureProfileSaved() {
    if (this._avatarUploadPromise) {
      try {
        await this._avatarUploadPromise;
      } catch (error) {
        return false;
      }
    }
    if (this._profileSavePromise) return this._profileSavePromise;
    this._profileSavePromise = this.runProfileSaveLoop();
    try {
      return await this._profileSavePromise;
    } finally {
      this._profileSavePromise = null;
    }
  },

  /**
   * 保存用户资料到自建服务；头像选择时已经独立上传并保存。
   * @param {Function} callback - 回调函数，参数为 boolean 表示是否成功
   */
  uploadUserInfo(callback) {
    this.ensureProfileSaved().then(success => callback && callback(success));
  },

  /**
   * 打开创建房间弹窗
   * 验证昵称后显示创建房间弹窗
   */
  openCreateRoomModal() {
    // 验证昵称
    const nickname = this.data.nickname.trim().replace(/\s+/g, ' ');
    if (!nickname) {
      wx.showToast({
        title: '请输入昵称',
        icon: 'none'
      });
      return;
    }
    if ([...nickname].length > 10) {
      wx.showToast({ title: '昵称最多10个字符', icon: 'none' });
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
    const roomName = this.data.roomName.trim().replace(/\s+/g, ' ');
    if (!roomName) {
      wx.showToast({
        title: '请输入房间名称',
        icon: 'none'
      });
      return;
    }
    if ([...roomName].length > 20) {
      wx.showToast({ title: '房间名称最多20个字符', icon: 'none' });
      return;
    }

    // 验证昵称
    const nickname = this.data.nickname.trim().replace(/\s+/g, ' ');
    if (!nickname) {
      wx.showToast({
        title: '请输入昵称',
        icon: 'none'
      });
      return;
    }
    if ([...nickname].length > 10) {
      wx.showToast({ title: '昵称最多10个字符', icon: 'none' });
      return;
    }

    // 显示处理中 loading
    this.setData({ isCreatingOrJoining: true });

    // 保存屏障完成后才创建房间。
    this.uploadUserInfo((success) => {
      if (!success) {
        this.setData({ isCreatingOrJoining: false });
        wx.showToast({
          title: '资料保存失败，请重试',
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
    backend.callFunction({
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
           app.globalData.currentRoomId = roomId;
           wx.showToast({
             icon: 'success'
           });

           // 关闭弹窗和 loading
           this.setData({
             showCreateModal: false,
             isCreatingOrJoining: false,
             currentRoomId: roomId,
             hasActiveRoom: true
           });
           // 进入新房间
             wx.navigateTo({
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
    const nickname = this.data.nickname.trim().replace(/\s+/g, ' ');
    if (!nickname) {
      wx.showToast({ title: '请输入昵称', icon: 'none' });
      return;
    }
    if ([...nickname].length > 10) {
      wx.showToast({ title: '昵称最多10个字符', icon: 'none' });
      return;
    }

    // 直接扫码，不显示 loading
    wx.scanCode({
      scanType: 'qrCode',
      success: (res) => {
        console.log('扫码结果:', res.result);
        console.log('扫码结果:', res);
        const roomId = parseScannedRoomId(res);

        if (roomId) {
          // 扫码成功，显示 loading
          this.setData({ isCreatingOrJoining: true });

          // 保存屏障完成后才加入房间。
          this.uploadUserInfo((uploadSuccess) => {
            if (!uploadSuccess) {
              this.setData({ isCreatingOrJoining: false });
              wx.showToast({ title: '资料保存失败，请重试', icon: 'none' });
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
    backend.callFunction({
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
          const joinedRoomId = res.result.roomId || roomId;
          app.globalData.currentRoomId = joinedRoomId;
          this.setData({
            isCreatingOrJoining: false,
            currentRoomId: joinedRoomId,
            hasActiveRoom: true
          });
            wx.navigateTo({
              url: `/pages/room/room?roomId=${joinedRoomId}`
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
