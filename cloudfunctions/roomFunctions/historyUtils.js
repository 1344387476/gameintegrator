function messageAmount(message) {
  if (Number.isSafeInteger(message && message.amount) && message.amount > 0) return message.amount
  const match = String((message && message.content) || '').match(/(\d+)\s*分/)
  const amount = match ? Number(match[1]) : 0
  return Number.isSafeInteger(amount) && amount > 0 ? amount : 0
}

function buildBetSummary(messages) {
  const summary = { totalBet: 0, totalClaimed: 0, claimEvents: [] }
  ;(messages || []).forEach(message => {
    const amount = messageAmount(message)
    if (!amount) return
    if (message.messageType === 'bet' || message.messageType === 'allin') summary.totalBet += amount
    if (message.messageType === 'claim') {
      summary.totalClaimed += amount
      summary.claimEvents.push({ operationId: message.operationId || '', openid: message.fromOpenid || '', nickname: message.fromNickname || '玩家', amount, timestamp: message.timestamp || null })
    }
  })
  return summary
}

function historyPlayer(player) {
  return { openid: player.openid, nickname: player.nickname || '玩家', avatarFileID: player.avatarFileID || '', score: Number.isSafeInteger(player.score) ? player.score : 0, isExited: Boolean(player.isExited) }
}

module.exports = { messageAmount, buildBetSummary, historyPlayer }
