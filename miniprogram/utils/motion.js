const MOTION_LEVELS = Object.freeze({
  FULL: 'full',
  REDUCED: 'reduced'
})

const CLAIM_TIMELINE = Object.freeze({
  focus: 0,
  travel: 140,
  reward: 620,
  exit: 1080,
  complete: 1280
})

function calculateClaimPath(poolRect, targetRect, arcLift = 24) {
  if (!poolRect || !targetRect) return null
  const values = [
    poolRect.left, poolRect.top, poolRect.width, poolRect.height,
    targetRect.left, targetRect.top, targetRect.width, targetRect.height
  ]
  if (!values.every(Number.isFinite)) return null

  const startX = poolRect.left + poolRect.width / 2
  const startY = poolRect.top + poolRect.height / 2
  const deltaX = targetRect.left + targetRect.width / 2 - startX
  const deltaY = targetRect.top + targetRect.height / 2 - startY

  return {
    startX,
    startY,
    deltaX,
    deltaY,
    midX: deltaX * 0.54,
    midY: deltaY * 0.46 - Math.max(0, Number(arcLift) || 0)
  }
}

function resolveMotionLevel({ benchmarkLevel = -1, reduceMotion = false } = {}) {
  if (reduceMotion) return MOTION_LEVELS.REDUCED
  const level = Number(benchmarkLevel)
  return level > 0 && level <= 10 ? MOTION_LEVELS.REDUCED : MOTION_LEVELS.FULL
}

function getMotionLevel() {
  try {
    const device = wx.getDeviceInfo ? wx.getDeviceInfo() : wx.getSystemInfoSync()
    return resolveMotionLevel({ benchmarkLevel: device.benchmarkLevel })
  } catch {
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
  calculateClaimPath,
  getMotionLevel,
  getStaggerDelay,
  resolveMotionLevel
}
