/**
 * 新增记账页面
 * 功能：选择赢家、输入金额、选择输家、添加备注并记录
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
    // 房间信息（包含成员列表和记录列表）
    room: {
      members: [],
      records: []
    },
    // 选中的赢家索引
    winnerIndex: -1,
    // 赢得金额
    amount: '',
    // 输家选择数组
    losers: [],
    // 备注
    remark: ''
  },

  /**
   * 生命周期函数 - 页面加载
   * @param {Object} options - 页面参数，包含roomId
   */
  onLoad(options) {
    const { roomId } = options;
    this.setData({ roomId });
    this.loadRoom(roomId);
  },

  /**
   * 加载房间数据
   * @param {string} roomId - 房间ID
   */
  loadRoom(roomId) {
    const rooms = wx.getStorageSync('rooms') || [];
    const room = rooms.find(r => r._id === roomId);
    if (room) {
      // 初始化输家选择数组
      const losers = new Array(room.members.length).fill(false);
      this.setData({
        room,
        losers
      });
    }
  },

  /**
   * 赢家选择变更事件
   * @param {Object} e - 事件对象，包含选中的赢家索引
   */
  onWinnerChange(e) {
    this.setData({
      winnerIndex: parseInt(e.detail.value)
    });
  },

  /**
   * 金额输入事件
   * @param {Object} e - 事件对象，包含输入的金额
   */
  onAmountInput(e) {
    this.setData({
      amount: e.detail.value
    });
  },

  /**
   * 备注输入事件
   * @param {Object} e - 事件对象，包含输入的备注
   */
  onRemarkInput(e) {
    this.setData({
      remark: e.detail.value
    });
  },

  /**
   * 切换输家选择状态
   * @param {Object} e - 事件对象，包含成员索引
   */
  toggleLoser(e) {
    const { index } = e.currentTarget.dataset;
    const losers = this.data.losers;
    losers[index] = !losers[index];
    this.setData({ losers });
  },

  /**
   * 提交记账记录
   * 验证输入后生成记账记录并保存到房间数据
   */
  submitRecord() {
    const { winnerIndex, amount, losers, remark, room, roomId } = this.data;

    // 验证输入
    if (winnerIndex === -1) {
      wx.showToast({
        title: '请选择赢家',
        icon: 'none'
      });
      return;
    }

    if (!amount || parseFloat(amount) <= 0) {
      wx.showToast({
        title: '请输入有效金额',
        icon: 'none'
      });
      return;
    }

    if (!losers.some(l => l)) {
      wx.showToast({
        title: '请至少选择一个输家',
        icon: 'none'
      });
      return;
    }

    // 获取输家列表
    const loserNames = room.members.filter((_, index) => losers[index]);

    // 创建记账记录
    const newRecord = {
      winner: room.members[winnerIndex],
      amount: parseFloat(amount),
      losers: loserNames,
      remark: remark || '',
      time: this.formatTime(new Date())
    };

    // 更新房间数据
    const rooms = wx.getStorageSync('rooms') || [];
    const roomIndex = rooms.findIndex(r => r._id === roomId);
    if (roomIndex !== -1) {
      rooms[roomIndex].records.unshift(newRecord);
      wx.setStorageSync('rooms', rooms);

      wx.showToast({
        title: '记账成功',
        icon: 'success'
      });

      // 延迟返回房间详情页
      setTimeout(() => {
        wx.navigateBack();
      }, 1500);
    }
  },

  /**
   * 格式化时间
   * @param {Date} date - 日期对象
   * @returns {string} 格式化后的时间字符串 (YYYY-MM-DD HH:mm)
   */
  formatTime(date) {
    const year = date.getFullYear();
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    const hour = date.getHours().toString().padStart(2, '0');
    const minute = date.getMinutes().toString().padStart(2, '0');
    return `${year}-${month}-${day} ${hour}:${minute}`;
  }
});
