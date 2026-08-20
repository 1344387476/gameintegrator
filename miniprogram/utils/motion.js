const MOTION_LEVELS = Object.freeze({
  FULL: 'full',
  REDUCED: 'reduced'
})

const CLAIM_TIMELINE = Object.freeze({
  focus: 0,
  travel: 160,
  reward: 560,
  exit: 1040,
  complete: 1240
})

function resolveMotionLevel({ benchmarkLevel = -1, reduceMotion = false } = {}) {
  if (reduceMotion) return MOTION_LEVELS.REDUCED
  const level = Number(benchmarkLevel)
  return level > 0 && level <= 10 ? MOTION_LEVELS.REDUCED : MOTION_LEVELS.FULL
}

function getMotionLevel() {
  try {
    const device = wx.getDeviceInfo ? wx.getDeviceInfo() : wx.getSystemInfoSync()
    return resolveMotionLevel({ benchmarkLevel: device.benchmarkLevel })
  } catch (err) {
    return MOTION_LEVELS.FULL
  }
}

function getStaggerDelay(index, step = 45, max = 270) {
  const safeIndex = Math.max(0, Number(index) || 0)
  return Math.min(safeIndex * step, max)
}

module.exports = {
  CLAIM_TIMELINE,
  MOTION_LEVELS,
  getMotionLevel,
  getStaggerDelay,
  resolveMotionLevel
}
