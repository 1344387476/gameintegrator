const test = require('node:test')
const assert = require('node:assert/strict')
const { CLAIM_TIMELINE, calculateClaimPath, getStaggerDelay, resolveMotionLevel } = require('../miniprogram/utils/motion')

test('低性能设备自动使用精简动效', () => {
  assert.equal(resolveMotionLevel({ benchmarkLevel: 8 }), 'reduced')
  assert.equal(resolveMotionLevel({ benchmarkLevel: 20 }), 'full')
  assert.equal(resolveMotionLevel({ benchmarkLevel: -1 }), 'full')
  assert.equal(resolveMotionLevel({ benchmarkLevel: 20, reduceMotion: true }), 'reduced')
})

test('列表错峰时间有上限，避免长列表持续动画', () => {
  assert.equal(getStaggerDelay(0), 0)
  assert.equal(getStaggerDelay(3), 135)
  assert.equal(getStaggerDelay(20), 270)
})

test('收池时间线阶段严格递增', () => {
  const values = Object.values(CLAIM_TIMELINE)
  assert.deepEqual(values, values.slice().sort((a, b) => a - b))
  assert.ok(CLAIM_TIMELINE.complete <= 1300)
})

test('收池光点使用视口坐标生成弧线路径', () => {
  const path = calculateClaimPath(
    { left: 100, top: 200, width: 80, height: 40 },
    { left: 280, top: 80, width: 60, height: 100 }
  )
  assert.equal(path.startX, 140)
  assert.equal(path.startY, 220)
  assert.equal(path.deltaX, 170)
  assert.equal(path.deltaY, -90)
  assert.ok(Math.abs(path.midX - 91.8) < Number.EPSILON * 100)
  assert.ok(Math.abs(path.midY + 65.4) < Number.EPSILON * 100)
  assert.equal(calculateClaimPath(null, {}), null)
})
