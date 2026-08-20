function historyPlayer(player) {
  const nickname = [...String(player.nickname || '玩家').trim()].slice(0, 10).join('') || '玩家'
  return { openid: player.openid, nickname, avatarFileID: player.avatarFileID || '', score: Number.isSafeInteger(player.score) ? player.score : 0, isExited: Boolean(player.isExited) }
}

function normalizeDisplayText(value, fieldName, maxLength) {
  if (typeof value !== 'string') throw new Error(`${fieldName}格式不正确`)
  const normalized = value.trim().replace(/\s+/g, ' ')
  if (!normalized) throw new Error(`${fieldName}不能为空`)
  if ([...normalized].length > maxLength) throw new Error(`${fieldName}不能超过${maxLength}个字符`)
  return normalized
}

function normalizeIdentifier(value, fieldName = '标识', maxLength = 128) {
  if (typeof value !== 'string' || !value || value.length > maxLength || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error(`${fieldName}无效`)
  }
  return value
}

function assertSettleAllowed(room, openid) {
  if (!room) throw new Error('房间不存在')
  if (room.owner !== openid) throw new Error('权限不足')
  if (room.status !== 'active') throw new Error('本局已经结算，请勿重复操作')
  if (room.mode === 'bet' && Number(room.pot) > 0) throw new Error('奖池中还有积分，请先收取')
}

module.exports = { historyPlayer, normalizeDisplayText, normalizeIdentifier, assertSettleAllowed }
