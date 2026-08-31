const theme = require('../../utils/theme')
const motion = require('../../utils/motion')
const { limitDisplayText, safeInteger } = require('../../utils/display')
const backend = require('../../utils/backend')

Page({
  data: {
    appearanceTheme: getApp().globalData.appearanceTheme || 'light',
    motionLevel: motion.getMotionLevel(),
    pageSafeTop: 82,
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
    this.updatePageSafeTop()
    wx.showShareMenu({ menus: ['shareAppMessage'] })
    this.loadHistory(true)
  },

  updatePageSafeTop() {
    const { safeTop } = theme.getCustomNavMetrics()
    this.setData({ pageSafeTop: safeTop + 20 })
  },

  onResize() {
    this.updatePageSafeTop()
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
    const score = safeInteger(item.myScore)
    return {
      ...item,
      roomName: limitDisplayText(item.roomName, 20, '牌局'),
      displayTime: this.formatTime(item.endTime),
      displayScore: score > 0 ? `+${score}` : `${score}`,
      scoreCompact: `${score}`.length > 9,
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
    return backend.callFunction({
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
    backend.callFunction({
      name: 'roomFunctions',
      data: { action: 'getHistoryDetail', payload: { historyId } }
    }).then(res => {
      const result = res.result || {}
      if (!result.success) throw new Error(result.msg || '详情加载失败')
      const detail = result.detail
      const avatarUrls = detail.avatarUrls || {}
      const players = (detail.players || []).map((player, index) => ({
        ...player,
        nickname: limitDisplayText(player.nickname, 10, '玩家'),
        score: safeInteger(player.score),
        avatarUrl: avatarUrls[player.avatarFileID] || '/images/avatar.png',
        displayScore: safeInteger(player.score) > 0 ? `+${safeInteger(player.score)}` : `${safeInteger(player.score)}`,
        scoreCompact: `${safeInteger(player.score)}`.length > 9,
        scoreClass: safeInteger(player.score) > 0 ? 'positive' : (safeInteger(player.score) < 0 ? 'negative' : 'zero'),
        isMe: player.openid === wx.getStorageSync('openid'),
        motionDelay: motion.getStaggerDelay(index, 35, 210)
      })).sort((a, b) => b.score - a.score)
      const me = players.find(player => player.isMe)
      this.setData({
        detail: {
          ...detail,
          roomName: limitDisplayText(detail.roomName, 20, '牌局'),
          displayTime: this.formatTime(detail.endTime),
          modeText: detail.mode === 'bet' ? '下注模式' : '普通模式',
          myResultText: me ? (me.score > 0 ? '本局获胜' : (me.score < 0 ? '本局负分' : '本局持平')) : '',
          myDisplayScore: me ? me.displayScore : '',
          myScoreClass: me ? me.scoreClass : 'zero'
        },
        detailPlayers: players,
        detailLoading: false
      })
    }).catch(err => {
      this.setData({ detailLoading: false })
      wx.showToast({ title: err.message || '详情加载失败', icon: 'none' })
    })
  },

  closeDetail() { this.setData({ showDetail: false, detail: null, detailPlayers: [] }) },

  onShareAppMessage() {
    const detail = this.data.detail
    return { title: detail ? `${detail.roomName} · 牌局战绩` : '我的牌局战绩', path: '/pages/record/record' }
  }
})
