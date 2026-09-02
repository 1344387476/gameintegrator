const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { buildHistoryPosterModel } = require('../miniprogram/utils/history-poster')

test('战绩海报保留完整排名并标记当前用户名次', () => {
  const model = buildHistoryPosterModel({ roomName: '周末牌局', modeText: '普通模式', displayTime: '2026.09.02 14:00' }, [
    { nickname: '玩家A', score: 20 },
    { nickname: '玩家B', score: 0, isMe: true },
    { nickname: '玩家C', score: -20, isExited: true }
  ], { groups: [], isBalanced: true, difference: 0 })

  assert.equal(model.players.length, 3)
  assert.deepEqual(model.players.map(player => player.rank), [1, 2, 3])
  assert.equal(model.me.rank, 2)
  assert.equal(model.me.displayScore, '0')
})

test('战绩海报展平结算方案并为长内容扩展高度', () => {
  const players = Array.from({ length: 8 }, (_, index) => ({ nickname: `玩家${index + 1}`, score: 7 - index }))
  const groups = [{
    payer: { nickname: '付款人' },
    transfers: Array.from({ length: 7 }, (_, index) => ({
      key: `transfer-${index}`,
      amount: index + 1,
      receiver: { nickname: `收款人${index + 1}` }
    }))
  }]
  const compact = buildHistoryPosterModel({}, players.slice(0, 1), { groups: [], isBalanced: true, difference: 0 })
  const expanded = buildHistoryPosterModel({}, players, { groups, isBalanced: false, difference: 3 })

  assert.equal(expanded.transferRows.length, 7)
  assert.deepEqual(expanded.transferRows[0], {
    key: 'transfer-0', payer: '付款人', receiver: '收款人1', amount: 1
  })
  assert.equal(expanded.isBalanced, false)
  assert.equal(expanded.difference, 3)
  assert.ok(expanded.height > compact.height)
})

test('战绩分享按钮只调起图片分享且海报使用本地小程序码', () => {
  const componentPath = path.join(__dirname, '../miniprogram/components/history-detail/history-detail.js')
  const templatePath = path.join(__dirname, '../miniprogram/components/history-detail/history-detail.wxml')
  const component = fs.readFileSync(componentPath, 'utf8')
  const template = fs.readFileSync(templatePath, 'utf8')

  assert.match(component, /const POSTER_QR_PATH = '\/images\/qr\.jpg'/)
  assert.match(component, /wx\.showShareImageMenu\(\{ path: filePath/)
  assert.match(template, /bindtap="sharePoster"/)
  assert.doesNotMatch(template, /open-type="share"/)
})
