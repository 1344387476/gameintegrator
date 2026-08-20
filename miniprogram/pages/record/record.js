const theme = require('../../utils/theme')
const motion = require('../../utils/motion')

Page({
  data: {
    appearanceTheme: getApp().globalData.appearanceTheme || 'light',
    motionLevel: motion.getMotionLevel(),
    items: [],
    page: 1,
    hasMore: true,
    loading: true,
    loadingMore: false,
    errorText: '',
    showDetail: false,
    detailLoading: false,
    detail: null,
    detailPlayers: [],
    savingPoster: false
  },

  onLoad() {
    this.setData({ appearanceTheme: theme.getTheme() })
    theme.applyNativeChrome('record', this.data.appearanceTheme)
    wx.showShareMenu({ menus: ['shareAppMessage'] })
    this.loadHistory(true)
  },

  onShow() {
    const appearanceTheme = theme.getTheme()
    if (appearanceTheme !== this.data.appearanceTheme) this.setData({ appearanceTheme })
    theme.applyNativeChrome('record', appearanceTheme)
  },

  onPullDownRefresh() {
    this.loadHistory(true).finally(() => wx.stopPullDownRefresh())
  },

  onReachBottom() {
    if (this.data.hasMore && !this.data.loadingMore) this.loadHistory(false)
  },

  formatTime(value) {
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return ''
    const pad = number => String(number).padStart(2, '0')
    return `${date.getFullYear()}.${pad(date.getMonth() + 1)}.${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
  },

  decorateItem(item, index = 0) {
    const score = Number(item.myScore) || 0
    return {
      ...item,
      displayTime: this.formatTime(item.endTime),
      displayScore: score > 0 ? `+${score}` : `${score}`,
      resultText: score > 0 ? '胜' : (score < 0 ? '负' : '平'),
      resultClass: score > 0 ? 'win' : (score < 0 ? 'lose' : 'draw'),
      modeText: item.mode === 'bet' ? '下注模式' : '普通模式',
      motionDelay: motion.getStaggerDelay(index)
    }
  },

  loadHistory(reset) {
    if (this.data.loadingMore) return Promise.resolve()
    const page = reset ? 1 : this.data.page
    this.setData(reset ? { loading: true, errorText: '' } : { loadingMore: true })
    return wx.cloud.callFunction({
      name: 'roomFunctions',
      data: { action: 'listHistory', payload: { page, pageSize: 20 } }
    }).then(res => {
      const result = res.result || {}
      if (!result.success) throw new Error(result.msg || '战绩加载失败')
      const incoming = (result.items || []).map((item, index) => this.decorateItem(item, index))
      this.setData({
        items: reset ? incoming : this.data.items.concat(incoming),
        page: page + 1,
        hasMore: Boolean(result.hasMore),
        loading: false,
        loadingMore: false,
        errorText: ''
      })
    }).catch(err => {
      console.error('加载战绩失败:', err)
      this.setData({ loading: false, loadingMore: false, errorText: err.message || '加载失败，请重试' })
    })
  },

  retryLoad() { this.loadHistory(this.data.items.length === 0) },

  openDetail(e) {
    const historyId = e.currentTarget.dataset.id
    this.setData({ showDetail: true, detailLoading: true, detail: null, detailPlayers: [] })
    wx.cloud.callFunction({
      name: 'roomFunctions',
      data: { action: 'getHistoryDetail', payload: { historyId } }
    }).then(res => {
      const result = res.result || {}
      if (!result.success) throw new Error(result.msg || '详情加载失败')
      const detail = result.detail
      const avatarUrls = detail.avatarUrls || {}
      const players = (detail.players || []).map((player, index) => ({
        ...player,
        avatarUrl: avatarUrls[player.avatarFileID] || '/images/avatar.png',
        displayScore: player.score > 0 ? `+${player.score}` : `${player.score}`,
        scoreClass: player.score > 0 ? 'positive' : (player.score < 0 ? 'negative' : 'zero'),
        isMe: player.openid === wx.getStorageSync('openid'),
        motionDelay: motion.getStaggerDelay(index, 35, 210)
      })).sort((a, b) => b.score - a.score)
      this.setData({
        detail: { ...detail, displayTime: this.formatTime(detail.endTime), modeText: detail.mode === 'bet' ? '下注模式' : '普通模式' },
        detailPlayers: players,
        detailLoading: false
      })
    }).catch(err => {
      this.setData({ detailLoading: false })
      wx.showToast({ title: err.message || '详情加载失败', icon: 'none' })
    })
  },

  closeDetail() { this.setData({ showDetail: false, detail: null, detailPlayers: [] }) },

  drawPoster() {
    return new Promise((resolve, reject) => {
      const query = wx.createSelectorQuery().in(this)
      query.select('#historyPoster').fields({ node: true, size: true }).exec(result => {
        const item = result && result[0]
        if (!item || !item.node) return reject(new Error('海报画布初始化失败'))
        const canvas = item.node
        const ctx = canvas.getContext('2d')
        const width = 750
        const rowHeight = 76
        const height = 410 + this.data.detailPlayers.length * rowHeight
        const ratio = wx.getWindowInfo ? wx.getWindowInfo().pixelRatio : 2
        canvas.width = width * ratio
        canvas.height = height * ratio
        ctx.scale(ratio, ratio)
        ctx.fillStyle = '#F2F2F7'; ctx.fillRect(0, 0, width, height)
        ctx.fillStyle = '#FFFFFF'
        if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(36, 36, width - 72, height - 72, 28); ctx.fill() }
        else ctx.fillRect(36, 36, width - 72, height - 72)
        ctx.fillStyle = '#1C1C1E'; ctx.font = '700 42px sans-serif'; ctx.fillText(this.data.detail.roomName || '牌局战绩', 72, 108)
        ctx.fillStyle = '#8E8E93'; ctx.font = '24px sans-serif'; ctx.fillText(`${this.data.detail.modeText} · ${this.data.detail.displayTime}`, 72, 152)
        ctx.fillStyle = '#28A860'; ctx.font = '700 25px sans-serif'; ctx.fillText('最终排名', 72, 220)
        let y = 276
        this.data.detailPlayers.forEach((player, index) => {
          if (player.isMe) { ctx.fillStyle = '#EEF9F2'; ctx.fillRect(62, y - 42, width - 124, 62) }
          ctx.fillStyle = '#8E8E93'; ctx.font = '24px sans-serif'; ctx.fillText(`${index + 1}`, 78, y)
          ctx.fillStyle = '#1C1C1E'; ctx.font = `${player.isMe ? '700' : '500'} 27px sans-serif`; ctx.fillText(player.nickname, 130, y)
          ctx.fillStyle = player.score > 0 ? '#248D52' : (player.score < 0 ? '#D64545' : '#8E8E93')
          ctx.textAlign = 'right'; ctx.font = '700 28px sans-serif'; ctx.fillText(player.displayScore, width - 80, y); ctx.textAlign = 'left'
          y += rowHeight
        })
        ctx.fillStyle = '#AEAEB2'; ctx.font = '22px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('牌局计分 · 输赢清清楚楚', width / 2, height - 62); ctx.textAlign = 'left'
        resolve({ canvas, width, height })
      })
    })
  },

  savePoster() {
    if (!this.data.detail || this.data.savingPoster) return
    this.setData({ savingPoster: true })
    this.drawPoster().then(({ canvas, width, height }) => new Promise((resolve, reject) => {
      wx.canvasToTempFilePath({ canvas, x: 0, y: 0, width, height, destWidth: width * 2, destHeight: height * 2, fileType: 'png', success: res => resolve(res.tempFilePath), fail: reject })
    })).then(filePath => new Promise((resolve, reject) => {
      wx.saveImageToPhotosAlbum({ filePath, success: resolve, fail: reject })
    })).then(() => wx.showToast({ title: '已保存到相册', icon: 'success' }))
      .catch(err => {
        const denied = String(err && err.errMsg).includes('auth deny')
        if (denied) wx.showModal({ title: '需要相册权限', content: '请在设置中允许保存图片到相册。', confirmText: '去设置', success: res => { if (res.confirm) wx.openSetting() } })
        else wx.showToast({ title: '保存失败，请重试', icon: 'none' })
      }).finally(() => this.setData({ savingPoster: false }))
  },

  onShareAppMessage() {
    const detail = this.data.detail
    return { title: detail ? `${detail.roomName} · 牌局战绩` : '我的牌局战绩', path: '/pages/record/record' }
  }
})
