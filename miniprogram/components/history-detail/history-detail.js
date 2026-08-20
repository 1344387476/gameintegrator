const { buildSettlementPlan } = require('../../utils/settlement')

Component({
  options: {
    styleIsolation: 'isolated'
  },

  properties: {
    visible: { type: Boolean, value: false },
    loading: { type: Boolean, value: false },
    theme: { type: String, value: 'light' },
    detail: { type: Object, value: null },
    players: { type: Array, value: [] }
  },

  data: {
    saving: false,
    settlementEmpty: true,
    settlementPlan: {
      groups: [],
      isBalanced: true,
      difference: 0,
      hasTransfers: false
    }
  },

  observers: {
    'players.**': function(players) {
      const settlementPlan = buildSettlementPlan(players || [])
      this.setData({
        settlementPlan,
        settlementEmpty: settlementPlan.isBalanced && !settlementPlan.hasTransfers
      })
    }
  },

  lifetimes: {
    attached() {
      const settlementPlan = buildSettlementPlan(this.data.players || [])
      this.setData({
        settlementPlan,
        settlementEmpty: settlementPlan.isBalanced && !settlementPlan.hasTransfers
      })
    }
  },

  methods: {
    handleClose() {
      if (!this.data.saving) this.triggerEvent('close')
    },

    drawRoundedRect(ctx, x, y, width, height, radius) {
      if (ctx.roundRect) {
        ctx.beginPath()
        ctx.roundRect(x, y, width, height, radius)
        ctx.fill()
        return
      }
      ctx.fillRect(x, y, width, height)
    },

    drawPoster() {
      return new Promise((resolve, reject) => {
        this.createSelectorQuery().select('#historyPoster').fields({ node: true, size: true }).exec(result => {
          const item = result && result[0]
          const detail = this.data.detail
          const players = this.data.players || []
          if (!item || !item.node || !detail) return reject(new Error('海报画布初始化失败'))

          const canvas = item.node
          const ctx = canvas.getContext('2d')
          const width = 750
          const rowHeight = 76
          const height = Math.max(700, 410 + players.length * rowHeight)
          const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
          const ratio = info.pixelRatio || 2
          canvas.width = width * ratio
          canvas.height = height * ratio
          ctx.scale(ratio, ratio)

          ctx.fillStyle = '#F2F2F7'
          ctx.fillRect(0, 0, width, height)
          ctx.fillStyle = '#FFFFFF'
          this.drawRoundedRect(ctx, 36, 36, width - 72, height - 72, 28)

          ctx.fillStyle = '#1C1C1E'
          ctx.font = '700 42px sans-serif'
          ctx.fillText(detail.roomName || '牌局战绩', 72, 108)
          ctx.fillStyle = '#8E8E93'
          ctx.font = '24px sans-serif'
          ctx.fillText(`${detail.modeText || ''} · ${detail.displayTime || ''}`, 72, 152)
          ctx.fillStyle = '#248D52'
          ctx.font = '700 25px sans-serif'
          ctx.fillText('最终排名', 72, 220)

          let y = 276
          players.forEach((player, index) => {
            if (player.isMe) {
              ctx.fillStyle = '#EEF9F2'
              this.drawRoundedRect(ctx, 62, y - 42, width - 124, 62, 16)
            }
            ctx.fillStyle = '#8E8E93'
            ctx.font = '24px sans-serif'
            ctx.fillText(`${index + 1}`, 78, y)
            ctx.fillStyle = '#1C1C1E'
            ctx.font = `${player.isMe ? '700' : '500'} 27px sans-serif`
            ctx.fillText(String(player.nickname || '玩家').slice(0, 12), 130, y)
            ctx.fillStyle = player.score > 0 ? '#248D52' : (player.score < 0 ? '#D64545' : '#8E8E93')
            ctx.textAlign = 'right'
            ctx.font = '700 28px sans-serif'
            ctx.fillText(player.displayScore || '0', width - 80, y)
            ctx.textAlign = 'left'
            y += rowHeight
          })

          ctx.fillStyle = '#AEAEB2'
          ctx.font = '22px sans-serif'
          ctx.textAlign = 'center'
          ctx.fillText('牌局计分 · 输赢清清楚楚', width / 2, height - 62)
          ctx.textAlign = 'left'
          resolve({ canvas, width, height })
        })
      })
    },

    savePoster() {
      if (!this.data.detail || this.data.saving) return
      this.setData({ saving: true })
      this.drawPoster().then(({ canvas, width, height }) => new Promise((resolve, reject) => {
        wx.canvasToTempFilePath({
          canvas,
          x: 0,
          y: 0,
          width,
          height,
          destWidth: width * 2,
          destHeight: height * 2,
          fileType: 'png',
          success: result => resolve(result.tempFilePath),
          fail: reject
        })
      })).then(filePath => new Promise((resolve, reject) => {
        wx.saveImageToPhotosAlbum({ filePath, success: resolve, fail: reject })
      })).then(() => wx.showToast({ title: '已保存到相册', icon: 'success' }))
        .catch(error => {
          const message = String(error && error.errMsg)
          if (message.includes('auth deny') || message.includes('authorize:fail')) {
            wx.showModal({
              title: '需要相册权限',
              content: '请在设置中允许保存图片到相册。',
              confirmText: '去设置',
              success: result => { if (result.confirm) wx.openSetting() }
            })
          } else {
            wx.showToast({ title: '保存失败，请重试', icon: 'none' })
          }
        }).finally(() => this.setData({ saving: false }))
    }
  }
})
