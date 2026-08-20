const test = require('node:test')
const assert = require('node:assert/strict')
const { CLAIM_TIMELINE, getStaggerDelay, resolveMotionLevel } = require('../miniprogram/utils/motion')

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
