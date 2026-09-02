const { buildSettlementPlan } = require('../../utils/settlement')
const { buildHistoryPosterModel } = require('../../utils/history-poster')

const POSTER_QR_PATH = '/images/qr.jpg'

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
    sharing: false,
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
      if (!this.data.saving && !this.data.sharing) this.triggerEvent('close')
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

    fitText(ctx, value, maxWidth) {
      const text = String(value || '')
      if (ctx.measureText(text).width <= maxWidth) return text
      const chars = [...text]
      while (chars.length && ctx.measureText(`${chars.join('')}…`).width > maxWidth) chars.pop()
      return `${chars.join('')}…`
    },

    loadCanvasImage(canvas, src, required = false) {
      return new Promise((resolve, reject) => {
        const image = canvas.createImage()
        image.onload = () => resolve(image)
        image.onerror = () => required ? reject(new Error('小程序码加载失败')) : resolve(null)
        image.src = src
      })
    },

    drawPoster() {
      return new Promise((resolve, reject) => {
        this.createSelectorQuery().select('#historyPoster').fields({ node: true, size: true }).exec(async result => {
          const item = result && result[0]
          const detail = this.data.detail
          const players = this.data.players || []
          if (!item || !item.node || !detail) return reject(new Error('海报画布初始化失败'))

          try {
            const canvas = item.node
            const ctx = canvas.getContext('2d')
            const width = 750
            const model = buildHistoryPosterModel(detail, players, this.data.settlementPlan)
            const height = model.height
            const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
            const ratio = Math.min(info.pixelRatio || 2, 2)
            canvas.width = width * ratio
            canvas.height = height * ratio
            ctx.scale(ratio, ratio)

            const [qrImage, ...avatars] = await Promise.all([
              this.loadCanvasImage(canvas, POSTER_QR_PATH, true),
              ...model.players.map(player => this.loadCanvasImage(canvas, player.avatarUrl || '/images/avatar.png'))
            ])

            ctx.fillStyle = '#EEF5F0'
            ctx.fillRect(0, 0, width, height)
            ctx.fillStyle = '#FFFFFF'
            this.drawRoundedRect(ctx, 32, 32, width - 64, height - 64, 30)

            const gradient = ctx.createLinearGradient(48, 48, width - 48, 230)
            gradient.addColorStop(0, '#173C2B')
            gradient.addColorStop(1, '#248D52')
            ctx.fillStyle = gradient
            this.drawRoundedRect(ctx, 48, 48, width - 96, 182, 24)
            ctx.fillStyle = '#DDF2E5'
            ctx.font = '600 21px sans-serif'
            ctx.fillText('牌局战绩', 78, 88)
            ctx.fillStyle = '#FFFFFF'
            ctx.font = '700 40px sans-serif'
            ctx.fillText(this.fitText(ctx, model.roomName, 590), 78, 143)
            ctx.fillStyle = 'rgba(255,255,255,.78)'
            ctx.font = '22px sans-serif'
            ctx.fillText(this.fitText(ctx, [model.modeText, model.displayTime].filter(Boolean).join(' · '), 590), 78, 190)

            let y = 264
            if (model.me) {
              ctx.fillStyle = '#EEF9F2'
              this.drawRoundedRect(ctx, 60, y, width - 120, 86, 20)
              ctx.fillStyle = '#5D6B62'
              ctx.font = '22px sans-serif'
              ctx.fillText('我的成绩', 84, y + 34)
              ctx.fillStyle = '#173C2B'
              ctx.font = '700 31px sans-serif'
              ctx.fillText(`第 ${model.me.rank} 名`, 84, y + 68)
              ctx.fillStyle = model.me.score > 0 ? '#248D52' : (model.me.score < 0 ? '#D64545' : '#8E8E93')
              ctx.textAlign = 'right'
              ctx.font = '700 40px sans-serif'
              ctx.fillText(model.me.displayScore, width - 84, y + 58, 280)
              ctx.textAlign = 'left'
              y += 110
            }

            ctx.fillStyle = '#248D52'
            ctx.font = '700 25px sans-serif'
            ctx.fillText('结算计分', 72, y + 31)
            y += 54
            ctx.fillStyle = '#F6F8F6'
            const settlementHeight = (model.isBalanced ? 0 : 58) + (model.transferRows.length ? model.transferRows.length * 58 : 58) + 20
            this.drawRoundedRect(ctx, 60, y, width - 120, settlementHeight, 20)
            y += 20
            if (!model.isBalanced) {
              ctx.fillStyle = '#D64545'
              ctx.font = '22px sans-serif'
              ctx.fillText(`输赢合计相差 ${model.difference} 分，请检查积分`, 82, y + 35)
              y += 58
            }
            if (!model.transferRows.length) {
              ctx.fillStyle = '#8E8E93'
              ctx.font = '22px sans-serif'
              ctx.fillText('本局无需线下计分', 82, y + 35)
              y += 58
            } else {
              model.transferRows.forEach(row => {
                ctx.fillStyle = '#1C1C1E'
                ctx.font = '24px sans-serif'
                ctx.fillText(this.fitText(ctx, `${row.payer}  →  ${row.receiver}`, 400), 82, y + 36)
                ctx.fillStyle = '#248D52'
                ctx.textAlign = 'right'
                ctx.font = '700 25px sans-serif'
                ctx.fillText(`${row.amount} 分`, width - 82, y + 36, 180)
                ctx.textAlign = 'left'
                y += 58
              })
            }
            y += 22

            ctx.fillStyle = '#248D52'
            ctx.font = '700 25px sans-serif'
            ctx.fillText('最终排名', 72, y + 31)
            y += 54
            model.players.forEach((player, index) => {
              if (player.isMe) {
                ctx.fillStyle = '#EEF9F2'
                this.drawRoundedRect(ctx, 60, y, width - 120, 66, 16)
              }
              ctx.fillStyle = '#8E8E93'
              ctx.font = '23px sans-serif'
              ctx.fillText(`${player.rank}`, 78, y + 42)
              const avatar = avatars[index]
              ctx.fillStyle = '#E4E9E5'
              ctx.beginPath()
              ctx.arc(130, y + 33, 24, 0, Math.PI * 2)
              ctx.fill()
              if (avatar) {
                ctx.save()
                ctx.beginPath()
                ctx.arc(130, y + 33, 24, 0, Math.PI * 2)
                ctx.clip()
                ctx.drawImage(avatar, 106, y + 9, 48, 48)
                ctx.restore()
              }
              ctx.fillStyle = '#1C1C1E'
              ctx.font = `${player.isMe ? '700' : '500'} 25px sans-serif`
              const suffix = `${player.isMe ? '（我）' : ''}${player.isExited ? ' · 已退出' : ''}`
              ctx.fillText(this.fitText(ctx, `${player.nickname}${suffix}`, 380), 174, y + 42)
              ctx.fillStyle = player.score > 0 ? '#248D52' : (player.score < 0 ? '#D64545' : '#8E8E93')
              ctx.textAlign = 'right'
              ctx.font = '700 27px sans-serif'
              ctx.fillText(player.displayScore, width - 78, y + 42, 190)
              ctx.textAlign = 'left'
              y += 76
            })

            const qrSize = 220
            const qrX = (width - qrSize) / 2
            const qrY = height - 304
            ctx.fillStyle = '#F6F8F6'
            this.drawRoundedRect(ctx, 60, qrY - 20, width - 120, 246, 22)
            ctx.drawImage(qrImage, qrX, qrY, qrSize, qrSize)
            ctx.fillStyle = '#5D6B62'
            ctx.font = '22px sans-serif'
            ctx.textAlign = 'center'
            ctx.fillText('微信扫码打开小程序', width / 2, height - 50)
            ctx.textAlign = 'left'
            resolve({ canvas, width, height })
          } catch (error) {
            reject(error)
          }
        })
      })
    },

    createPosterFile() {
      return this.drawPoster().then(({ canvas, width, height }) => new Promise((resolve, reject) => {
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
      }))
    },

    sharePoster() {
      if (!this.data.detail || this.data.sharing || this.data.saving) return
      if (typeof wx.showShareImageMenu !== 'function') {
        wx.showModal({ title: '当前版本不支持', content: '请升级微信后直接分享图片，或先保存到相册。', showCancel: false })
        return
      }
      this.setData({ sharing: true })
      this.createPosterFile().then(filePath => new Promise((resolve, reject) => {
        wx.showShareImageMenu({ path: filePath, success: resolve, fail: reject })
      })).catch(error => {
        if (!String(error && error.errMsg).includes('cancel')) {
          wx.showToast({ title: error && error.message === '小程序码加载失败' ? '二维码加载失败' : '分享图片生成失败', icon: 'none' })
        }
      }).finally(() => this.setData({ sharing: false }))
    },

    savePoster() {
      if (!this.data.detail || this.data.saving || this.data.sharing) return
      this.setData({ saving: true })
      this.createPosterFile().then(filePath => new Promise((resolve, reject) => {
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
