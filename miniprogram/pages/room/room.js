/**
 * 房间页面 - 打牌记账小程序
 * 功能：玩家管理、积分转账、奖池操作、游戏结算、战绩生成
 * 支持两种模式：普通模式（玩家间转账）、下注模式（奖池机制）
 * 作者：Craft
 * 创建时间：2026-01-19
 */
Page({
  /**
   * 页面初始数据
   */
  data: {
    // 房间ID
    roomId: '',
    // 房间信息
    room: {
      _id: '',
      roomName: '',
      gameMode: 'normal', // 'normal'(普通模式) 或 'bet'(下注模式)
      members: [], // 成员列表
      records: [], // 操作记录
      creator: '', // 房主
      status: 'playing', // 'playing'(进行中) 或 'ended'(已结束)
      prizePool: { // 奖池信息（下注模式）
        total: 0,
        receiver: '',
        receivedTime: ''
      },
      allInValue: 0 // all in最大值（下注模式）
    },
    // 当前用户昵称
    currentUser: '',
    // 弹窗显示状态
    showTransferModal: false, // 转账弹窗
    showPrizeModal: false, // 奖池转入弹窗
    showReceiveModal: false, // 收取奖池弹窗
    showTipModal: false, // 提示弹窗
    showSettleConfirm: false, // 结算确认弹窗
    showResultModal: false, // 战绩弹窗
    showQrcode: false, // 二维码弹窗
    showExpenseModal: false, // 支出弹窗
    showExitConfirm: false, // 退出房间确认弹窗
    // 转账相关数据
    targetMemberIndex: -1, // 目标成员索引
    targetMember: '', // 目标成员昵称
    transferAmount: '', // 转账金额
    prizeAmount: '', // 奖池转入金额
    showInputError: false, // 输入错误提示
    animateAmount: false, // 金额动画
    tipText: '', // 提示文字
    // 支出相关数据
    expenseAmounts: {}, // 各成员支出金额
    expenseTotal: 0, // 支出总计
    // 下注模式相关数据
    allInValue: 0, // all in最大值（下注模式）
    showAllInModal: false, // all in设置弹窗（已废弃）
    showSettingsModal: false, // 设置弹窗
    allInInput: '', // all in值输入
    showAllInTip: false, // all in未设置提示
    lastDepositAmount: 0, // 上一个转入金额
    lastDepositOperator: '', // 上一个转入玩家
    canFollow: false, // 是否可以跟注
    isCreator: false, // 是否为房主
    // 战绩数据
    resultData: {
      playerList: [], // 玩家战绩列表
      prizePoolInfo: null, // 奖池信息
      isUploaded: false // 是否已上传
    },
    scrollIntoView: '', // 聊天记录滚动位置
    // 动画相关数据（转入奖池飘动动画）
    showFloatAnimation: false, // 是否显示飘动动画
    floatAmount: 0, // 飘动金额
    floatLeft: 0, // 飘动起始X坐标
    floatTop: 0, // 飙动起始Y坐标
    // 收取奖池动画
    showReceiveAnimation: false, // 是否显示收取动画
    confettiList: [], // 彩带列表
    coinList: [], // 金币列表
    receiveAmount: 0, // 收取动画显示的金额
    // 战绩上传提示
    showUploadTip: false, // 是否显示上传提示
    uploadTipText: '', // 上传提示文字
    uploadFailed: false, // 上传是否失败
    // 战绩保存状态
    savingImage: false, // 是否正在保存战绩图片
    // 消息监听和分页相关
    messagesWatcher: null, // watch 监听器引用
    pollingTimer: null, // 轮询定时器
    watchRetryCount: 0, // watch 重试计数
    maxWatchRetries: 3, // 最大重试次数
    messagesPageSize: 32, // 每页消息数
    messagesLoaded: 0, // 已加载数量
    messagesMaxLimit: 100, // 最大加载数量
    isLoadingMore: false, // 是否正在加载更多
    hasMore: true, // 是否还有更多消息
    loadingMoreText: '', // 加载提示文案
    localMessageIds: [] // 本地消息ID集合（用于去重）
  },

  /**
   * 生命周期函数 - 页面加载
   * @param {Object} options - 页面参数，包含roomId
   */
  onLoad(options) {
    const { roomId } = options;
    this.setData({ roomId });
    console.log("房间id"+roomId)
    const userInfo = wx.getStorageSync('userInfo') || {};
    this.setData({ currentUser: userInfo.nickName || '' });

    this.loadRoom(roomId);
    this.initMessagesWatch(roomId);
  },

  /**
   * 生命周期函数 - 页面显示
   * 刷新消息列表并检查是否有未上传的战绩
   */
  onShow() {

  },

  /**
   * 生命周期函数 - 页面卸载
   * 关闭 watch 监听器和轮询定时器
   */
  onUnload() {
    // 关闭 watch 监听器
    if (this.data.messagesWatcher) {
      this.data.messagesWatcher.close();
    }
    // 关闭轮询定时器
    if (this.data.pollingTimer) {
      clearInterval(this.data.pollingTimer);
    }

    // 如果是通过返回按钮退出，清空本地房间状态
    if (this.data.roomId) {
      this.executeExitRoom();

    }
  },


  /**
   * 滚动到底部
   * 将聊天记录滚动到最新消息
   */
  scrollToBottom() {
    const recordsLength = this.data.room.records.length;
    if (recordsLength > 0) {
      this.setData({ scrollIntoView: `record-${recordsLength - 1}` });
    }
  },

  /**
   * 初始化消息实时监听
   * @param {string} roomId - 房间ID
   */
  initMessagesWatch(roomId) {
    const that = this;
    const { messagesPageSize } = that.data;

    try {
      const watcher = wx.cloud.database()
        .collection('messages')
        .where({ roomId })
        .orderBy('timestamp', 'desc')
        .limit(messagesPageSize)
        .watch({
          onChange: (snapshot) => {
            const messages = snapshot.docs;
            const records = that.convertMessagesToRecords(messages);
            // 消息按时间正序排列（最新的在最后）
            const sortedRecords = [...records].reverse();

            that.setData({
              'room.records': sortedRecords,
              watchRetryCount: 0
            });

            // 滚动到底部
            setTimeout(() => {
              that.scrollToBottom();
            }, 100);
          },
          onError: (err) => {
            console.error('消息监听失败:', err);
            that.handleWatchError(err, roomId);
          }
        });

      that.setData({ messagesWatcher: watcher });
    } catch (error) {
      console.error('初始化 watch 失败:', error);
      that.startPolling(roomId);
    }
  },

  /**
   * 处理 watch 错误并重试
   * @param {Object} err - 错误对象
   * @param {string} roomId - 房间ID
   */
  handleWatchError(err, roomId) {
    const that = this;
    const retryCount = that.data.watchRetryCount + 1;

    if (retryCount <= that.data.maxWatchRetries) {
      that.setData({ watchRetryCount: retryCount });
      console.log(`尝试重新建立 watch 连接 (${retryCount}/${that.data.maxWatchRetries})`);

      setTimeout(() => {
        that.initMessagesWatch(roomId);
      }, 2000 * retryCount);
    } else {
      console.error('Watch 连接重试次数已达上限，切换到轮询模式');
      that.setData({ messagesWatcher: null });
      that.startPolling(roomId);
    }
  },

  /**
   * 启动轮询（降级方案）
   * @param {string} roomId - 房间ID
   */
  startPolling(roomId) {
    const that = this;

    if (that.data.pollingTimer) {
      clearInterval(that.data.pollingTimer);
    }

    const pollingTimer = setInterval(() => {
      that.loadMessages(roomId, true);
    }, 3000);

    that.setData({ pollingTimer });
  },

  /**
   * 保存房间数据到云数据库
   * 注：此函数已废弃，所有数据更新通过云函数完成
   * 数据同步通过 loadRoom() 重新加载实现
   */
  saveRoomData() {
    console.log('saveRoomData已废弃，使用云函数更新数据');
  },

  /**
   * 加载消息列表
   * 从 messages 集合加载所有消息并转换为 records 格式
   * @param {string} roomId - 房间ID
   * @param {boolean} isInitialLoad - 是否为初始加载
   */
  loadMessages(roomId, isInitialLoad = true) {
    const { messagesPageSize, messagesMaxLimit } = this.data;

    wx.cloud.database().collection('messages')
      .where({ roomId })
      .orderBy('timestamp', 'desc')
      .limit(messagesPageSize)
      .get({
        success: (res) => {
          if (res.data) {
            const messages = res.data;
            const records = this.convertMessagesToRecords(messages);
            // 将消息按时间正序排列（最新的在最后）
            const sortedRecords = [...records].reverse();
            const hasMore = messages.length >= messagesPageSize && messages.length < messagesMaxLimit;

            this.setData({
              'room.records': sortedRecords,
              messagesLoaded: sortedRecords.length,
              hasMore,
              loadingMoreText: hasMore ? '上拉查看更多历史消息' : '已显示全部消息'
            });
            // 初始加载时滚动到底部
            if (isInitialLoad && sortedRecords.length > 0) {
              setTimeout(() => {
                this.scrollToBottom();
              }, 100);
            }
          }
        },
        fail: (err) => {
          console.error('加载消息失败:', err);
        }
      });
  },

  /**
   * 加载更多历史消息
   */
  loadMoreMessages() {
    const { roomId, messagesLoaded, messagesPageSize, messagesMaxLimit, isLoadingMore, hasMore } = this.data;

    if (isLoadingMore || !hasMore) {
      return;
    }

    if (messagesLoaded >= messagesMaxLimit) {
      this.setData({
        hasMore: false,
        loadingMoreText: '最多显示100条历史消息'
      });
      return;
    }

    this.setData({ isLoadingMore: true, loadingMoreText: '加载中...' });

    const limit = Math.min(messagesLoaded + messagesPageSize, messagesMaxLimit);

    wx.cloud.database().collection('messages')
      .where({ roomId })
      .orderBy('timestamp', 'desc')
      .limit(limit)
      .get({
        success: (res) => {
          if (res.data) {
            const messages = res.data;
            const records = this.convertMessagesToRecords(messages);
            // 将消息按时间正序排列（最新的在最后）
            const sortedRecords = [...records].reverse();
            const hasMore = messages.length >= limit && messages.length < messagesMaxLimit;

            this.setData({
              'room.records': sortedRecords,
              messagesLoaded: sortedRecords.length,
              hasMore,
              isLoadingMore: false,
              loadingMoreText: hasMore ? '上拉查看更多历史消息' : '已显示全部消息'
            });
          }
        },
        fail: (err) => {
          console.error('加载更多失败:', err);
          this.setData({
            isLoadingMore: false,
            loadingMoreText: '加载失败，点击重试'
          });
        }
      });
  },

  /**
   * 滚动到顶部时触发
   */
  onScrollToUpper() {
    this.loadMoreMessages();
  },

  /**
   * 点击加载更多提示
   */
  onLoadingMoreTap() {
    const { isLoadingMore, loadingMoreText } = this.data;
    if (!isLoadingMore && loadingMoreText.includes('加载失败')) {
      this.loadMoreMessages();
    }
  },

  /**
   * 生成消息唯一ID（用于去重）
   * @param {Object} record - 消息记录
   * @returns {string} 消息ID
   */
  generateMessageId(record) {
    return `${record.description}_${record.time}`;
  },

  /**
   * 添加消息ID到本地集合
   * @param {Object} record - 消息记录
   */
  addLocalMessageId(record) {
    const msgId = this.generateMessageId(record);
    const localMessageIds = this.data.localMessageIds || [];
    if (!localMessageIds.includes(msgId)) {
      localMessageIds.push(msgId);
      this.setData({ localMessageIds });
    }
  },

  /**
   * 转换数据库消息为前端记录格式
   * @param {Array} messages - 数据库消息数组
   * @returns {Array} 前端记录数组
   */
  convertMessagesToRecords(messages) {
    const currentUser = this.data.currentUser;
    const roomMembers = this.data.room.members || [];
    const defaultAvatar = '/images/avatar.png';

    const getAvatar = (msgAvatar, nickname) => {
      if (msgAvatar) return msgAvatar;
      const member = roomMembers.find(m => m.name === nickname);
      return member ? (member.avatarUrl || defaultAvatar) : defaultAvatar;
    };

    return messages.map(msg => {
      const description = msg.content;
      const time = this.formatMessageTime(msg.timestamp);
      const { processedDescription, hasMe, segments } = this.generateSegments(description, currentUser);

      let detail = { type: 'other' };
      let isSystem = false;

      if (msg.messageType === 'welcome') {
        const operatorAvatar = getAvatar(msg.fromAvatar, msg.fromNickname);
        detail = {
          type: 'welcome',
          operator: msg.fromNickname,
          operatorAvatar
        };
        isSystem = true;
      } else if (description.includes('转给')) {
        const transferMatch = description.match(/转给 (\S+) (\d+) 分/);
        if (transferMatch) {
          const senderAvatar = getAvatar(msg.fromAvatar, msg.fromNickname);
          const receiverNickname = transferMatch[1];
          const receiverAvatar = getAvatar(msg.toAvatar, receiverNickname);

          detail = {
            type: 'transfer',
            sender: msg.fromNickname,
            senderAvatar,
            receiver: receiverNickname,
            receiverAvatar,
            amount: parseInt(transferMatch[2])
          };
        }
      } else if (description.includes('下注')) {
        const betMatch = description.match(/下注 (\d+) 分/);
        if (betMatch) {
          const operatorAvatar = getAvatar(msg.fromAvatar, msg.fromNickname);
          detail = {
            type: 'bet',
            operator: msg.fromNickname,
            operatorAvatar,
            amount: parseInt(betMatch[1])
          };
        }
      } else if (description.includes('All-in')) {
        const allinMatch = description.match(/All-in (\d+) 分/);
        if (allinMatch) {
          const operatorAvatar = getAvatar(msg.fromAvatar, msg.fromNickname);
          detail = {
            type: 'allin',
            operator: msg.fromNickname,
            operatorAvatar,
            amount: parseInt(allinMatch[1])
          };
        }
      } else if (description.includes('收走了奖池')) {
        const claimMatch = description.match(/收走了奖池 (\d+) 分/);
        if (claimMatch) {
          const operatorAvatar = getAvatar(msg.fromAvatar, msg.fromNickname);
          detail = {
            type: 'claim',
            operator: msg.fromNickname,
            operatorAvatar,
            amount: parseInt(claimMatch[1])
          };
        }
      } else if (description.includes('跳过了这回合')) {
        const passMatch = description.match(/(\S+) 跳过了这回合/);
        if (passMatch) {
          const operatorAvatar = getAvatar(msg.fromAvatar, msg.fromNickname);
          detail = {
            type: 'pass',
            operator: msg.fromNickname,
            operatorAvatar
          };
          isSystem = true;
        }
      }

      return { description, processedDescription, time, detail, hasMe, isSystem, isReceive: false, segments };
    });
  },

  /**
   * 格式化消息时间
   * 今天的消息只显示时间，非今天的显示完整日期
   * @param {Date|string} timestamp - 时间戳或日期对象
   * @returns {string} 格式化的时间字符串
   */
  formatMessageTime(timestamp) {
    const date = new Date(timestamp);
    const now = new Date();
    const isToday = date.getDate() === now.getDate() &&
                    date.getMonth() === now.getMonth() &&
                    date.getFullYear() === now.getFullYear();

    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');

    if (isToday) {
      return `${hours}:${minutes}`;
    } else {
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      return `${year}-${month}-${day} ${hours}:${minutes}`;
    }
  },

  /**
   * 加载房间数据
   * 从云数据库加载房间信息并初始化显示
   * @param {string} roomId - 房间ID
   */
  loadRoom(roomId) {
    if (!roomId) {
      wx.showToast({
        title: '房间ID不存在',
        icon: 'none'
      });
      setTimeout(() => wx.navigateBack(), 1500);
      return;
    }

    wx.cloud.database().collection('rooms').doc(roomId).get({
      success: (res) => {
        if (res.data) {
          const room = res.data;
          this.processRoomData(room);
          // 加载消息列表
          this.loadMessages(roomId);
        } else {
          wx.showToast({
            title: '房间不存在',
            icon: 'none'
          });
          setTimeout(() => wx.navigateBack(), 1500);
        }
      },
      fail: (err) => {
        console.error('加载房间失败:', err);
        // 房间不存在，清理本地状态并返回
        wx.removeStorageSync('currentRoomId');
        wx.showToast({
          title: '房间不存在或已解散',
          icon: 'none'
        });
        setTimeout(() => wx.navigateBack(), 1500);
      }
    });
  },

  /**
   * 处理房间数据
   * 将云数据库的房间数据格式化并设置到页面
   * @param {Object} room - 房间数据
   */
  processRoomData(room) {
    // 设置导航栏标题
    if (room.roomName) {
      wx.setNavigationBarTitle({
        title: room.roomName
      });
    }

    // 数据字段映射：云数据库字段 -> 页面显示字段
    const processedRoom = {
      _id: room._id,
      roomName: room.roomName,
      gameMode: room.mode === 'bet' ? 'bet' : 'normal',
      members: room.players.map(player => ({
        openid: player.openid,
        name: player.nickname,
        avatarUrl: player.avatar,
        score: player.score,
        isExited: player.isExited || false
      })),
      records: [],
      creator: room.owner,
      // 状态映射：云函数 'active'/'settled' -> 前端 'playing'/'ended'
      status: room.status === 'active' ? 'playing' : (room.status === 'settled' ? 'ended' : room.status),
      prizePool: {
        total: room.pot || 0,
        receiver: '',
        receivedTime: ''
      },
      allInValue: room.allInVal || 0
    };

    // 判断当前用户是否为房主
    const myOpenid = wx.getStorageSync('openid');
    const isCreator = room.owner === myOpenid;

    // 为members添加默认头像和积分滚动检测
    processedRoom.members = processedRoom.members.map(member => {
      const scoreText = member.score > 0 ? `+${member.score}` : `${member.score}`;
      const scoreScroll = scoreText.length > 7;
      return {
        ...member,
        avatarUrl: member.avatarUrl || '',
        scoreScroll
      };
    });

    // 下注模式：初始化跟注相关数据
    let lastDepositAmount = 0;
    let lastDepositOperator = '';
    let canFollow = false;

    this.setData({
      room: processedRoom,
      lastDepositAmount,
      lastDepositOperator,
      canFollow,
      isCreator
    });
  },

  /**
   * 保存房间数据到云数据库
   * 注：此函数已废弃，所有数据更新通过云函数完成
   * 数据同步通过 loadRoom() 重新加载实现
   */
  saveRoomData() {
    console.log('saveRoomData已废弃，使用云函数更新数据');
  },

  /**
   * 处理玩家点击事件
   * 根据游戏模式执行不同的操作：
   * - 普通模式：显示转账弹窗
   * - 下注模式：提示仅支持向奖池转入
   * @param {Object} e - 事件对象
   */
  handleMemberTap(e) {
    const index = e.currentTarget.dataset.index;
    const member = this.data.room.members[index];

    // 游戏已结束，不允许操作
    if (this.data.room.status !== 'playing') {
      // this.showTip('游戏已结束，无法操作');
      return;
    }

    // 普通模式：检查是否点击自己
    if (this.data.room.gameMode === 'normal') {
      if (member.name === this.data.currentUser) {
        // this.showTip('不能向自己转账');
        return;
      }

      // 普通模式：点击玩家头像弹出转账弹窗
      this.setData({
        targetMemberIndex: index,
        targetMember: member.name,
        showTransferModal: true,
        transferAmount: '',
        showInputError: false
      });
    } else {
      // 下注模式：提示仅支持向奖池转入
      // this.showTip('本模式仅支持向奖池转入积分');
    }
  },

  /**
   * 转账金额输入
   */
  onTransferAmountInput(e) {
    const value = e.detail.value;
    this.setData({ transferAmount: value, showInputError: false });
  },

  /**
   * 确认转账
   * 功能：普通模式下，玩家A向玩家B转账积分
   * 入参：transferAmount（积分金额，正整数）
   * 出参：无
   * 逻辑步骤：
   *   1. 验证输入是否为正整数
   *   2. 调用云函数执行转账
   *   3. 重新加载房间数据
   */
  confirmTransfer() {
    const amount = parseInt(this.data.transferAmount);

    // 验证输入
    if (!this.validatePositiveInteger(amount)) {
      this.setData({ showInputError: true });
      return;
    }

    const room = this.data.room;
    const currentUser = this.data.currentUser;
    const targetIndex = this.data.targetMemberIndex;

    // 找到接收方
    const receiver = room.members[targetIndex];

    // 调用云函数执行转账
    wx.cloud.callFunction({
      name: 'gameLogic',
      data: {
        action: 'TRANSFER',
        payload: {
          roomId: this.data.roomId,
          amount: amount,
          toOpenid: receiver.openid,
          nickname: currentUser,
          toNickname: receiver.name
        }
      },
      success: (res) => {
        if (res.result.success) {
          this.closeTransferModal();
          // 消息由 watch 监听器自动同步
        } else {
          wx.showToast({
            title: res.result.msg || '转账失败',
            icon: 'none'
          });
        }
      },
      fail: (err) => {
        console.error('转账失败:', err);
        wx.showToast({
          title: '转账失败，请重试',
          icon: 'none'
        });
      }
    });
  },

  /**
   * 关闭转账弹窗
   */
  closeTransferModal() {
    this.setData({ showTransferModal: false });
  },

  /**
   * 点击奖池转入按钮
   * 打开转入奖池弹窗（仅下注模式）
   */
  transferToPrizePool() {
    // 游戏已结束，不允许操作
    if (this.data.room.status !== 'playing') {
      // this.showTip('游戏已结束，无法操作');
      return;
    }

    this.setData({
      showPrizeModal: true,
      prizeAmount: '',
      showInputError: false
    });
  },

  /**
   * 奖池金额输入事件
   * @param {Object} e - 事件对象，包含输入的金额
   */
  onPrizeAmountInput(e) {
    const value = e.detail.value;
    this.setData({ prizeAmount: value, showInputError: false });
  },

  /**
   * 确认转入奖池
   * 功能：下注模式下，玩家向奖池转入积分
   * 入参：prizeAmount（积分金额，正整数）
   * 出参：无
   * 逻辑步骤：
   *   1. 验证输入是否为正整数
   *   2. 找到操作玩家
   *   3. 玩家积分 -= 金额
   *   4. 奖池总额 += 金额
   *   5. 播放数字跳动动画
   *   6. 生成转入记录
   *   7. 更新房间数据并保存
    */
  confirmPrizeTransfer() {
    const amount = parseInt(this.data.prizeAmount);

    // 验证输入
    if (!this.validatePositiveInteger(amount)) {
      this.setData({ showInputError: true });
      return;
    }

    // 调用云函数执行转入
    wx.cloud.callFunction({
      name: 'gameLogic',
      data: {
        action: 'BET',
        payload: {
          roomId: this.data.roomId,
          amount: amount,
          nickname: this.data.currentUser
        }
      },
      success: (res) => {
        if (res.result.success) {
          this.closePrizeModal();

          // 找到当前玩家位置（用于动画）
          const room = this.data.room;
          const playerIndex = room.members.findIndex(m => m.name === this.data.currentUser);
          if (playerIndex !== -1) {
            this.triggerDepositAnimation(playerIndex, amount);
          }
          // 消息由 watch 监听器自动同步
        } else {
          wx.showToast({
            title: res.result.msg || '转入失败',
            icon: 'none'
          });
        }
      },
      fail: (err) => {
        console.error('转入失败:', err);
        wx.showToast({
          title: '转入失败，请重试',
          icon: 'none'
        });
      }
    });
  },

  /**
   * 更新成员积分滚动标志
   * 检测积分是否需要滚动（超过7位数字，包括符号）
   * @param {Object} member - 成员对象
   */
  updateMemberScrollFlags(member) {
    const scoreText = member.score > 0 ? `+${member.score}` : `${member.score}`;
    const scoreScroll = scoreText.length > 7;
    member.scoreScroll = scoreScroll;
  },

  /**
   * 生成分段数据
   * 将描述分割成片段，用于单独高亮"我"字和金额
   * @param {string} description - 原始描述
   * @param {string} currentUser - 当前用户名
   * @returns {Array} 分段数组
   */
  generateSegments(description, currentUser) {
    const processedDescription = currentUser ? description.replace(currentUser, '我') : description;
    const hasMe = processedDescription.includes('我');
    let segments = [];

    if (hasMe) {
      const parts = processedDescription.split('我');
      for (let i = 0; i < parts.length; i++) {
        if (parts[i]) {
          const amountMatch = parts[i].match(/\d+/);
          if (amountMatch) {
            const amountStr = amountMatch[0];
            const amountParts = parts[i].split(amountStr);
            if (amountParts[0]) {
              segments.push({ text: amountParts[0], isMe: false, isAmount: false });
            }
            segments.push({ text: amountStr, isMe: false, isAmount: true });
            if (amountParts[1]) {
              segments.push({ text: amountParts[1], isMe: false, isAmount: false });
            }
          } else {
            segments.push({ text: parts[i], isMe: false, isAmount: false });
          }
        }
        if (i < parts.length - 1) {
          segments.push({ text: '我', isMe: true, isAmount: false });
        }
      }
    } else {
      const amountMatch = processedDescription.match(/\d+/);
      if (amountMatch) {
        const amountStr = amountMatch[0];
        const amountParts = processedDescription.split(amountStr);
        if (amountParts[0]) {
          segments.push({ text: amountParts[0], isMe: false, isAmount: false });
        }
        segments.push({ text: amountStr, isMe: false, isAmount: true });
        if (amountParts[1]) {
          segments.push({ text: amountParts[1], isMe: false, isAmount: false });
        }
      } else {
        segments.push({ text: processedDescription, isMe: false, isAmount: false });
      }
    }

    return { processedDescription, hasMe, segments };
  },

  /**
   * 生成转账记录
   * @param {Object} params - 参数对象
   * @returns {Object} 记录对象
   */
  createTransferRecord(params) {
    const { sender, receiver, amount, senderAvatar, receiverAvatar, senderScoreAfter, receiverScoreAfter } = params;
    const description = `${sender} 转 ${amount} 分给 ${receiver.name}`;
    const { processedDescription, hasMe, segments } = this.generateSegments(description, sender);

    return {
      description,
      processedDescription,
      time: this.getCurrentTime(),
      detail: {
        type: 'transfer',
        sender,
        senderAvatar,
        receiver: receiver.name,
        receiverAvatar,
        amount,
        senderScoreAfter,
        receiverScoreAfter
      },
      hasMe,
      isSystem: false,
      isReceive: false,
      segments
    };
  },

  /**
   * 生成奖池转入记录
   * @param {Object} params - 参数对象
   * @returns {Object} 记录对象
   */
  createDepositRecord(params) {
    const { operator, amount, playerAvatar, playerScoreAfter, prizePoolAfter, recordType, recordTypeText } = params;
    const description = `${operator} ${recordTypeText} ${amount} 分`;
    const { processedDescription, hasMe, segments } = this.generateSegments(description, operator);

    return {
      description,
      processedDescription,
      time: this.getCurrentTime(),
      detail: {
        type: recordType,
        operator,
        operatorAvatar: playerAvatar,
        avatarUrl: playerAvatar,
        amount,
        playerScoreAfter,
        prizePoolAfter
      },
      hasMe,
      isSystem: false,
      isReceive: false,
      segments
    };
  },

  /**
   * 关闭奖池转入弹窗
   */
  closePrizeModal() {
    this.setData({ showPrizeModal: false });
  },

  /**
   * 点击收取奖池按钮
   * 打开收取奖池确认弹窗（仅下注模式）
   */
  receivePrizePool() {
    // 游戏已结束，不允许操作
    if (this.data.room.status !== 'playing') {
      // this.showTip('游戏已结束，无法操作');
      return;
    }

    // 奖池已被收取
    if (this.data.room.prizePool.receiver) {
      this.showTip('奖池已被收取');
      return;
    }

    // 奖池为空
    if (this.data.room.prizePool.total <= 0) {
      this.showTip('奖池为空');
      return;
    }

    this.setData({ showReceiveModal: true });
  },

  /**
   * 确认收取奖池
   * 功能：下注模式下，玩家收取全部奖池积分
   * 入参：无
   * 出参：无
   * 逻辑步骤：
   *   1. 获取当前奖池总额
   *   2. 找到操作玩家
    *   3. 玩家积分 += 奖池总额
    *   4. 奖池总额重置为0
    *   5. 设置收取人信息（永久显示）
    *   6. 生成收取记录
    *   7. 更新房间数据并保存
    */
  confirmReceive() {
    const room = this.data.room;

    // 验证
    if (room.prizePool.receiver) {
      this.showTip('奖池已被收取');
      return;
    }

    if (room.prizePool.total <= 0) {
      this.showTip('奖池为空');
      return;
    }

    // 保存奖池金额用于动画（在清零之前）
    const displayAmount = room.prizePool.total;

    // 调用云函数执行收取
    wx.cloud.callFunction({
      name: 'gameLogic',
      data: {
        action: 'CLAIM',
        payload: {
          roomId: this.data.roomId,
          nickname: this.data.currentUser
        }
      },
      success: (res) => {
        if (res.result.success) {
          this.closeReceiveModal();
          this.triggerReceiveAnimation(displayAmount);
          // 消息由 watch 监听器自动同步
        } else {
          wx.showToast({
            title: res.result.msg || '收取失败',
            icon: 'none'
          });
        }
      },
      fail: (err) => {
        console.error('收取失败:', err);
        wx.showToast({
          title: '收取失败，请重试',
          icon: 'none'
        });
      }
    });
  },

  /**
   * 关闭收取确认弹窗
   */
  closeReceiveModal() {
    this.setData({ showReceiveModal: false });
  },

  /**
   * 添加成员
   * 弹出输入框让用户输入新成员昵称
   */
  addMember() {
    const room = this.data.room;
    if (room.members.length >= 8) {
      this.showTip('房间人数已达上限（8人）');
      return;
    }

    wx.showModal({
      title: '添加成员',
      editable: true,
      placeholderText: '请输入成员昵称',
      success: (res) => {
        if (res.confirm && res.content) {
          const memberName = res.content.trim();
          const exists = room.members.some(m => m.name === memberName);

          if (memberName && !exists) {
            room.members.push({ name: memberName, avatarUrl: '', score: 0 });
            this.setData({ room });
            this.saveRoomData();
            this.showTip('添加成功');
          } else if (exists) {
            this.showTip('该成员已存在');
          }
        }
      }
    });
  },

  /**
   * 处理支出按钮点击事件
   * 打开批量支出弹窗
   */
  handleExpenseBtn() {
    const room = this.data.room;

    // 游戏已结束
    if (room.status !== 'playing') {
      this.showTip('本局游戏已结束，无法进行支出');
      return;
    }

    // 初始化支出金额数据
    const expenseAmounts = {};
    this.setData({ showExpenseModal: true, expenseAmounts, expenseTotal: 0 });
  },

  /**
   * 关闭支出弹窗
   */
  closeExpenseModal() {
    this.setData({ showExpenseModal: false });
  },

  /**
   * 支出金额输入事件
   * @param {Object} e - 事件对象，包含成员名称和输入的金额
   */
  onExpenseAmountInput(e) {
    const memberName = e.currentTarget.dataset.name;
    const value = e.detail.value;

    // 更新支出金额
    const expenseAmounts = { ...this.data.expenseAmounts };
    expenseAmounts[memberName] = value;

    // 计算总计
    let total = 0;
    for (const key in expenseAmounts) {
      const amount = parseInt(expenseAmounts[key]) || 0;
      if (amount > 0) {
        total += amount;
      }
    }

    this.setData({ expenseAmounts, expenseTotal: total });
  },

  /**
   * 确认支出
   * 批量向多个玩家转账积分
   */
  confirmExpense() {
    const room = this.data.room;
    const currentUser = this.data.currentUser;
    const expenseAmounts = this.data.expenseAmounts;

    // 验证是否有输入
    const hasInput = Object.values(expenseAmounts).some(value => {
      const amount = parseInt(value) || 0;
      return amount > 0;
    });

    if (!hasInput) {
      this.showTip('请输入支出金额');
      return;
    }

    // 准备转账列表
    const transferList = [];
    let totalAmount = 0;

    for (const memberName in expenseAmounts) {
      const amount = parseInt(expenseAmounts[memberName]) || 0;
      if (amount > 0) {
        const receiver = room.members.find(m => m.name === memberName);
        if (!receiver) {
          this.showTip('找不到接收玩家');
          return;
        }

        // 验证是否为正整数
        if (!this.validatePositiveInteger(amount)) {
          this.showTip(`请输入正整数积分（玩家：${receiver.name}）`);
          return;
        }

        transferList.push({
          openid: receiver.openid,
          nickname: receiver.name,
          amount: amount
        });
        totalAmount += amount;
      }
    }

    // 调用云函数执行批量转账
    wx.cloud.callFunction({
      name: 'gameLogic',
      data: {
        action: 'BATCH_TRANSFER',
        payload: {
          roomId: this.data.roomId,
          transferList: transferList,
          nickname: currentUser
        }
      },
      success: (res) => {
        if (res.result.success) {
          // 本地优先显示消息
          transferList.forEach(item => {
            this.addLocalTransferMessage('transfer', {
              sender: currentUser,
              receiver: item.nickname,
              amount: item.amount,
              senderAvatar: room.members.find(m => m.name === currentUser)?.avatarUrl || '/images/avatar.png',
              receiverAvatar: room.members.find(m => m.name === item.nickname)?.avatarUrl || '/images/avatar.png'
            });
          });

          this.closeExpenseModal();

          // 不需要重新加载房间，watch监听器会自动同步消息
        } else {
          wx.showToast({
            title: res.result.msg || '支出失败',
            icon: 'none'
          });
        }
      },
      fail: (err) => {
        console.error('支出失败:', err);
        wx.showToast({
          title: '支出失败，请重试',
          icon: 'none'
        });
      }
    });
  },

  /**
   * 处理结算按钮点击事件
   * 新增：房主判断逻辑 room.owner == myOpenid
   * 非房主点击直接禁用 / 提示 "只有房主可以结算"
   */
  handleSettleBtn() {
    const room = this.data.room;
    const myOpenid = wx.getStorageSync('openid');
    
    // 新增：房主判断逻辑 room.owner == myOpenid
    if (room.owner !== myOpenid) {
      wx.showToast({
        title: '只有房主可以结算',
        icon: 'none'
      });
      return;
    }
    
    // 原有的结算确认弹窗逻辑
    this.setData({ showSettleConfirm: true });
  },

  /**
   * 关闭结算确认弹窗
   */
  closeSettleConfirm() {
    this.setData({ showSettleConfirm: false });
  },

  /**
   * 确认结算
   * 调用 roomFunctions 云函数的 settle 动作
   * 参数标准化：仅传递 roomId
   */
  confirmSettle() {
    const roomId = this.data.roomId;

    // 参数标准化：云函数期望 { roomId }
    wx.cloud.callFunction({
      name: 'roomFunctions',
      data: {
        action: 'settle',
        payload: {
          roomId: roomId  // ✅ 标准化参数：roomId
        }
      },
      success: (res) => {
        if (res.result.success) {
          // 重新加载房间数据（状态变为'settled'，映射为'ended'）
          this.closeSettleConfirm();
          this.loadRoom(roomId);
          // 显示结算结果弹窗
          this.showResultModal();
        } else {
          // 失败：获取 msg，保留原有错误提示逻辑
          wx.showToast({
            title: res.result.msg || '结算失败',
            icon: 'none'
          });
        }
      },
      fail: (err) => {
        console.error('结算失败:', err);
        wx.showToast({
          title: '结算失败',
          icon: 'none'
        });
      }
    });
  },

  /**
   * 显示结算结果弹窗
   * 根据当前房间成员的积分生成战绩数据
   */
  showResultModal() {
    const room = this.data.room;
    const settlementTime = this.getCurrentTime();

    // 赢家：score > 0
    const winners = room.members
      .filter(m => m.score > 0)
      .map(m => ({
        playerName: m.name,
        avatarUrl: m.avatarUrl,
        score: m.score,
        displayScore: `+${m.score}`,
        barHeight: Math.max(3, m.score * 3) // 简单映射积分到柱状条长度
      }))
      .sort((a, b) => b.score - a.score); // 按积分降序排列

    // 输家：score < 0
    const losers = room.members
      .filter(m => m.score < 0)
      .map(m => ({
        playerName: m.name,
        avatarUrl: m.avatarUrl,
        score: m.score,
        displayScore: `${m.score}`,
        barHeight: Math.max(3, Math.abs(m.score) * 3) // 简单映射积分到柱状条长度
      }))
      .sort((a, b) => a.score - b.score); // 按积分升序排列

    // 房间模式
    const roomMode = room.gameMode === 'bet' ? '下注模式' : '普通模式';

    // 奖池信息（仅下注模式）
    let prizePoolInfo = null;
    if (room.gameMode === 'bet' && room.prizePool.total > 0) {
      prizePoolInfo = {
        totalPrizePool: room.prizePool.total,
        receiver: room.prizePool.receiver || ''
      };
    }

    this.setData({
      resultData: {
        roomName: room.roomName,
        roomMode,
        settlementTime,
        winners,
        losers,
        prizePoolInfo,
        isUploaded: false
      },
      showResultModal: true
    });
  },

  /**
   * 计算奖池总转入金额
   * 遍历所有记录，统计转入奖池的总金额（用于下注模式结算）
   * @param {Array} records - 操作记录列表
   * @returns {number} 奖池总金额
   */
  calculateTotalPrizePool(records) {
    let total = 0;
    records.forEach(record => {
      if (record.detail && record.detail.type === 'deposit') {
        total += record.detail.amount;
      }
    });
    return total;
  },

  /**
   * 预加载头像图片
   * @param {Object} canvas - Canvas节点
   * @param {Array} players - 玩家列表
   * @returns {Promise<Array>} 头像图片数组
   */
  loadPlayerAvatars(canvas, players) {
    return Promise.all(players.map(player => {
      return new Promise((resolve) => {
        if (player.avatarUrl) {
          const img = canvas.createImage();
          img.onload = () => resolve({ img, player, success: true });
          img.onerror = () => resolve({ img: null, player, success: false });
          img.src = player.avatarUrl;
        } else {
          resolve({ img: null, player, success: false });
        }
      });
    }));
  },

  /**
   * 生成战绩图片
   * 使用Canvas 2D API绘制Excel柱状图风格的战绩卡片
   * 优化：添加异常处理、动态计算Canvas尺寸、确保绘制完整性、预加载头像
   */
  generateResultImage() {
    return new Promise((resolve, reject) => {
      const query = wx.createSelectorQuery();
      query.select('#resultCanvas')
        .fields({ node: true, size: true })
        .exec(async (res) => {
        try {
          if (!res || !res[0]) {
            console.error('Canvas节点获取失败');
            this.showTip('图片生成失败，请重试');
            return;
          }

          const canvas = res[0].node;
          if (!canvas) {
            console.error('Canvas节点不存在');
            this.showTip('图片生成失败，请重试');
            return;
          }

          const ctx = canvas.getContext('2d');
          if (!ctx) {
            console.error('Canvas 2D上下文获取失败');
            this.showTip('图片生成失败，请重试');
            return;
          }

          const systemInfo = wx.getSystemInfoSync();
          const dpr = systemInfo.pixelRatio || 2;

          // 动态计算Canvas尺寸（根据内容自适应）
          const resultData = this.data.resultData;
          const winners = resultData.winners || [];
          const losers = resultData.losers || [];

          // 计算所需高度
          let contentHeight = 60; // 房间名高度
          contentHeight += 40; // 结算信息区域顶部间距

          // 结算信息区域高度
          contentHeight += 40; // 标题
          contentHeight += 15; // 分隔线间距
          contentHeight += 50; // 房间名
          contentHeight += 50; // 结算时间
          contentHeight += 50; // 房间模式
          contentHeight += 50; // 奖池总额（下注模式）
          contentHeight += 50; // 收取人（下注模式）
          if (resultData.creator) {
            contentHeight += 50; // 结算触发人
          }
          contentHeight += 20; // 分隔线间距

          // 赢家板块高度
          if (winners.length > 0) {
            contentHeight += 40; // 板块间距
            contentHeight += 60; // 标题区域
            contentHeight += winners.length * 80; // 用户列表
            contentHeight += 40; // 底部间距
          }

          // 输家板块高度
          if (losers.length > 0) {
            contentHeight += 40; // 板块间间距（如果有赢家）
            contentHeight += 60; // 标题区域
            contentHeight += losers.length * 80; // 用户列表
            contentHeight += 40; // 底部间距
          }

          // 无输赢情况
          if (winners.length === 0 && losers.length === 0) {
            contentHeight += 50; // 提示区域
          }

          contentHeight += 40; // 底部留白

          // 设置Canvas尺寸（最小720px高度确保清晰度）
          const width = 500;
          const calculatedHeight = Math.max(contentHeight, 720);

          canvas.width = width * dpr;
          canvas.height = calculatedHeight * dpr;
          ctx.scale(dpr, dpr);

          // 清空画布
          ctx.clearRect(0, 0, width, calculatedHeight);

          // 绘制白色背景
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, width, calculatedHeight);

          // 绘制房间名（居中，橙色，与弹窗一致）
          ctx.fillStyle = '#FF7A2F';
          ctx.font = 'bold 40px Arial';
          ctx.textAlign = 'center';
          ctx.fillText(this.data.resultData.roomName, width / 2, 60);

          let currentY = 120;

          // 绘制结算信息区域（置顶）
          ctx.fillStyle = '#fafafa';
          ctx.fillRect(20, currentY - 20, width - 40, 180);

          // 绘制结算信息标题
          ctx.fillStyle = '#333333';
          ctx.font = 'bold 36px Arial';
          ctx.textAlign = 'left';
          ctx.fillText('结算信息', 30, currentY + 10);

          // 绘制分隔线
          ctx.fillStyle = '#e8e8e8';
          ctx.fillRect(20, currentY + 35, width - 40, 1);

          // 绘制结算信息内容
          currentY += 70;
          ctx.font = '28px Arial';
          ctx.textAlign = 'left';

          // 房间名
          ctx.fillStyle = '#666666';
          ctx.fillText('房间名:', 30, currentY);
          ctx.fillStyle = '#333333';
          ctx.font = 'bold 28px Arial';
          ctx.fillText(this.data.resultData.roomName, 100, currentY);

          currentY += 40;
          ctx.font = '28px Arial';
          ctx.fillStyle = '#666666';

          // 结算时间
          ctx.fillText('结算时间:', 30, currentY);
          ctx.fillStyle = '#333333';
          ctx.fillText(this.data.resultData.settlementTime, 100, currentY);

          currentY += 40;

          // 房间模式
          ctx.fillStyle = '#666666';
          ctx.fillText('房间模式:', 30, currentY);
          ctx.fillStyle = this.data.resultData.roomMode === '下注模式' ? '#FF7A2F' : '#4CD964';
          ctx.font = 'bold 28px Arial';
          ctx.fillText(this.data.resultData.roomMode, 100, currentY);

          currentY += 40;

          // 结算触发人
          if (this.data.resultData.creator) {
            ctx.font = '28px Arial';
            ctx.fillStyle = '#666666';
            ctx.fillText('结算触发人:', 30, currentY);
            ctx.fillStyle = '#333333';
            ctx.fillText(this.data.resultData.creator, 130, currentY);
            currentY += 40;
          }

          // 下注模式奖池信息
          if (this.data.resultData.roomMode === '下注模式' && this.data.resultData.prizePoolInfo) {
            const prizeInfo = this.data.resultData.prizePoolInfo;

            // 奖池总额
            ctx.font = '28px Arial';
            ctx.fillStyle = '#666666';
            ctx.fillText('奖池总额:', 30, currentY);
            ctx.fillStyle = '#FF7A2F';
            ctx.font = 'bold 28px Arial';
            ctx.fillText(`${prizeInfo.totalPrizePool} 积分`, 130, currentY);
            currentY += 40;

            // 收取人
            if (prizeInfo.receiver) {
              ctx.font = '28px Arial';
              ctx.fillStyle = '#666666';
              ctx.fillText('收取人:', 30, currentY);
              ctx.fillStyle = '#333333';
              ctx.fillText(prizeInfo.receiver, 100, currentY);
              currentY += 40;
            }
          }

          currentY += 30;

          // 绘制分隔线
          ctx.fillStyle = '#e8e8e8';
          ctx.fillRect(20, currentY - 10, width - 40, 1);

          currentY += 30;

          // 预加载所有头像
          let winnerImages = [];
          let loserImages = [];
          
          if (winners.length > 0) {
            winnerImages = await this.loadPlayerAvatars(canvas, winners);
          }
          
          if (losers.length > 0) {
            loserImages = await this.loadPlayerAvatars(canvas, losers);
          }

          // 绘制赢家板块
          if (winners.length > 0) {
            // 板块标题（居中，与弹窗一致）
            ctx.fillStyle = '#333333';
            ctx.font = 'bold 36px Arial';
            ctx.textAlign = 'center';

            // 绘制绿色图标
            ctx.fillStyle = '#4CD964';
            ctx.beginPath();
            ctx.arc(width / 2 - 50, currentY - 10, 16, 0, 2 * Math.PI);
            ctx.fill();

            // 绘制标题文字
            ctx.fillStyle = '#333333';
            ctx.fillText('赢家', width / 2, currentY);

            // 标题下方增加间距，确保不与用户项重叠
            const userListY = currentY + 80;

            // 绘制横向柱状图（统一变量 - 与WXSS弹窗样式完全一致）
            const avatarRadius = 40;      // 头像半径40px（80rpx）
            const avatarCenterX = 40;     // 头像中心在40px
            const nameStartX = 96;        // 用户名起始：头像80 + 间距16 = 96px
            const nameWidth = 80;         // 用户名宽度80px（160rpx）
            const barStartX = 184;        // 柱状条起始：96 + 80 + 间距8 = 184px
            const barHeight = 20;
            const scoreMargin = 10;

            winners.forEach((winner, index) => {
              const startY = userListY + index * 80;
              const barWidth = winner.barHeight || 3;

              // 绘制头像背景（圆形）
              ctx.fillStyle = '#e0e0e0';
              ctx.beginPath();
              ctx.arc(avatarCenterX, startY + avatarRadius, avatarRadius, 0, 2 * Math.PI);
              ctx.fill();

              // 如果有头像，绘制头像（使用预加载的图片）
              const imageData = winnerImages[index];
              if (imageData && imageData.img) {
                // 保存当前状态
                ctx.save();
                
                // 创建圆形裁剪区域
                ctx.beginPath();
                ctx.arc(avatarCenterX, startY + avatarRadius, avatarRadius, 0, 2 * Math.PI);
                ctx.clip();
                
                // 绘制头像图片（居中裁剪）
                const imgSize = avatarRadius * 2;
                const imgX = avatarCenterX - avatarRadius;
                const imgY = startY + avatarRadius - avatarRadius;
                ctx.drawImage(imageData.img, imgX, imgY, imgSize, imgSize);
                
                // 恢复状态
                ctx.restore();
              } else {
                // 没有头像时绘制首字
                ctx.fillStyle = '#666666';
                ctx.font = 'bold 24px Arial';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                const firstChar = winner.playerName.charAt(0);
                ctx.fillText(firstChar, avatarCenterX, startY + avatarRadius);
              }

              // 绘制用户名（左对齐，80px宽度）
              ctx.fillStyle = '#333333';
              ctx.font = '24px Arial';
              ctx.textAlign = 'left';
              ctx.textBaseline = 'alphabetic';

              // 截断过长用户名（限制最多6个字符）
              let displayName = winner.playerName;
              if (displayName.length > 6) {
                displayName = displayName.substring(0, 6) + '..';
              }
              // 左对齐绘制：用户名区域 96-176px（80px宽度）
              ctx.fillText(displayName, nameStartX, startY + avatarRadius + 8);

              // 绘制横向柱状条（起始位置184px，与用户名保持8px间距）
              ctx.fillStyle = '#4CD964';
              ctx.fillRect(barStartX, startY + avatarRadius - barHeight / 2, barWidth, barHeight);

              // 绘制积分值
              ctx.fillStyle = '#4CD964';
              ctx.font = 'bold 28px Arial';
              ctx.textAlign = 'left';
              ctx.fillText(winner.displayScore, barStartX + barWidth + scoreMargin, startY + avatarRadius + 8);
            });

            currentY = userListY + winners.length * 80 + 40;
          }

          // 绘制输家板块
          if (losers.length > 0) {
            // 板块标题（居中，与弹窗一致）
            ctx.fillStyle = '#333333';
            ctx.font = 'bold 36px Arial';
            ctx.textAlign = 'center';

            // 绘制红色图标
            ctx.fillStyle = '#FF3B30';
            ctx.beginPath();
            ctx.arc(width / 2 - 50, currentY - 10, 16, 0, 2 * Math.PI);
            ctx.fill();

            // 绘制标题文字
            ctx.fillStyle = '#333333';
            ctx.fillText('输家', width / 2, currentY);

            // 标题下方增加间距，确保不与用户项重叠
            const userListY = currentY + 80;

            // 绘制横向柱状图（统一变量 - 与WXSS弹窗样式完全一致）
            const avatarRadius = 40;      // 头像半径40px（80rpx）
            const avatarCenterX = 40;     // 头像中心在40px
            const nameStartX = 96;        // 用户名起始：头像80 + 间距16 = 96px
            const nameWidth = 80;         // 用户名宽度80px（160rpx）
            const barStartX = 184;        // 柱状条起始：96 + 80 + 间距8 = 184px
            const barHeight = 20;
            const scoreMargin = 10;

            losers.forEach((loser, index) => {
              const startY = userListY + index * 80;
              const barWidth = loser.barHeight || 3;

              // 绘制头像背景（圆形）
              ctx.fillStyle = '#e0e0e0';
              ctx.beginPath();
              ctx.arc(avatarCenterX, startY + avatarRadius, avatarRadius, 0, 2 * Math.PI);
              ctx.fill();

              // 如果有头像，绘制头像（使用预加载的图片）
              const imageData = loserImages[index];
              if (imageData && imageData.img) {
                // 保存当前状态
                ctx.save();
                
                // 创建圆形裁剪区域
                ctx.beginPath();
                ctx.arc(avatarCenterX, startY + avatarRadius, avatarRadius, 0, 2 * Math.PI);
                ctx.clip();
                
                // 绘制头像图片（居中裁剪）
                const imgSize = avatarRadius * 2;
                const imgX = avatarCenterX - avatarRadius;
                const imgY = startY + avatarRadius - avatarRadius;
                ctx.drawImage(imageData.img, imgX, imgY, imgSize, imgSize);
                
                // 恢复状态
                ctx.restore();
              } else {
                // 没有头像时绘制首字
                ctx.fillStyle = '#666666';
                ctx.font = 'bold 24px Arial';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                const firstChar = loser.playerName.charAt(0);
                ctx.fillText(firstChar, avatarCenterX, startY + avatarRadius);
              }

              // 绘制用户名（左对齐，80px宽度）
              ctx.fillStyle = '#333333';
              ctx.font = '24px Arial';
              ctx.textAlign = 'left';
              ctx.textBaseline = 'alphabetic';

              // 截断过长用户名（限制最多6个字符）
              let displayName = loser.playerName;
              if (displayName.length > 6) {
                displayName = displayName.substring(0, 6) + '..';
              }
              // 左对齐绘制：用户名区域 96-176px（80px宽度）
              ctx.fillText(displayName, nameStartX, startY + avatarRadius + 8);

              // 绘制横向柱状条（起始位置184px，与用户名保持8px间距）
              ctx.fillStyle = '#FF3B30';
              ctx.fillRect(barStartX, startY + avatarRadius - barHeight / 2, barWidth, barHeight);

              // 绘制积分值
              ctx.fillStyle = '#FF3B30';
              ctx.font = 'bold 28px Arial';
              ctx.textAlign = 'left';
              ctx.fillText(loser.displayScore, barStartX + barWidth + scoreMargin, startY + avatarRadius + 8);
            });

            currentY = userListY + losers.length * 80 + 40;
          }

          // 无输赢情况
          if (winners.length === 0 && losers.length === 0) {
            ctx.fillStyle = '#999999';
            ctx.font = '28px Arial';
            ctx.textAlign = 'center';
            ctx.fillText('本局无输赢', width / 2, currentY + 50);
            currentY += 100;
          } else if (winners.length === 0) {
            ctx.fillStyle = '#999999';
            ctx.font = '28px Arial';
            ctx.textAlign = 'center';
            ctx.fillText('本局无赢家', width / 2, currentY + 50);
            currentY += 100;
          } else if (losers.length === 0) {
            ctx.fillStyle = '#999999';
            ctx.font = '28px Arial';
            ctx.textAlign = 'center';
            ctx.fillText('本局无输家', width / 2, currentY + 50);
            currentY += 100;
          }

          // 导出图片
          wx.canvasToTempFilePath({
            canvas: canvas,
            success: (res) => {
              if (!res || !res.tempFilePath) {
                console.error('图片导出失败');
                reject(new Error('图片导出失败'));
                return;
              }
              resolve(res.tempFilePath);
            },
            fail: (err) => {
              console.error('图片导出失败:', err);
              reject(err);
            }
          });
        } catch (error) {
          console.error('生成战绩图片失败:', error);
          this.showTip('图片生成失败，请重试');
          reject(error);
        }
      });
    });
  },

  /**
   * 保存战绩到相册
   * 将Canvas绘制的战绩图片转换为临时文件并保存到相册
   * 优化：添加异常处理、防止重复点击、重新生成图片确保完整性（头像已预加载）
   */
  async saveResultToAlbum() {
  try {
    // 防止重复点击，添加保存中状态
    if (this.data.savingImage) {
      this.showTip('正在保存中，请稍候...');
      return;
    }
    
    this.setData({ savingImage: true });

    // 生成图片并获取临时文件路径
    const tempFilePath = await this.generateResultImage();
    
    if (!tempFilePath) {
      this.showTip('图片生成失败');
      this.setData({ savingImage: false });
      return;
    }

    // 申请相册权限（使用Promise包装）
    await new Promise((resolve, reject) => {
      wx.getSetting({
        success: (setting) => {
          if (!setting.authSetting['scope.writePhotosAlbum']) {
            wx.authorize({
              scope: 'scope.writePhotosAlbum',
              success: () => {
                resolve();
              },
              fail: () => {
                this.showTip('需要相册权限才能保存图片');
                this.setData({ savingImage: false });
                reject(new Error('用户拒绝授权'));
              }
            });
          } else {
            resolve();
          }
        },
        fail: () => {
          this.showTip('获取权限失败，请重试');
          this.setData({ savingImage: false });
          reject(new Error('获取权限失败'));
        }
      });
    });

    // 权限获取成功后保存图片
    this.saveToAlbum(tempFilePath);
  } catch (error) {
    console.error('保存战绩图片失败:', error);
    this.showTip('保存失败，请重试');
    this.setData({ savingImage: false });
  }
},

  /**
   * 保存图片到相册
   * @param {string} filePath - 图片文件路径
   */
  saveToAlbum(filePath) {
    wx.saveImageToPhotosAlbum({
      filePath: filePath,
      success: () => {
        this.showTip('保存成功');
        this.setData({ savingImage: false });
      },
      fail: () => {
        this.showTip('保存失败');
        this.setData({ savingImage: false });
      }
    });
  },

  /**
   * 自动上传战绩到服务器
   * 弹窗弹出后自动执行，支持重试机制
   * 注释：此功能暂时禁用，避免服务器地址占位符导致连接失败
   */
  autoUploadResult() {
    // 暂时禁用战绩上传功能
    return;
  },

  /**
   * 分享战绩
   * 注释：此功能暂时禁用，避免未实现的 wx.shareImageToFriend API 导致错误
   */
  shareResult() {
    wx.showToast({
      title: '分享功能暂未开放',
      icon: 'none'
    });

    /*
    const query = wx.createSelectorQuery();
    query.select('#resultCanvas')
      .fields({ node: true, size: true })
      .exec((res) => {
        if (res && res[0]) {
          const canvas = res[0].node;
          wx.canvasToTempFilePath({
            canvas: canvas,
            success: (res) => {
              // 检查分享权限
              wx.getSetting({
                success: (setting) => {
                  // 调用分享接口
                  wx.shareImageToFriend({
                    imageUrl: res.tempFilePath,
                    success: () => {
                      this.showTip('分享成功');
                    },
                    fail: (err) => {
                      if (err.errMsg.includes('cancel')) {
                        this.showTip('分享取消');
                      } else {
                        this.showTip('分享失败');
                        console.error('分享失败:', err);
                      }
                    }
                  });
                }
              });
            },
            fail: () => {
              this.showTip('图片生成失败，无法分享');
            }
          });
        } else {
          this.showTip('未找到战绩图片');
        }
      });
    */
  },

  /**
   * 关闭战绩弹窗
   */
  closeResultModal() {
    this.setData({ 
      showResultModal: false,
      savingImage: false // 重置保存状态
    });
  },

  /**
   * 显示房间二维码
   */
  showQrcode() {
    this.setData({ showQrcode: true });
  },

  /**
   * 隐藏二维码弹窗
   */
  hideQrcode() {
    this.setData({ showQrcode: false });
  },

  /**
   * 保存二维码到相册
   */
  saveQrcode() {
    const query = wx.createSelectorQuery();
    query.select('#qrcodeCanvas')
      .fields({ node: true, size: true })
      .exec((res) => {
        if (res && res[0]) {
          const canvas = res[0].node;
          wx.canvasToTempFilePath({
            canvas: canvas,
            success: (res) => {
              wx.saveImageToPhotosAlbum({
                filePath: res.tempFilePath,
                success: () => {
                  this.showTip('保存成功');
                },
                fail: () => {
                  this.showTip('保存失败');
                }
              });
            }
          });
        }
      });
  },

  /**
   * 分享二维码提示
   */
  shareQrcode() {
    wx.showToast({
      title: '请使用右上角分享',
      icon: 'none'
    });
  },

  /**
   * 显示提示消息
   * @param {string} text - 提示文字
   */
  showTip(text) {
    this.setData({ tipText: text, showTipModal: true });
    setTimeout(() => {
      this.setData({ showTipModal: false });
    }, 1500);
  },

  /**
   * 验证是否为正整数
   * @param {number} value - 待验证的值
   * @returns {boolean} 是否为正整数
   */
  validatePositiveInteger(value) {
    return Number.isInteger(value) && value > 0;
  },

  /**
   * 获取当前时间
   * @returns {string} 格式化的时间字符串 (YYYY-MM-DD HH:mm)
   */
  getCurrentTime() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hour = String(now.getHours()).padStart(2, '0');
    const minute = String(now.getMinutes()).padStart(2, '0');
    return `${year}-${month}-${day} ${hour}:${minute}`;
  },

  /**
   * 点击记录查看详情
   * @param {Object} e - 事件对象，包含记录数据
   */
  onRecordTap(e) {
    const record = e.currentTarget.dataset.record;
    // 可选：弹出详情弹窗，显示转账双方的积分变动前后值
    // 此处预留扩展点，后续可根据需要添加
    console.log('点击记录:', record);
  },





  /**
   * 执行退出房间逻辑
   */
  executeExitRoom() {
    const roomId = this.data.roomId;

    wx.cloud.callFunction({
      name: 'roomFunctions',
      data: {
        action: 'leave',
        payload: {
          roomId: roomId
        }
      },
      success: (cloudRes) => {
        if (cloudRes.result.success) {
          wx.reLaunch({
            url: '/pages/home/home'
          });
        } else {
          console.log("777"+cloudRes.result.msg);
          wx.showToast({
            title: cloudRes.result.msg || '退出失败',
            icon: 'none'
          });
        }
      },
      fail: (err) => {
        console.error('退出房间失败:', err);
        wx.showToast({
          title: '退出失败',
          icon: 'none'
        });
      }
    });
  },

  /**
   * 处理退出按钮点击事件
   * 调用 roomFunctions 的 leave 动作
   * 参数标准化：{ roomId }
   * 无需前端处理房主继承逻辑（由后台事务完成）
   */
  /**
   * ==================== 下注模式新增功能 ==================== */

  /**
   * 点击"跟注"按钮
   * 功能：跟上一个转入玩家的积分金额
   * 激活条件：有上一个转入记录
   */
  handleFollow() {
    // 检查是否可以跟注
    console.log("111")
    if (!this.data.canFollow || this.data.lastDepositAmount <= 0) {
      this.showTip('暂无玩家转入积分，无法跟注');
      return;
    }

    // 游戏已结束，不允许操作
    if (this.data.room.status !== 'playing') {
      // this.showTip('游戏已结束，无法操作');
      return;
    }

    const amount = this.data.lastDepositAmount;

    // 调用云函数执行下注
    wx.cloud.callFunction({
      name: 'gameLogic',
      data: {
        action: 'BET',
        payload: {
          roomId: this.data.roomId,
          amount: amount,
          nickname: this.data.currentUser
        }
      },
      success: (res) => {
        if (res.result.success) {
          // 找到当前玩家位置（用于动画）
          const room = this.data.room;
          const playerIndex = room.members.findIndex(m => m.name === this.data.currentUser);
          if (playerIndex !== -1) {
            this.triggerDepositAnimation(playerIndex, amount);
          }

          // 更新跟注状态
          this.setData({
            lastDepositAmount: amount,
            lastDepositOperator: this.data.currentUser,
            canFollow: true
          });
          // 消息由 watch 监听器自动同步
        } else {
          wx.showToast({
            title: res.result.msg || '跟注失败',
            icon: 'none'
          });
        }
      },
      fail: (err) => {
        console.error('跟注失败:', err);
        wx.showToast({
          title: '跟注失败，请重试',
          icon: 'none'
        });
      }
    });
  },

  /**
   * 点击"过"按钮
   * 功能：跳过当前回合，生成系统消息
   */
  handlePass() {
    if (this.data.room.status !== 'playing') {
      return;
    }

    const currentUser = this.data.currentUser;

    // 调用云函数执行"过"
    wx.cloud.callFunction({
      name: 'gameLogic',
      data: {
        action: 'PASS',
        payload: {
          roomId: this.data.roomId,
          nickname: currentUser
        }
      },
      success: (res) => {
        if (res.result.success) {
          // 消息由 watch 监听器自动同步
        } else {
          wx.showToast({
            title: res.result.msg || '操作失败',
            icon: 'none'
          });
        }
      },
      fail: (err) => {
        console.error('跳过失败:', err);
        wx.showToast({
          title: '操作失败，请重试',
          icon: 'none'
        });
      }
    });
  },

  /**
   * 本地添加消息（已废弃）
   * 注意：此方法已废弃，消息由 watch 监听器自动同步
   * @param {string} type - 消息类型
   * @param {Object} params - 消息参数
   */
  addLocalMessage(type, params) {
    // 不再本地添加消息，等待 watch 监听器自动同步
  },

  /**
   * 本地添加转账/下注消息（已废弃）
   * 注意：此方法已废弃，消息由 watch 监听器自动同步
   * @param {string} type - 消息类型
   * @param {Object} params - 消息参数
   */
  addLocalTransferMessage(type, params) {
    // 不再本地添加消息，等待 watch 监听器自动同步
  },

  /**
   * 点击"all in"按钮
   * 功能：根据设置的all in值转入积分到奖池
   */
  handleAllIn() {
    // 检查是否设置了all in值
    if (!this.data.room.allInValue || this.data.room.allInValue <= 0) {
      this.showAllInTip();
      return;
    }

    // 游戏已结束，不允许操作
    if (this.data.room.status !== 'playing') {
      // this.showTip('游戏已结束，无法操作');
      return;
    }

    const amount = this.data.room.allInValue;

    // 调用云函数执行 all in
    wx.cloud.callFunction({
      name: 'gameLogic',
      data: {
        action: 'ALLIN',
        payload: {
          roomId: this.data.roomId,
          amount: amount,
          nickname: this.data.currentUser
        }
      },
      success: (res) => {
        if (res.result.success) {
          // 找到当前玩家位置（用于动画）
          const room = this.data.room;
          const playerIndex = room.members.findIndex(m => m.name === this.data.currentUser);
          if (playerIndex !== -1) {
            this.triggerDepositAnimation(playerIndex, amount);
          }

          // 更新跟注状态
          this.setData({
            lastDepositAmount: amount,
            lastDepositOperator: this.data.currentUser,
            canFollow: true
          });
          // 消息由 watch 监听器自动同步
        } else {
          wx.showToast({
            title: res.result.msg || 'All-in失败',
            icon: 'none'
          });
        }
      },
      fail: (err) => {
        console.error('All-in失败:', err);
        wx.showToast({
          title: 'All-in失败，请重试',
          icon: 'none'
        });
      }
    });
  },

  /**
   * all in值输入
   */
  onAllInInput(e) {
    const value = e.detail.value;
    this.setData({ allInInput: value });
  },

  /**
   * 显示all in未设置提示
   */
  showAllInTip() {
    this.setData({ showAllInTip: true });
    setTimeout(() => {
      this.setData({ showAllInTip: false });
    }, 2000);
  },
  
  /**
   * ==================== 退出房间功能 ==================== */
  /**
   * 打开退出确认弹窗
   */
  openExitConfirm() {
    this.setData({ showExitConfirm: true });
  },

  /**
   * 关闭退出确认弹窗
   */
  closeExitConfirm() {
    this.setData({ showExitConfirm: false });
  },

  /**
   * 确认退出房间
   * 调用 roomFunctions 的 leave 动作
   * 参数标准化：{ roomId }
   */
  confirmExit() {
    const roomId = this.data.roomId;

    // 关闭退出确认弹窗
    this.closeExitConfirm();

    // 参数标准化：云函数期望 { roomId }
    wx.cloud.callFunction({
      name: 'roomFunctions',
      data: {
        action: 'leave',
        payload: {
          roomId: roomId  // ✅ 标准化参数：roomId
        }
      },
      success: (cloudRes) => {
        if (cloudRes.result.success) {
          // 返回首页
          wx.navigateBack({
            delta: 1
          });
        } else {
          console.log("888"+cloudRes.result.msg);
          
          wx.showToast({
            title: cloudRes.result.msg || '退出失败',
            icon: 'none'
          });

          // 返回首页（即使退出失败也返回，避免卡在房间页面）
          setTimeout(() => {
            wx.navigateBack({
              delta: 1
            });
          }, 1500);
        }
      },
      fail: (err) => {
        console.error('退出房间失败:', err);
        wx.showToast({
          title: '退出失败',
          icon: 'none'
        });

        // 返回首页（即使退出失败也返回，避免卡在房间页面）
        setTimeout(() => {
          wx.navigateBack({
            delta: 1
          });
        }, 1500);
      }
    });
  },

  /**
   * ==================== 设置功能 ==================== */

  /**
   * 打开设置弹窗
   */
  openSettingsModal() {
    this.setData({
      showSettingsModal: true,
      allInInput: this.data.room.allInValue ? this.data.room.allInValue.toString() : ''
    });
  },

  /**
   * 关闭设置弹窗
   */
  closeSettingsModal() {
    this.setData({ showSettingsModal: false });
  },

  /**
   * 保存设置
   */
  saveSettings() {
    const room = this.data.room;
    
    // 如果是下注模式，保存all in值
    if (room.gameMode === 'bet') {
      const value = parseInt(this.data.allInInput);
      if (this.data.allInInput && value > 0) {
        if (!this.validatePositiveInteger(value)) {
          this.showTip('请输入正整数');
          return;
        }
        room.allInValue = value;
      }
    }

    // 保存数据
    this.setData({ 
      room,
      'room.prizePool.total': room.prizePool.total  // 显式更新奖池路径
    });
    this.saveRoomData();
    this.closeSettingsModal();
    this.showTip('设置已保存');
  },

  /**
   * 页面分享配置
   * @returns {Object} 分享信息对象
   */
  onShareAppMessage() {
    return {
      title: `邀请你加入打牌记账房间：${this.data.room.roomName}`,
      path: `/pages/room/room?roomId=${this.data.roomId}`,
      imageUrl: '/images/default-goods-image.png'
    };
  },

  // ==================== 动画系统 ====================

  /**
   * 触发转入奖池飘动动画
   * @param {number} playerIndex - 玩家索引
   * @param {number} amount - 转入金额
   */
  triggerDepositAnimation(playerIndex, amount) {

    const systemInfo = wx.getSystemInfoSync();
    const screenWidth = systemInfo.windowWidth;

    // 根据玩家索引计算固定的起始位置（更可靠）
    // 玩家列表在左侧（25%宽度），每个玩家卡片高度约120px
    const sectionWidth = screenWidth * 0.25;
    const startX = sectionWidth / 2 + 20; // 左侧区域中心偏右
    const startY = 100 + playerIndex * 140; // 根据索引垂直排列

    // 直接使用计算的位置触发动画
    this.createFloatAnimation(startX, startY, amount);
  },

  /**
   * 创建飘动动画（转入奖池）
   * @param {number} startX - 起始X坐标
   * @param {number} startY - 起始Y坐标
   * @param {number} amount - 金额
   */
  createFloatAnimation(startX, startY, amount) {

    // 设置动画数据（纯 CSS 动画，不使用 wx.createAnimation）
    this.setData({
      showFloatAnimation: true,
      floatAmount: amount,
      floatLeft: startX,
      floatTop: startY
    });

    // 动画结束后清理
    setTimeout(() => {
      this.setData({
        showFloatAnimation: false
      });
    }, 900);
  },

  /**
   * 触发收取奖池动画（彩带+金币）
   * @param {number} amount - 收取的金额
   */
  triggerReceiveAnimation(amount) {
    const systemInfo = wx.getSystemInfoSync();
    const screenWidth = systemInfo.windowWidth;
    const screenHeight = systemInfo.windowHeight;

    // 优化：减少动画元素数量，降低卡顿
    const isLowPerformance = screenWidth < 375;
    const confettiCount = isLowPerformance ? 2 : 4; // 从 3-6 减少到 2-4
    const coinCount = isLowPerformance ? 5 : 8; // 从 8-12 减少到 5-8

    // 生成彩带列表
    const confettiList = [];
    const colors = ['#FF7A2F', '#FFD700', '#4CD964', '#FF3B30']; // 减少颜色种类
    for (let i = 0; i < confettiCount; i++) {
      const duration = 1200 + Math.random() * 600; // 缩短动画时间
      const delay = Math.random() * 150; // 减少延迟
      const startY = -30 - Math.random() * 50; // 减少起始高度

      confettiList.push({
        id: i,
        left: Math.random() * (screenWidth - 40),
        top: startY,
        color: colors[Math.floor(Math.random() * colors.length)],
        width: 12 + Math.random() * 8, // 减小尺寸
        height: 4 + Math.random() * 4,
        duration: duration,
        delay: delay
      });
    }

    // 生成金币列表
    const coinList = [];
    for (let i = 0; i < coinCount; i++) {
      const duration = 1000 + Math.random() * 500; // 缩短动画时间
      const delay = Math.random() * 200; // 减少延迟
      const startY = -40 - Math.random() * 50; // 减少起始高度

      coinList.push({
        id: i,
        left: Math.random() * (screenWidth - 40),
        top: startY,
        size: 12 + Math.random() * 4, // 减小尺寸
        duration: duration,
        delay: delay
      });
    }

    // 设置动画数据
    this.setData({
      showReceiveAnimation: true,
      confettiList,
      coinList,
      receiveAmount: amount // 保存显示金额
    });


    // 动画结束后清理（缩短清理时间）
    setTimeout(() => {
      this.setData({
        showReceiveAnimation: false,
        confettiList: [],
        coinList: [],
        receiveAmount: 0
      });
    }, 2200); // 从 3000ms 缩短到 2200ms
  }
});
