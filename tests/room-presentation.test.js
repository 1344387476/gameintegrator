const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const {
  SEAT_CLASSES,
  decorateMembers,
  deriveLeader,
  decorateRecord
} = require('../miniprogram/utils/room-presentation')

test('1 到 8 人按固定方位补齐座位', () => {
  for (let count = 1; count <= 8; count += 1) {
    const members = Array.from({ length: count }, (_, index) => ({ openid: `p${index}` }))
    assert.deepEqual(
      decorateMembers(members).map(member => member.seatClass),
      SEAT_CLASSES.slice(0, count)
    )
  }
})

test('退出玩家保留座位且参与最高分计算', () => {
  const members = decorateMembers([
    { openid: 'a', score: 20, isExited: true },
    { openid: 'b', score: 10, isExited: false }
  ])
  const leader = deriveLeader(members)

  assert.equal(members[0].seatClass, 'seat-top')
  assert.equal(members[0].isExited, true)
  assert.equal(leader.leaders[0].openid, 'a')
  assert.equal(leader.score, 20)
})

test('并列领先最多展示 3 人并计算额外人数', () => {
  const leader = deriveLeader(Array.from({ length: 8 }, (_, index) => ({
    openid: `p${index}`,
    score: index < 5 ? 9 : -15
  })))

  assert.equal(leader.isTie, true)
  assert.equal(leader.leaders.length, 3)
  assert.equal(leader.overflow, 2)
  assert.equal(leader.score, 9)
})

test('流水类型映射为稳定的时间线样式', () => {
  assert.deepEqual(
    decorateRecord({ detail: { type: 'transfer' } }),
    { detail: { type: 'transfer' }, eventIcon: '⇄', eventClass: 'transfer' }
  )
  assert.equal(decorateRecord({ detail: { type: 'unknown' } }).eventClass, 'other')
})

test('Room 页使用纵向围桌和独立积分流水', () => {
  const wxml = fs.readFileSync(
    path.join(__dirname, '../miniprogram/pages/room/room.wxml'),
    'utf8'
  )

  assert.match(wxml, /class="scoreboard-section"/)
  assert.match(wxml, /class="room-custom-title"[\s\S]*?\{\{room\.roomName\}\}/)
  assert.match(wxml, /class="table-player \{\{item\.seatClass\}\}/)
  assert.match(wxml, />积分流水</)
  assert.match(wxml, /class="timeline-item/)
  assert.doesNotMatch(wxml, /class="left-section"/)
})

test('围桌使用宽度驱动的固定比例，不被机型高度拉伸', () => {
  const wxss = fs.readFileSync(
    path.join(__dirname, '../miniprogram/pages/room/room.wxss'),
    'utf8'
  )

  assert.match(wxss, /\.table-stage-shell\s*\{[^}]*align-items:\s*center/)
  assert.match(wxss, /\.table-stage\s*\{[^}]*height:\s*0;[^}]*padding-bottom:\s*82%/)
  assert.doesNotMatch(wxss, /\.table-stage\s*\{[^}]*min-height:/)
})

test('牌桌表面保持适合纵向八人座位的椭圆形', () => {
  const wxss = fs.readFileSync(
    path.join(__dirname, '../miniprogram/pages/room/room.wxss'),
    'utf8'
  )

  assert.match(wxss, /\.table-surface\s*\{[^}]*top:\s*13%;[^}]*right:\s*9%;[^}]*bottom:\s*10%;[^}]*left:\s*9%;[^}]*border-radius:\s*48%/)
})

test('结算金额显示在箭头右边并为长数字保留横向空间', () => {
  const wxml = fs.readFileSync(
    path.join(__dirname, '../miniprogram/components/history-detail/history-detail.wxml'),
    'utf8'
  )
  const wxss = fs.readFileSync(
    path.join(__dirname, '../miniprogram/components/history-detail/history-detail.wxss'),
    'utf8'
  )

  assert.match(wxml, /settlement-arrow[\s\S]*settlement-arrow-symbol[\s\S]*settlement-amount/)
  assert.match(wxss, /\.settlement-arrow\s*\{[^}]*align-items:\s*center;[^}]*gap:/)
  assert.match(wxss, /\.settlement-arrow\s*\{[^}]*justify-content:\s*center/)
  assert.doesNotMatch(wxss, /\.settlement-arrow\s*\{[^}]*flex-direction:\s*column/)
  assert.match(wxss, /\.settlement-target\s*\{[^}]*flex:\s*1 1 100%/)
})
