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
    showWelcome: false // 是否显示欢迎消息
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
   */
  onShow() {
    if (this.data.roomId) {
      this.loadRoom(this.data.roomId);
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
   * 返回上一页
   */
  goBack() {
    wx.navigateBack();
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
      this.showTip('游戏已结束，无法操作');
      return;
    }

    // 普通模式：检查是否点击自己
    if (this.data.room.gameMode === 'normal') {
      if (member.name === this.data.currentUser) {
        this.showTip('不能向自己转账');
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
      this.showTip('本模式仅支持向奖池转入积分');
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
      this.showTip('找不到当前用户');
      return;
    }

    // 执行转账
    const sender = room.members[senderIndex];
    const receiver = room.members[targetIndex];

    sender.score -= amount;
    receiver.score += amount;

    // 更新滚动标志
    const updateMemberScrollFlags = (member) => {
      // 检测积分是否需要滚动（超过7位数字，包括符号）
      const scoreText = member.score > 0 ? `+${member.score}` : `${member.score}`;
      const scoreScroll = scoreText.length > 7;
      
      member.scoreScroll = scoreScroll;
    };

    updateMemberScrollFlags(sender);
    updateMemberScrollFlags(receiver);

    // 获取双方头像
    const senderAvatar = sender.avatarUrl || '';
    const receiverAvatar = receiver.avatarUrl || '';

    // 生成转账记录
    const description = `${currentUser} 转 ${amount} 分给 ${receiver.name}`;
    const processedDescription = description.replace(currentUser, '我');
    const hasMe = processedDescription.includes('我');

    // 将描述分割成片段，用于单独高亮"我"字和金额
    let segments = [];
    if (hasMe) {
      const parts = processedDescription.split('我');
      for (let i = 0; i < parts.length; i++) {
        if (parts[i]) {
          // 检查是否包含金额
          if (parts[i].includes(`${amount}`)) {
            const amountParts = parts[i].split(`${amount}`);
            if (amountParts[0]) {
              segments.push({ text: amountParts[0], isMe: false, isAmount: false });
            }
            segments.push({ text: `${amount}`, isMe: false, isAmount: true });
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
      // 处理不包含"我"的情况，但仍然要高亮金额
      if (processedDescription.includes(`${amount}`)) {
        const amountParts = processedDescription.split(`${amount}`);
        if (amountParts[0]) {
          segments.push({ text: amountParts[0], isMe: false, isAmount: false });
        }
        segments.push({ text: `${amount}`, isMe: false, isAmount: true });
        if (amountParts[1]) {
          segments.push({ text: amountParts[1], isMe: false, isAmount: false });
        }
      } else {
        segments.push({ text: processedDescription, isMe: false, isAmount: false });
      }
    }

    const record = {
      description: description,
      processedDescription: processedDescription,
      time: this.getCurrentTime(),
      detail: {
        type: 'transfer',
        sender: currentUser,
        senderAvatar: senderAvatar,
        receiver: receiver.name,
        receiverAvatar: receiverAvatar,
        amount: amount,
        senderScoreAfter: sender.score,
        receiverScoreAfter: receiver.score
      },
      hasMe: hasMe,
      isSystem: false,
      isReceive: false,
      segments: segments
    };
    room.records.unshift(record);

    // 保存数据
    this.setData({ 
      room,
      'room.prizePool.total': room.prizePool.total  // 显式更新奖池路径
    });
    this.saveRoomData();

    // 关闭弹窗并提示
    this.closeTransferModal();
    this.showTip('转账成功');

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
      this.showTip('游戏已结束，无法操作');
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

    // 执行转入
    const player = room.members[playerIndex];
    player.score -= amount;
    // 如果奖池已被收取，有新转入时清空收取记录，使收取按钮恢复可用
    if (room.prizePool.receiver) {
      room.prizePool.receiver = '';
      room.prizePool.receivedTime = '';
    }
    room.prizePool.total += amount;

    // 更新滚动标志
    const updateMemberScrollFlags = (member) => {
      // 检测积分是否需要滚动（超过7位数字，包括符号）
      const scoreText = member.score > 0 ? `+${member.score}` : `${member.score}`;
      const scoreScroll = scoreText.length > 7;
      
      member.scoreScroll = scoreScroll;
    };

    updateMemberScrollFlags(player);

    // 播放动画
    this.setData({ animateAmount: true });
    setTimeout(() => this.setData({ animateAmount: false }), 400);

    // 生成转入记录（下注模式显示为"下注"）
    const description = `${currentUser} 下注 ${amount} 分`;
    const processedDescription = description.replace(currentUser, '我');
    const hasMe = processedDescription.includes('我');

    // 获取玩家头像
    const playerAvatar = player.avatarUrl || '';

    // 将描述分割成片段，用于单独高亮"我"字
    let segments = [];
    if (hasMe) {
      const parts = processedDescription.split('我');
      for (let i = 0; i < parts.length; i++) {
        if (parts[i]) {
          segments.push({ text: parts[i], isMe: false });
        }
        if (i < parts.length - 1) {
          segments.push({ text: '我', isMe: true });
        }
      }
    } else {
      segments.push({ text: processedDescription, isMe: false });
    }

    const record = {
      description: description,
      processedDescription: processedDescription,
      time: this.getCurrentTime(),
      detail: {
        type: 'deposit',
        operator: currentUser,
        operatorAvatar: playerAvatar,
        avatarUrl: playerAvatar,
        amount: amount,
        playerScoreAfter: player.score,
        prizePoolAfter: room.prizePool.total
      },
      hasMe: hasMe,
      isSystem: false,
      isReceive: false,
      segments: segments
    };
    room.records.unshift(record);

    // 保存数据
    this.setData({ 
      room,
      'room.prizePool.total': room.prizePool.total  // 显式更新奖池路径
    });
    this.saveRoomData();

    // 关闭弹窗并提示
    this.closePrizeModal();
    this.showTip('转入成功');

    // 滚动到底部显示新消息
    this.scrollToBottom();
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
      this.showTip('游戏已结束，无法操作');
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

    // 更新滚动标志
    const updateMemberScrollFlags = (member) => {
      // 检测积分是否需要滚动（超过7位数字，包括符号）
      const scoreText = member.score > 0 ? `+${member.score}` : `${member.score}`;
      const scoreScroll = scoreText.length > 7;
      
      member.scoreScroll = scoreScroll;
    };

    updateMemberScrollFlags(player);

    // 重置奖池并记录收取信息
    room.prizePool.total = 0;
    room.prizePool.receiver = currentUser;
    room.prizePool.receivedTime = this.getCurrentTime();

    // 生成收取记录
    const description = `${currentUser} 收取了奖池 ${prizeAmount} 分`;
    const processedDescription = description.replace(currentUser, '我');
    const hasMe = processedDescription.includes('我');

    // 获取玩家头像
    const playerAvatar = player.avatarUrl || '';

    // 将描述分割成片段，用于单独高亮"我"字
    let segments = [];
    if (hasMe) {
      const parts = processedDescription.split('我');
      for (let i = 0; i < parts.length; i++) {
        if (parts[i]) {
          segments.push({ text: parts[i], isMe: false });
        }
        if (i < parts.length - 1) {
          segments.push({ text: '我', isMe: true });
        }
      }
    } else {
      segments.push({ text: processedDescription, isMe: false });
    }

    const record = {
      description: description,
      processedDescription: processedDescription,
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
      hasMe: hasMe,
      isSystem: false,
      isReceive: true,
      segments: segments
    };
    room.records.unshift(record);

    // 保存数据
    this.setData({ 
      room,
      'room.prizePool.total': room.prizePool.total  // 显式更新奖池路径
    });
    this.saveRoomData();

    // 关闭弹窗并提示
    this.closeReceiveModal();
    this.showTip('收取成功');

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
      this.showTip('找不到当前用户');
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
    const updateMemberScrollFlags = (member) => {
      // 检测积分是否需要滚动（超过7位数字，包括符号）
      const scoreText = member.score > 0 ? `+${member.score}` : `${member.score}`;
      const scoreScroll = scoreText.length > 7;
      
      member.scoreScroll = scoreScroll;
    };

    updateMemberScrollFlags(sender);
    for (const transfer of transfers) {
      const receiver = room.members.find(m => m.name === transfer.memberName);
      updateMemberScrollFlags(receiver);

      // 生成转账记录
      const description = `${currentUser} 转 ${transfer.amount} 分给 ${receiver.name}`;
      const processedDescription = description.replace(currentUser, '我');
      const hasMe = processedDescription.includes('我');

      // 获取双方头像
      const senderAvatar = sender.avatarUrl || '';
      const receiverAvatar = receiver.avatarUrl || '';

      // 将描述分割成片段，用于单独高亮"我"字和金额
      let segments = [];
      if (hasMe) {
        const parts = processedDescription.split('我');
        for (let i = 0; i < parts.length; i++) {
          if (parts[i]) {
            // 检查是否包含金额
            if (parts[i].includes(`${transfer.amount}`)) {
              const amountParts = parts[i].split(`${transfer.amount}`);
              if (amountParts[0]) {
                segments.push({ text: amountParts[0], isMe: false, isAmount: false });
              }
              segments.push({ text: `${transfer.amount}`, isMe: false, isAmount: true });
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
        // 处理不包含"我"的情况，但仍然要高亮金额
        if (processedDescription.includes(`${transfer.amount}`)) {
          const amountParts = processedDescription.split(`${transfer.amount}`);
          if (amountParts[0]) {
            segments.push({ text: amountParts[0], isMe: false, isAmount: false });
          }
          segments.push({ text: `${transfer.amount}`, isMe: false, isAmount: true });
          if (amountParts[1]) {
            segments.push({ text: amountParts[1], isMe: false, isAmount: false });
          }
        } else {
          segments.push({ text: processedDescription, isMe: false, isAmount: false });
        }
      }

      const record = {
        description: description,
        processedDescription: processedDescription,
        time: this.getCurrentTime(),
        detail: {
          type: 'transfer',
          sender: currentUser,
          senderAvatar: senderAvatar,
          receiver: receiver.name,
          receiverAvatar: receiverAvatar,
          amount: transfer.amount,
          senderScoreAfter: sender.score,
          receiverScoreAfter: receiver.score
        },
        hasMe: hasMe,
        isSystem: false,
        isReceive: false,
        segments: segments
      };
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
    this.showTip(`支出成功，共转出 ${totalAmount} 积分`);

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
   * 2. 生成战绩数据
   * 3. 绘制战绩图片
   * 4. 更新房间状态为"已结束"
   * 5. 显示战绩弹窗
   */
  confirmSettle() {
    const room = this.data.room;

    // 计算玩家战绩
    const playerList = room.members.map(player => {
      let result = '平局';
      let winLose = player.score;

      if (player.score > 0) {
        result = '赢';
      } else if (player.score < 0) {
        result = '输';
      }

      return {
        playerName: player.name,
        score: player.score,
        result: result,
        winLose: winLose
      };
    });

    // 准备战绩数据
    const resultData = {
      roomId: room._id,
      roomMode: room.gameMode === 'normal' ? '普通模式' : '下注模式',
      roomName: room.roomName,
      settlementTime: this.getCurrentTime(),
      creator: room.creator,
      playerList: playerList,
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
   * 使用Canvas 2D API绘制战绩卡片
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

          // 绘制装饰条
          ctx.fillStyle = '#4CD964';
          ctx.fillRect(0, 0, width, 120);

          // 绘制房间信息
          ctx.fillStyle = '#333333';
          ctx.font = 'bold 36px Arial';
          ctx.textAlign = 'center';
          ctx.fillText(this.data.resultData.roomName, width / 2, 60);

          ctx.font = '24px Arial';
          ctx.fillText(this.data.resultData.roomMode, width / 2, 100);

          // 绘制玩家列表
          const startY = 180;
          const lineHeight = 70;

          ctx.font = '28px Arial';
          ctx.textAlign = 'left';
          ctx.fillStyle = '#333333';

          this.data.resultData.playerList.forEach((player, index) => {
            const y = startY + index * lineHeight;
            const scoreText = player.score >= 0 ? `+${player.score}` : `${player.score}`;
            const scoreColor = player.score >= 0 ? '#4CD964' : '#FF3B30';

            ctx.fillText(`${player.name}:`, 60, y);
            ctx.fillStyle = scoreColor;
            ctx.font = 'bold 28px Arial';
            ctx.fillText(scoreText, 250, y);
            ctx.fillStyle = '#333333';
            ctx.font = '28px Arial';
            ctx.fillText(`(${player.result})`, 380, y);
          });

          // 下注模式：绘制奖池信息
          if (this.data.resultData.roomMode === '下注模式' && this.data.resultData.prizePoolInfo) {
            const prizeInfo = this.data.resultData.prizePoolInfo;
            const prizeY = startY + this.data.resultData.playerList.length * lineHeight + 60;

            ctx.fillStyle = '#FF7A2F';
            ctx.fillRect(40, prizeY - 20, width - 80, 100);

            ctx.fillStyle = '#ffffff';
            ctx.font = '24px Arial';
            ctx.textAlign = 'center';
            ctx.fillText('奖池总额', width / 2, prizeY + 20);
            ctx.font = 'bold 36px Arial';
            ctx.fillText(`${prizeInfo.totalPrizePool} 积分`, width / 2, prizeY + 60);

            if (prizeInfo.receiver) {
              ctx.font = '24px Arial';
              ctx.fillText(`收取人: ${prizeInfo.receiver}`, width / 2, height - 80);
            }
          }

          // 绘制结算时间
          ctx.fillStyle = '#999999';
          ctx.font = '20px Arial';
          ctx.textAlign = 'center';
          ctx.fillText(`结算时间: ${this.data.resultData.settlementTime}`, width / 2, height - 30);
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
   * 上传战绩到服务器
   * TODO: 需要配置实际的服务器接口地址
   */
  uploadResult() {
    if (this.data.resultData.isUploaded) {
      return;
    }

    // TODO: 配置服务器接口地址
    const serverUrl = 'https://your-server.com/api/settlement';

    wx.request({
      url: serverUrl,
      method: 'POST',
      data: this.data.resultData,
      header: {
        'content-type': 'application/json'
      },
      success: () => {
        const newData = { ...this.data.resultData, isUploaded: true };
        this.setData({ resultData: newData });
        this.showTip('上传成功');
      },
      fail: () => {
        this.showTip('网络异常，点击重试');
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
    setTimeout(() => {
      this.drawQrcode();
    }, 300);
  },

  /**
   * 隐藏二维码弹窗
   */
  hideQrcode() {
    this.setData({ showQrcode: false });
  },

  /**
   * 绘制房间二维码
   * 使用Canvas绘制房间ID和提示信息
   */
  drawQrcode() {
    const query = wx.createSelectorQuery();
    query.select('#qrcodeCanvas')
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

          ctx.clearRect(0, 0, width, height);

          // 绘制白色背景
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, width, height);

          // 绘制房间ID
          ctx.fillStyle = '#333333';
          ctx.font = 'bold 32px Arial';
          ctx.textAlign = 'center';
          ctx.fillText('房间ID', width / 2, 80);

          ctx.font = 'bold 48px Arial';
          ctx.fillText(this.data.room._id, width / 2, 150);

          // 绘制提示文字
          ctx.font = '20px Arial';
          ctx.fillStyle = '#999999';
          ctx.fillText('请使用扫码功能加入房间', width / 2, 220);

          // 绘制边框
          ctx.strokeStyle = '#FF7A2F';
          ctx.lineWidth = 3;
          ctx.strokeRect(20, 20, width - 40, height - 40);
        }
      });
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
      this.showTip('游戏已结束，无法操作');
      return;
    }

    const amount = this.data.lastDepositAmount;
    const currentUser = this.data.currentUser;
    const room = this.data.room;

    // 找到操作玩家
    const playerIndex = room.members.findIndex(m => m.name === currentUser);
    if (playerIndex === -1) {
      this.showTip('找不到当前用户');
      return;
    }

    // 执行转入
    const player = room.members[playerIndex];
    player.score -= amount;
    // 如果奖池已被收取，有新转入时清空收取记录，使收取按钮恢复可用
    if (room.prizePool.receiver) {
      room.prizePool.receiver = '';
      room.prizePool.receivedTime = '';
    }
    room.prizePool.total += amount;

    // 更新滚动标志
    const updateMemberScrollFlags = (member) => {
      const scoreText = member.score > 0 ? `+${member.score}` : `${member.score}`;
      const scoreScroll = scoreText.length > 7;
      member.scoreScroll = scoreScroll;
    };

    updateMemberScrollFlags(player);

    // 更新跟注状态
    this.setData({
      lastDepositAmount: amount,
      lastDepositOperator: currentUser,
      canFollow: true
    });

    // 播放动画
    this.setData({ animateAmount: true });
    setTimeout(() => this.setData({ animateAmount: false }), 400);

    // 获取玩家头像
    const playerAvatar = player.avatarUrl || '';

    // 生成跟注记录（下注模式）
    const description = `${currentUser} 跟注 ${amount} 分`;
    const processedDescription = description.replace(currentUser, '我');
    const hasMe = processedDescription.includes('我');

    // 将描述分割成片段，用于单独高亮"我"字和金额
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

    const record = {
      description: description,
      processedDescription: processedDescription,
      time: this.getCurrentTime(),
      detail: {
        type: 'follow',
        operator: currentUser,
        operatorAvatar: playerAvatar,
        avatarUrl: playerAvatar,
        amount: amount,
        playerScoreAfter: player.score,
        prizePoolAfter: room.prizePool.total
      },
      hasMe: hasMe,
      isSystem: false,
      isReceive: false,
      segments: segments
    };
    room.records.unshift(record);

    // 保存数据
    this.setData({ 
      room,
      'room.prizePool.total': room.prizePool.total  // 显式更新奖池路径
    });
    this.saveRoomData();

    this.showTip('跟注成功');
    this.scrollToBottom();
  },

  /**
   * 点击"过"按钮
   * 功能：跳过当前回合，生成系统消息
   */
  handlePass() {
    // 游戏已结束，不允许操作
    if (this.data.room.status !== 'playing') {
      this.showTip('游戏已结束，无法操作');
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
      this.showTip('游戏已结束，无法操作');
      return;
    }

    const amount = this.data.room.allInValue;
    const currentUser = this.data.currentUser;
    const room = this.data.room;

    // 找到当前玩家
    const playerIndex = room.members.findIndex(m => m.name === currentUser);
    if (playerIndex === -1) {
      this.showTip('找不到当前用户');
      return;
    }

    const player = room.members[playerIndex];

    // 扣除玩家积分
    player.score -= amount;

    // 如果奖池已被收取，有新转入时清空收取记录，使收取按钮恢复可用
    if (room.prizePool.receiver) {
      room.prizePool.receiver = '';
      room.prizePool.receivedTime = '';
    }

    // 增加奖池金额
    room.prizePool.total += amount;

    // 更新滚动标志
    const updateMemberScrollFlags = (member) => {
      const scoreText = member.score > 0 ? `+${member.score}` : `${member.score}`;
      const scoreScroll = scoreText.length > 7;
      member.scoreScroll = scoreScroll;
    };

    updateMemberScrollFlags(player);

    // 更新跟注状态
    this.setData({
      lastDepositAmount: amount,
      lastDepositOperator: currentUser,
      canFollow: true
    });

    // 播放动画
    this.setData({ animateAmount: true });
    setTimeout(() => this.setData({ animateAmount: false }), 400);

    // 生成all in记录
    const playerAvatar = player.avatarUrl || '';
    const description = `${currentUser} all in ${amount} 分`;
    const processedDescription = description.replace(currentUser, '我');
    const hasMe = processedDescription.includes('我');

    // 将描述分割成片段，用于单独高亮"我"字和金额
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

    const record = {
      description: description,
      processedDescription: processedDescription,
      time: this.getCurrentTime(),
      detail: {
        type: 'allin',
        operator: currentUser,
        operatorAvatar: playerAvatar,
        avatarUrl: playerAvatar,
        amount: amount,
        playerScoreAfter: player.score,
        prizePoolAfter: room.prizePool.total,
      },
      hasMe: hasMe,
      isSystem: false,
      isReceive: false,
      segments: segments
    };

    room.records.unshift(record);

    // 保存数据
    this.setData({ 
      room,
      'room.prizePool.total': room.prizePool.total  // 显式更新奖池路径
    });
    this.saveRoomData();

    this.showTip('All in成功');
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
   * 点击奖池区域
   * 功能：打开转入奖池弹窗
   */
  transferToPrizePool() {
    // 游戏已结束，不允许操作
    if (this.data.room.status !== 'playing') {
      this.showTip('游戏已结束，无法操作');
      return;
    }

    // 打开转入奖池弹窗
    this.setData({
      showPrizeModal: true,
      prizeAmount: '',
      showInputError: false
    });
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
  }
});
