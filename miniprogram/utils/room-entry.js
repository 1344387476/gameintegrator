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
  const roomId = decodeSafely(value).trim().toUpperCase()
  return /^[A-Z0-9]{6}$/.test(roomId) ? roomId : ''
}

function extractRoomId(value) {
  const decoded = decodeSafely(value)
  if (!decoded) return ''

  // 兼容页面参数 roomId=ABC123，以及 scene=roomId%3DABC123。
  const match = decoded.match(/(?:^|[?&#=])roomId=([^&#]+)/i)
  if (match && match[1]) return normalizeRoomId(match[1])

  // 普通二维码可以只保存六位房间号。
  return normalizeRoomId(decoded)
}

function parseScannedRoomId(scanResult) {
  const result = scanResult || {}
  return extractRoomId(result.path) || extractRoomId(result.result)
}

module.exports = {
  decodeSafely,
  extractRoomId,
  normalizeRoomId,
  parseScannedRoomId
}
