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
    showWelcome: false, // 是否显示欢迎消息
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
    uploadFailed: false // 上传是否失败
  },

  /**
   * 生命周期函数 - 页面加载
   * @param {Object} options - 页面参数，包含roomId
   */
  onLoad(options) {
    const { roomId } = options;
    this.setData({ roomId });

    // 获取当前用户昵称和头像
    const userInfo = wx.getStorageSync('userInfo') || {};
    this.setData({ currentUser: userInfo.nickName || '' });

    this.loadRoom(roomId);
  },

  /**
   * 生命周期函数 - 页面显示
   * 每次显示页面时重新加载房间数据
   * 并检查是否有未上传的战绩，尝试重新上传
   */
  onShow() {
    if (this.data.roomId) {
      this.loadRoom(this.data.roomId);
    }

    // 检查是否有未上传的战绩，尝试重新上传
    this.retryFailedUploads();

    // TODO: 临时测试动画（正式使用请注释掉此行）
    // setTimeout(() => this.createFloatAnimation(100, 100, 100), 1000);
  },

  /**
   * 重试失败的上传
   * 从本地存储中获取未上传的战绩，尝试重新上传
   */
  retryFailedUploads() {
    const failedUploads = wx.getStorageSync('failedUploads') || [];
    if (failedUploads.length === 0) {
      return;
    }

    // TODO: 配置实际的服务器接口地址
    const serverUrl = 'https://your-server.com/api/settlement';
    const successfulUploads = [];

    failedUploads.forEach((upload, index) => {
      wx.request({
        url: serverUrl,
        method: 'POST',
        data: upload.data,
        header: {
          'content-type': 'application/json'
        },
        success: (res) => {
          if (res.statusCode === 200) {
            successfulUploads.push(index);
            
            // 如果所有失败的上传都成功了，清空本地存储
            if (successfulUploads.length === failedUploads.length) {
              wx.removeStorageSync('failedUploads');
              this.showTip('历史战绩上传成功');
            }
          }
        },
        fail: () => {
          // 仍然失败，保留在本地，下次再试
          console.error('重试上传失败:', upload);
        }
      });
    });
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
   * 添加欢迎消息
   * 在聊天记录中添加系统欢迎消息
   */
  addWelcomeMessage() {
    const room = this.data.room;
    const description = `欢迎进入【${room.roomName}】`;
    const record = {
      description: description,
      processedDescription: description,
      time: this.getCurrentTime(),
      detail: {
        type: 'welcome'
      },
      hasMe: false,
      isSystem: true,
      isReceive: false,
      segments: [{ text: description, isMe: false }]
    };
    
    room.records.unshift(record);
    this.setData({ room });
    this.saveRoomData();
    
    // 滚动到底部显示欢迎消息
    this.scrollToBottom();
  },

  /**
   * 加载房间数据
   * 从本地存储加载房间信息并初始化显示
   * @param {string} roomId - 房间ID
   */
  loadRoom(roomId) {
    const rooms = wx.getStorageSync('rooms') || [];
    const room = rooms.find(r => r._id === roomId);
    if (room) {
      // 设置导航栏标题
      if (room.roomName) {
        wx.setNavigationBarTitle({
          title: room.roomName
        });
      }

      // 初始化members数据结构（向后兼容）
      if (room.members && room.members.length > 0 && typeof room.members[0] === 'string') {
        room.members = room.members.map(name => ({ name, avatarUrl: '', score: 0 }));
      }

      // 为没有avatarUrl的成员添加默认头像，并检测是否需要滚动
      if (room.members) {
        room.members = room.members.map(member => {
          // 检测积分是否需要滚动（超过7位数字，包括符号）
          const scoreText = member.score > 0 ? `+${member.score}` : `${member.score}`;
          const scoreScroll = scoreText.length > 7;
          
          return {
            ...member,
            avatarUrl: member.avatarUrl || '',
            scoreScroll
          };
        });
      }

      // 初始化records数据结构
      if (!room.records) {
        room.records = [];
        // 首次进入时添加欢迎消息
        this.addWelcomeMessage();
      }

      // 处理操作记录，将当前用户的信息替换为"我"并生成分段数据
      // 同时添加isMe、isSystem、isReceive字段用于聊天室样式
      if (room.records && room.records.length > 0) {
        // 移除已存在的欢迎消息（避免重复）
        room.records = room.records.filter(r => r.detail && r.detail.type !== 'welcome');

        const currentUser = this.data.currentUser;
        room.records = room.records.map(record => {
          const processedDescription = currentUser ? record.description.replace(currentUser, '我') : record.description;
          const hasMe = processedDescription.includes('我');

          // 判断是否为系统消息（结算等）
          const isSystem = record.detail && (record.detail.type === 'settle' || record.detail.type === 'welcome');

          // 判断是否为收取奖池
          const isReceive = record.detail && (record.detail.type === 'receive' || record.description.includes('收取了奖池'));

          // 将描述分割成片段，用于单独高亮"我"字和金额
          let segments = [];
          if (hasMe) {
            const parts = processedDescription.split('我');
            for (let i = 0; i < parts.length; i++) {
              if (parts[i]) {
                // 提取金额数字进行高亮
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
            // 处理不包含"我"的情况，但要高亮金额
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

          return {
            ...record,
            processedDescription: processedDescription,
            hasMe: hasMe,
            isSystem: isSystem,
            isReceive: isReceive,
            segments: segments
          };
        });
      }

      // 初始化prizePool
      if (room.gameMode === 'bet' && !room.prizePool) {
        room.prizePool = { total: 0, receiver: '', receivedTime: '' };
      }

      // 初始化allInValue（下注模式）
      if (room.gameMode === 'bet' && room.allInValue === undefined) {
        room.allInValue = 0;
      }

      // 初始化status
      if (!room.status) {
        room.status = 'playing';
      }

      // 下注模式：找到最后一个转入记录，判断是否可以跟注
      let lastDepositAmount = 0;
      let lastDepositOperator = '';
      let canFollow = false;
      
      if (room.gameMode === 'bet') {
        const depositRecords = room.records.filter(r => r.detail && (r.detail.type === 'deposit' || r.detail.type === 'follow' || r.detail.type === 'allin'));
        if (depositRecords.length > 0) {
          const lastRecord = depositRecords[0];
          lastDepositAmount = lastRecord.detail.amount;
          lastDepositOperator = lastRecord.detail.operator;
          canFollow = true;
        }
      }

      // 判断是否为房主
      const isCreator = room.creator === this.data.currentUser;

      this.setData({ 
        room, 
        showWelcome: true,
        lastDepositAmount,
        lastDepositOperator,
        canFollow,
        isCreator
      });

      // 如果有历史记录且不是首次加载，滚动到底部
      if (room.records && room.records.length > 1) {
        setTimeout(() => {
          this.scrollToBottom();
        }, 300);
      }
    } else {
      wx.showToast({
        title: '房间不存在',
        icon: 'none'
      });
      setTimeout(() => {
        wx.navigateBack();
      }, 1500);
    }
  },

  /**
   * 保存房间数据
   * 将当前房间数据保存到本地存储
   */
  saveRoomData() {
    const rooms = wx.getStorageSync('rooms') || [];
    const roomIndex = rooms.findIndex(r => r._id === this.data.roomId);
    if (roomIndex !== -1) {
      rooms[roomIndex] = this.data.room;
      wx.setStorageSync('rooms', rooms);
    }
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
   *   2. 找到转出方（当前用户）和接收方（被点击玩家）
   *   3. 转出方积分 -= 金额，接收方积分 += 金额
   *   4. 生成转账记录
   *   5. 更新房间数据并保存
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

    // 找到转出方和接收方
    const senderIndex = room.members.findIndex(m => m.name === currentUser);
    if (senderIndex === -1) {
      // this.showTip('找不到当前用户');
      return;
    }

    // 执行转账
    const sender = room.members[senderIndex];
    const receiver = room.members[targetIndex];

    sender.score -= amount;
    receiver.score += amount;

    // 更新滚动标志
    this.updateMemberScrollFlags(sender);
    this.updateMemberScrollFlags(receiver);

    // 获取双方头像
    const senderAvatar = sender.avatarUrl || '';
    const receiverAvatar = receiver.avatarUrl || '';

    // 生成转账记录
    const record = this.createTransferRecord({
      sender: currentUser,
      receiver,
      amount,
      senderAvatar,
      receiverAvatar,
      senderScoreAfter: sender.score,
      receiverScoreAfter: receiver.score
    });
    room.records.unshift(record);

    // 保存数据
    this.setData({ 
      room,
      'room.prizePool.total': room.prizePool.total  // 显式更新奖池路径
    });
    this.saveRoomData();

    // 关闭弹窗并提示
    this.closeTransferModal();
    // this.showTip('转账成功');

    // 滚动到底部显示新消息
    this.scrollToBottom();
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

    const room = this.data.room;
    const currentUser = this.data.currentUser;

    // 找到操作玩家
    const playerIndex = room.members.findIndex(m => m.name === currentUser);
    if (playerIndex === -1) {
      this.showTip('找不到当前用户');
      return;
    }

    // 获取玩家头像
    const playerAvatar = room.members[playerIndex].avatarUrl || '';

    // 执行转入
    const result = this.processDeposit({
      amount,
      playerAvatar,
      recordType: 'deposit',
      recordTypeText: '下注'
    });

    if (!result.success) {
      return;
    }

    // 关闭弹窗
    this.closePrizeModal();

    // 触发转入奖池飘动动画
    this.triggerDepositAnimation(result.playerIndex, result.amount);

    // 滚动到底部显示新消息
    this.scrollToBottom();
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
   * 处理奖池转入
   * @param {Object} params - 参数对象
   */
  processDeposit(params) {
    const { amount, playerAvatar, recordType, recordTypeText } = params;
    const room = this.data.room;
    const currentUser = this.data.currentUser;

    const playerIndex = room.members.findIndex(m => m.name === currentUser);
    if (playerIndex === -1) {
      this.showTip('找不到当前用户');
      return false;
    }

    const player = room.members[playerIndex];
    player.score -= amount;

    if (room.prizePool.receiver) {
      room.prizePool.receiver = '';
      room.prizePool.receivedTime = '';
    }
    room.prizePool.total += amount;

    this.updateMemberScrollFlags(player);

    this.setData({ animateAmount: true });
    setTimeout(() => this.setData({ animateAmount: false }), 400);

    const record = this.createDepositRecord({
      operator: currentUser,
      amount,
      playerAvatar,
      playerScoreAfter: player.score,
      prizePoolAfter: room.prizePool.total,
      recordType,
      recordTypeText
    });
    room.records.unshift(record);

    this.setData({
      room,
      'room.prizePool.total': room.prizePool.total
    });
    this.saveRoomData();

    return { success: true, playerIndex, amount };
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
    const currentUser = this.data.currentUser;
    const prizeAmount = room.prizePool.total;

    // 找到操作玩家
    const playerIndex = room.members.findIndex(m => m.name === currentUser);
    if (playerIndex === -1) {
      this.showTip('找不到当前用户');
      return;
    }

    // 执行收取
    const player = room.members[playerIndex];
    player.score += prizeAmount;

    this.updateMemberScrollFlags(player);

    // 保存奖池金额用于动画显示（在清零之前）
    const displayAmount = prizeAmount;

    // 重置奖池并记录收取信息
    room.prizePool.total = 0;
    room.prizePool.receiver = currentUser;
    room.prizePool.receivedTime = this.getCurrentTime();

    // 生成收取记录
    const description = `${currentUser} 收取了奖池 ${prizeAmount} 分`;
    const { processedDescription, hasMe, segments } = this.generateSegments(description, currentUser);

    const playerAvatar = player.avatarUrl || '';

    const record = {
      description,
      processedDescription,
      time: this.getCurrentTime(),
      detail: {
        type: 'receive',
        operator: currentUser,
        operatorAvatar: playerAvatar,
        avatarUrl: playerAvatar,
        amount: prizeAmount,
        playerScoreAfter: player.score,
        prizePoolAfter: 0
      },
      hasMe,
      isSystem: false,
      isReceive: true,
      segments
    };
    room.records.unshift(record);

    // 保存数据
    this.setData({
      room,
      'room.prizePool.total': room.prizePool.total
    });
    this.saveRoomData();

    // 关闭弹窗
    this.closeReceiveModal();

    // 触发收取奖池动画（彩带+金币），传入保存的金额
    this.triggerReceiveAnimation(displayAmount);

    // 滚动到底部显示新消息
    this.scrollToBottom();
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

    // 找到当前用户索引
    const senderIndex = room.members.findIndex(m => m.name === currentUser);
    if (senderIndex === -1) {
      // this.showTip('找不到当前用户');
      return;
    }

    const sender = room.members[senderIndex];
    let totalAmount = 0;
    const transfers = [];

    // 验证所有输入并准备转账数据
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

        transfers.push({ memberName, amount, receiver: receiver.name });
        totalAmount += amount;
      }
    }

    // 执行批量转账
    for (const transfer of transfers) {
      const receiver = room.members.find(m => m.name === transfer.memberName);
      sender.score -= transfer.amount;
      receiver.score += transfer.amount;
    }

    // 更新滚动标志
    this.updateMemberScrollFlags(sender);
    for (const transfer of transfers) {
      const receiver = room.members.find(m => m.name === transfer.memberName);
      this.updateMemberScrollFlags(receiver);

      // 生成转账记录
      const senderAvatar = sender.avatarUrl || '';
      const receiverAvatar = receiver.avatarUrl || '';

      const record = this.createTransferRecord({
        sender: currentUser,
        receiver,
        amount: transfer.amount,
        senderAvatar,
        receiverAvatar,
        senderScoreAfter: sender.score,
        receiverScoreAfter: receiver.score
      });
      room.records.unshift(record);
    }

    // 保存数据
    this.setData({ 
      room,
      'room.prizePool.total': room.prizePool.total  // 显式更新奖池路径
    });
    this.saveRoomData();

    // 关闭弹窗并提示
    this.closeExpenseModal();
    // this.showTip(`支出成功，共转出 ${totalAmount} 积分`);

    // 滚动到底部显示新消息
    this.scrollToBottom();
  },

  /**
   * 处理结算按钮点击事件
   * 根据用户权限执行不同操作：
   * - 房主：弹出确认弹窗
   * - 非房主：显示提示消息
   * - 游戏已结束：显示无需结算提示
   */
  handleSettleBtn() {
    const room = this.data.room;

    // 游戏已结束
    if (room.status !== 'playing') {
      this.showTip('本局游戏已结束，无需结算');
      return;
    }

    // 非房主点击
    if (room.creator !== this.data.currentUser) {
      this.showTip('只有房主可以结算本局游戏');
      return;
    }

    // 房主点击：弹出确认弹窗
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
   * 房主确认后执行结算流程：
   * 1. 计算玩家输赢结果
   * 2. 生成战绩数据（按Excel柱状图排序）
   * 3. 自动上传战绩到服务器
   * 4. 绘制战绩图片
   * 5. 更新房间状态为"已结束"
   * 6. 显示战绩弹窗
   */
  confirmSettle() {
    const room = this.data.room;
    const currentUser = this.data.currentUser;

    // 分离赢家和输家
    const winners = [];
    const losers = [];

    room.members.forEach(player => {
      if (player.score > 0) {
        winners.push({
          playerName: player.name,
          avatarUrl: player.avatarUrl || '',
          score: player.score,
          displayScore: `+${player.score}`,
          isCurrentUser: player.name === currentUser
        });
      } else if (player.score < 0) {
        losers.push({
          playerName: player.name,
          avatarUrl: player.avatarUrl || '',
          score: player.score,
          displayScore: `${player.score}`,
          isCurrentUser: player.name === currentUser
        });
      }
    });

    // 计算柱状图长度
    // 赢家板块：基准值为最大正积分
    let winMax = 0;
    if (winners.length > 0) {
      winMax = Math.max(...winners.map(w => w.score));
    }

    // 输家板块：基准值为最大负积分的绝对值
    let loseMax = 0;
    if (losers.length > 0) {
      loseMax = Math.max(...losers.map(l => Math.abs(l.score)));
    }

    // 计算每个玩家的柱状条长度（基准值对应80px）
    winners.forEach(winner => {
      let barHeight = (winner.score / winMax) * 80;
      // 最小长度3px，保留1位小数
      barHeight = Math.max(3, parseFloat(barHeight.toFixed(1)));
      winner.barHeight = barHeight;
    });

    losers.forEach(loser => {
      let barHeight = (Math.abs(loser.score) / loseMax) * 80;
      // 最小长度3px，保留1位小数
      barHeight = Math.max(3, parseFloat(barHeight.toFixed(1)));
      loser.barHeight = barHeight;
    });

    // 排序
    // 赢家：积分从高到低，同分本人优先
    winners.sort((a, b) => {
      if (a.score !== b.score) {
        return b.score - a.score;
      }
      if (a.isCurrentUser && !b.isCurrentUser) return -1;
      if (!a.isCurrentUser && b.isCurrentUser) return 1;
      return 0;
    });

    // 输家：按绝对值从高到低，同绝对值本人优先
    losers.sort((a, b) => {
      const absA = Math.abs(a.score);
      const absB = Math.abs(b.score);
      if (absA !== absB) {
        return absB - absA;
      }
      if (a.isCurrentUser && !b.isCurrentUser) return -1;
      if (!a.isCurrentUser && b.isCurrentUser) return 1;
      return 0;
    });

    // 准备战绩数据
    const resultData = {
      roomId: room._id,
      roomMode: room.gameMode === 'normal' ? '普通模式' : '下注模式',
      roomName: room.roomName,
      settlementTime: this.getCurrentTime(),
      creator: room.creator,
      winners: winners,
      losers: losers,
      playerList: [...winners, ...losers], // 保留原有playerList用于兼容
      isUploaded: false
    };

    // 下注模式：添加奖池信息
    if (room.gameMode === 'bet') {
      resultData.prizePoolInfo = {
        totalPrizePool: room.prizePool.receiver ? this.calculateTotalPrizePool(room.records) : room.prizePool.total,
        receiver: room.prizePool.receiver,
        receiveTime: room.prizePool.receivedTime
      };
    }

    this.setData({ resultData, showSettleConfirm: false });
    this.closeSettleConfirm();

    // 显示战绩弹窗
    setTimeout(() => {
      this.setData({ showResultModal: true });
      // 绘制战绩图片
      this.generateResultImage();
      // 自动上传战绩到服务器
      this.autoUploadResult();
    }, 300);

    // 更新房间状态为已结束
    room.status = 'ended';
    this.setData({ room });
    this.saveRoomData();

    // 生成结算记录
    const description = `房主已结算本局，积分已重置`;
    const record = {
      description: description,
      processedDescription: description,
      time: this.getCurrentTime(),
      detail: {
        type: 'settle'
      },
      hasMe: false,
      isSystem: true,
      isReceive: false,
      segments: [{ text: description, isMe: false }]
    };
    room.records.unshift(record);
    this.saveRoomData();

    // 滚动到底部显示新消息
    this.scrollToBottom();
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
   * 生成战绩图片
   * 使用Canvas 2D API绘制Excel柱状图风格的战绩卡片
   */
  generateResultImage() {
    const query = wx.createSelectorQuery();
    query.select('#resultCanvas')
      .fields({ node: true, size: true })
      .exec((res) => {
        if (res && res[0]) {
          const canvas = res[0].node;
          const ctx = canvas.getContext('2d');

          const systemInfo = wx.getSystemInfoSync();
          const dpr = systemInfo.pixelRatio;
          const width = res[0].width;
          const height = res[0].height;

          canvas.width = width * dpr;
          canvas.height = height * dpr;
          ctx.scale(dpr, dpr);

          // 清空画布
          ctx.clearRect(0, 0, width, height);

          // 绘制白色背景
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, width, height);

          // 绘制顶部装饰条（橙色渐变）
          const gradient = ctx.createLinearGradient(0, 0, 0, 140);
          gradient.addColorStop(0, '#FF7A2F');
          gradient.addColorStop(1, '#FF9E58');
          ctx.fillStyle = gradient;
          ctx.fillRect(0, 0, width, 140);

          // 绘制房间名（居中）
          ctx.fillStyle = '#ffffff';
          ctx.font = 'bold 40px Arial';
          ctx.textAlign = 'center';
          ctx.fillText(this.data.resultData.roomName, width / 2, 70);

          // 绘制结算时间（居中显示在房间名下方）
          ctx.font = '22px Arial';
          ctx.fillText(this.data.resultData.settlementTime, width / 2, 105);

          let currentY = 160;
          const resultData = this.data.resultData;
          const winners = resultData.winners || [];
          const losers = resultData.losers || [];

          // 绘制赢家板块
          if (winners.length > 0) {
            // 板块标题
            ctx.fillStyle = '#333333';
            ctx.font = 'bold 36px Arial';
            ctx.textAlign = 'center';

            // 绘制绿色图标
            ctx.fillStyle = '#4CD964';
            ctx.beginPath();
            ctx.arc(width / 2 - 60, currentY - 10, 16, 0, 2 * Math.PI);
            ctx.fill();

            // 绘制标题文字
            ctx.fillStyle = '#333333';
            ctx.fillText('赢家（正积分）', width / 2, currentY);

            currentY += 60;

            // 绘制横向柱状图
            const avatarRadius = 40;
            const barHeight = 20;
            const scoreMargin = 10;

            winners.forEach((winner, index) => {
              const startY = currentY + index * 80;
              const barWidth = winner.barHeight || 3;

              // 绘制头像占位（圆形）
              ctx.fillStyle = '#e0e0e0';
              ctx.beginPath();
              ctx.arc(40, startY + avatarRadius, avatarRadius, 0, 2 * Math.PI);
              ctx.fill();

              // 绘制用户名（右对齐）
              ctx.fillStyle = '#333333';
              ctx.font = '24px Arial';
              ctx.textAlign = 'right';  // 右对齐

              // 截断过长用户名（6个字）
              let displayName = winner.playerName;
              if (displayName.length > 6) {
                displayName = displayName.substring(0, 6) + '...';
              }
              // 右对齐绘制：用户名区域结束位置x=120+100=220
              ctx.fillText(displayName, 220, startY + avatarRadius + 8);

              // 绘制横向柱状条（统一起始位置：头像80px + 名字100px = 180px，加间距20px = 200px）
              const barStartX = 200;
              ctx.fillStyle = '#4CD964';
              ctx.fillRect(barStartX, startY + avatarRadius - barHeight / 2, barWidth, barHeight);

              // 绘制积分值
              ctx.fillStyle = '#4CD964';
              ctx.font = 'bold 28px Arial';
              ctx.textAlign = 'left';
              ctx.fillText(winner.displayScore, barStartX + barWidth + scoreMargin, startY + avatarRadius + 8);
            });

            currentY += winners.length * 80 + 60;
          }

          // 板块间间距
          if (winners.length > 0 && losers.length > 0) {
            currentY += 40;
          }

          // 绘制输家板块
          if (losers.length > 0) {
            // 板块标题
            ctx.fillStyle = '#333333';
            ctx.font = 'bold 36px Arial';
            ctx.textAlign = 'center';

            // 绘制红色图标
            ctx.fillStyle = '#FF3B30';
            ctx.beginPath();
            ctx.arc(width / 2 - 60, currentY - 10, 16, 0, 2 * Math.PI);
            ctx.fill();

            // 绘制标题文字
            ctx.fillStyle = '#333333';
            ctx.fillText('输家（负积分）', width / 2, currentY);

            currentY += 60;

            // 绘制横向柱状图
            const avatarRadius = 40;
            const barHeight = 20;
            const scoreMargin = 10;

            losers.forEach((loser, index) => {
              const startY = currentY + index * 80;
              const barWidth = loser.barHeight || 3;

              // 绘制头像占位（圆形）
              ctx.fillStyle = '#e0e0e0';
              ctx.beginPath();
              ctx.arc(40, startY + avatarRadius, avatarRadius, 0, 2 * Math.PI);
              ctx.fill();

              // 绘制用户名（右对齐）
              ctx.fillStyle = '#333333';
              ctx.font = '24px Arial';
              ctx.textAlign = 'right';  // 右对齐

              // 截断过长用户名（6个字）
              let displayName = loser.playerName;
              if (displayName.length > 6) {
                displayName = loser.playerName.substring(0, 6) + '...';
              }
              // 右对齐绘制：用户名区域结束位置x=120+100=220
              ctx.fillText(displayName, 220, startY + avatarRadius + 8);

              // 绘制横向柱状条（统一起始位置：头像80px + 名字100px = 180px，加间距20px = 200px）
              const barStartX = 200;
              ctx.fillStyle = '#FF3B30';
              ctx.fillRect(barStartX, startY + avatarRadius - barHeight / 2, barWidth, barHeight);

              // 绘制积分值
              ctx.fillStyle = '#FF3B30';
              ctx.font = 'bold 28px Arial';
              ctx.textAlign = 'left';
              ctx.fillText(loser.displayScore, barStartX + barWidth + scoreMargin, startY + avatarRadius + 8);
            });

            currentY += losers.length * 80 + 60;
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

          // 绘制底部信息区
          currentY += 40;

          // 绘制分隔线
          ctx.strokeStyle = '#f5f5f5';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(30, currentY);
          ctx.lineTo(width - 30, currentY);
          ctx.stroke();

          // 绘制房间模式
          ctx.fillStyle = '#666666';
          ctx.font = '24px Arial';
          ctx.textAlign = 'left';
          ctx.fillText('房间模式', 50, currentY + 50);

          const modeText = resultData.roomMode;
          ctx.fillStyle = resultData.roomMode === '下注模式' ? '#FF7A2F' : '#4CD964';
          ctx.font = 'bold 26px Arial';
          ctx.textAlign = 'right';
          ctx.fillText(modeText, width - 50, currentY + 50);

          // 下注模式：绘制奖池信息
          if (resultData.roomMode === '下注模式' && resultData.prizePoolInfo) {
            const prizeInfo = resultData.prizePoolInfo;

            ctx.fillStyle = '#666666';
            ctx.font = '24px Arial';
            ctx.textAlign = 'left';
            ctx.fillText('奖池总额', 50, currentY + 100);

            ctx.fillStyle = '#FF7A2F';
            ctx.font = 'bold 28px Arial';
            ctx.textAlign = 'right';
            ctx.fillText(`${prizeInfo.totalPrizePool} 积分`, width - 50, currentY + 100);

            if (prizeInfo.receiver) {
              ctx.fillStyle = '#666666';
              ctx.font = '24px Arial';
              ctx.textAlign = 'left';
              ctx.fillText('收取人', 50, currentY + 150);

              ctx.fillStyle = '#333333';
              ctx.font = '26px Arial';
              ctx.textAlign = 'right';
              ctx.fillText(prizeInfo.receiver, width - 50, currentY + 150);
            }

            currentY += prizeInfo.receiver ? 170 : 120;
          } else {
            currentY += 60;
          }

          // 绘制页脚装饰
          const bottomY = height - 60;
          ctx.fillStyle = '#f5f5f5';
          ctx.fillRect(0, bottomY, width, 60);
          ctx.fillStyle = '#999999';
          ctx.font = '20px Arial';
          ctx.textAlign = 'center';
          ctx.fillText('打牌记账小程序', width / 2, bottomY + 35);
        }
      });
  },

  /**
   * 保存战绩到相册
   * 将Canvas绘制的战绩图片转换为临时文件并保存到相册
   */
  saveResultToAlbum() {
    const query = wx.createSelectorQuery();
    query.select('#resultCanvas')
      .fields({ node: true, size: true })
      .exec((res) => {
        if (res && res[0]) {
          const canvas = res[0].node;
          wx.canvasToTempFilePath({
            canvas: canvas,
            success: (res) => {
              // 申请相册权限
              wx.getSetting({
                success: (setting) => {
                  if (!setting.authSetting['scope.writePhotosAlbum']) {
                    wx.authorize({
                      scope: 'scope.writePhotosAlbum',
                      success: () => {
                        this.saveToAlbum(res.tempFilePath);
                      },
                      fail: () => {
                        this.showTip('需要相册权限才能保存图片');
                      }
                    });
                  } else {
                    this.saveToAlbum(res.tempFilePath);
                  }
                }
              });
            },
            fail: () => {
              this.showTip('图片生成失败');
            }
          });
        }
      });
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
      },
      fail: () => {
        this.showTip('保存失败');
      }
    });
  },

  /**
   * 自动上传战绩到服务器
   * 弹窗弹出后自动执行，支持重试机制
   */
  autoUploadResult() {
    if (this.data.resultData.isUploaded) {
      return;
    }

    // TODO: 配置实际的服务器接口地址
    const serverUrl = 'https://your-server.com/api/settlement';
    
    // 上传函数
    const doUpload = (retryCount = 0) => {
      wx.request({
        url: serverUrl,
        method: 'POST',
        data: this.data.resultData,
        header: {
          'content-type': 'application/json'
        },
        success: (res) => {
          if (res.statusCode === 200) {
            // 上传成功（静默更新状态）
            const newData = { ...this.data.resultData, isUploaded: true };
            this.setData({ 
              resultData: newData
            });
          } else {
            // 服务器返回错误
            throw new Error('服务器错误');
          }
        },
        fail: () => {
          // 网络请求失败，判断是否重试
          if (retryCount < 3) {
            // 1秒后重试（静默）
            setTimeout(() => {
              doUpload(retryCount + 1);
            }, 1000);
          } else {
            // 达到最大重试次数，静默记录失败
            this.setData({ 
              uploadFailed: true
            });
            
            // 记录到本地存储，下次进入时重试
            const failedUploads = wx.getStorageSync('failedUploads') || [];
            failedUploads.push({
              data: this.data.resultData,
              timestamp: Date.now(),
              roomId: this.data.roomId
            });
            wx.setStorageSync('failedUploads', failedUploads);
          }
        }
      });
    };

    // 执行上传
    doUpload(0);
  },

  /**
   * 分享战绩
   * 调用微信小程序分享API，将战绩图片分享给好友或群聊
   */
  shareResult() {
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
  },

  /**
   * 关闭战绩弹窗
   */
  closeResultModal() {
    this.setData({ showResultModal: false });
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
   * 处理退出按钮点击事件
   * 弹出确认对话框，确认后返回上一页
   */
  handleExitBtn() {
    wx.showModal({
      title: '退出房间',
      content: '确认退出当前房间？',
      success: (res) => {
        if (res.confirm) {
          wx.navigateBack();
        }
      }
    });
  },

  /**
   * ==================== 下注模式新增功能 ==================== */

  /**
   * 点击"跟"按钮
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
    const room = this.data.room;

    // 获取玩家头像
    const playerIndex = room.members.findIndex(m => m.name === this.data.currentUser);
    const playerAvatar = room.members[playerIndex].avatarUrl || '';

    // 执行转入
    const result = this.processDeposit({
      amount,
      playerAvatar,
      recordType: 'follow',
      recordTypeText: '跟注'
    });

    if (!result.success) {
      return;
    }

    // 更新跟注状态
    this.setData({
      lastDepositAmount: amount,
      lastDepositOperator: this.data.currentUser,
      canFollow: true
    });

    // 触发转入奖池飘动动画
    this.triggerDepositAnimation(result.playerIndex, result.amount);

    // 滚动到底部显示新消息
    this.scrollToBottom();
  },

  /**
   * 点击"过"按钮
   * 功能：跳过当前回合，生成系统消息
   */
  handlePass() {
    // 游戏已结束，不允许操作
    if (this.data.room.status !== 'playing') {
      // this.showTip('游戏已结束，无法操作');
      return;
    }

    const currentUser = this.data.currentUser;
    const room = this.data.room;

    // 生成跳过记录（系统消息）
    const description = `${currentUser} 跳过了这回合`;

    const record = {
      description: description,
      processedDescription: description,
      time: this.getCurrentTime(),
      detail: {
        type: 'pass',
        operator: currentUser
      },
      hasMe: false,
      isSystem: true,
      isReceive: false,
      segments: [{ text: description, isMe: false }]
    };
    room.records.unshift(record);

    // 保存数据
    this.setData({ 
      room,
      'room.prizePool.total': room.prizePool.total  // 显式更新奖池路径
    });
    this.saveRoomData();

    this.scrollToBottom();
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
    const room = this.data.room;

    // 获取玩家头像
    const playerIndex = room.members.findIndex(m => m.name === this.data.currentUser);
    const playerAvatar = room.members[playerIndex].avatarUrl || '';

    // 执行转入
    const result = this.processDeposit({
      amount,
      playerAvatar,
      recordType: 'allin',
      recordTypeText: 'all in'
    });

    if (!result.success) {
      return;
    }

    // 更新跟注状态
    this.setData({
      lastDepositAmount: amount,
      lastDepositOperator: this.data.currentUser,
      canFollow: true
    });

    // 触发转入奖池飘动动画
    this.triggerDepositAnimation(result.playerIndex, result.amount);

    // 滚动到底部显示新消息
    this.scrollToBottom();
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
    console.log('[动画] 触发转入动画', { playerIndex, amount });

    const systemInfo = wx.getSystemInfoSync();
    const screenWidth = systemInfo.windowWidth;

    // 根据玩家索引计算固定的起始位置（更可靠）
    // 玩家列表在左侧（25%宽度），每个玩家卡片高度约120px
    const sectionWidth = screenWidth * 0.25;
    const startX = sectionWidth / 2 + 20; // 左侧区域中心偏右
    const startY = 100 + playerIndex * 140; // 根据索引垂直排列

    console.log('[动画] 计算的动画起始位置:', { startX, startY, playerIndex, screenWidth, sectionWidth });

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
    console.log('[动画] 创建飘动动画', { startX, startY, amount });

    // 设置动画数据（纯 CSS 动画，不使用 wx.createAnimation）
    this.setData({
      showFloatAnimation: true,
      floatAmount: amount,
      floatLeft: startX,
      floatTop: startY
    });

    console.log('[动画] setData 完成，showFloatAnimation:', true);
    console.log('[动画] 元素位置:', { left: startX, top: startY });

    // 动画结束后清理
    setTimeout(() => {
      console.log('[动画] 清理飘动动画');
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
    console.log('[动画] 触发收取奖池动画，金额:', amount);
    const systemInfo = wx.getSystemInfoSync();
    const screenWidth = systemInfo.windowWidth;
    const screenHeight = systemInfo.windowHeight;

    // 优化：减少动画元素数量，降低卡顿
    const isLowPerformance = screenWidth < 375;
    const confettiCount = isLowPerformance ? 2 : 4; // 从 3-6 减少到 2-4
    const coinCount = isLowPerformance ? 5 : 8; // 从 8-12 减少到 5-8

    console.log('[动画] 屏幕尺寸:', { width: screenWidth, height: screenHeight, isLowPerformance });
    console.log('[动画] 元素数量:', { confetti: confettiCount, coin: coinCount });

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

    console.log('[动画] 彩带列表:', confettiList);
    console.log('[动画] 金币列表:', coinList);
    console.log('[动画] 显示金额:', amount);

    // 设置动画数据
    this.setData({
      showReceiveAnimation: true,
      confettiList,
      coinList,
      receiveAmount: amount // 保存显示金额
    });

    console.log('[动画] setData 完成，showReceiveAnimation:', true);

    // 动画结束后清理（缩短清理时间）
    setTimeout(() => {
      console.log('[动画] 清理动画');
      this.setData({
        showReceiveAnimation: false,
        confettiList: [],
        coinList: [],
        receiveAmount: 0
      });
    }, 2200); // 从 3000ms 缩短到 2200ms
  }
});
