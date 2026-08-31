function decodeSafely(value) {
  let decoded = String(value || '').trim()

  // 小程序码的 scene 在 scanCode 返回值中可能被编码一到两次。
  for (let i = 0; i < 2; i += 1) {
    try {
      const next = decodeURIComponent(decoded)
      if (next === decoded) break
      decoded = next
    } catch (error) {
      break
    }
  }

  return decoded
}

function normalizeRoomId(value) {
  const roomId = decodeSafely(value).trim()
  if (/^[A-Z0-9]{6}$/i.test(roomId)) return roomId.toUpperCase()
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(roomId)) return roomId.toLowerCase()
  return ''
}

function normalizeScene(value) {
  const scene = decodeSafely(value).trim()
  return /^r[A-Za-z0-9_-]{22}$/.test(scene) ? scene : ''
}

function extractInvite(value) {
  const decoded = decodeSafely(value)
  if (!decoded) return ''

  const sceneMatch = decoded.match(/(?:^|[?&#])scene=([^&#]+)/i)
  if (sceneMatch && sceneMatch[1]) {
    const nested = decodeSafely(sceneMatch[1])
    return normalizeScene(nested) || extractInvite(nested)
  }
  const roomMatch = decoded.match(/(?:^|[?&#])roomId=([^&#]+)/i)
  if (roomMatch && roomMatch[1]) return normalizeRoomId(roomMatch[1])
  return normalizeScene(decoded) || normalizeRoomId(decoded)
}

function extractRoomId(value) {
  return extractInvite(value)
}

function parseScannedRoomId(scanResult) {
  const result = scanResult || {}
  return extractRoomId(result.path) || extractRoomId(result.result)
}

module.exports = {
  decodeSafely,
  extractInvite,
  extractRoomId,
  normalizeRoomId,
  parseScannedRoomId
}
