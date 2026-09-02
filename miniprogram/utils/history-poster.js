const { safeInteger, limitDisplayText } = require('./display')

function buildHistoryPosterModel(detail, players, settlementPlan) {
  const rankedPlayers = (players || []).map((player, index) => {
    const score = safeInteger(player && player.score)
    return {
      ...player,
      nickname: limitDisplayText(player && player.nickname, 10, '玩家'),
      score,
      rank: index + 1,
      displayScore: score > 0 ? `+${score}` : `${score}`
    }
  })
  const me = rankedPlayers.find(player => player.isMe) || null
  const transferRows = []
  ;((settlementPlan && settlementPlan.groups) || []).forEach(group => {
    ;(group.transfers || []).forEach(transfer => {
      transferRows.push({
        key: transfer.key,
        payer: limitDisplayText(group.payer && group.payer.nickname, 10, '玩家'),
        receiver: limitDisplayText(transfer.receiver && transfer.receiver.nickname, 10, '玩家'),
        amount: safeInteger(transfer.amount)
      })
    })
  })
  const isBalanced = !settlementPlan || settlementPlan.isBalanced !== false
  const settlementContentHeight = (isBalanced ? 0 : 58) + (transferRows.length ? transferRows.length * 58 : 58)
  const height = Math.max(1120,
    280 + (me ? 110 : 0) + 72 + settlementContentHeight + 78 + rankedPlayers.length * 76 + 330)

  return {
    roomName: limitDisplayText(detail && detail.roomName, 20, '牌局战绩'),
    modeText: limitDisplayText(detail && detail.modeText, 12, ''),
    displayTime: limitDisplayText(detail && detail.displayTime, 24, ''),
    players: rankedPlayers,
    me,
    transferRows,
    isBalanced,
    difference: safeInteger(settlementPlan && settlementPlan.difference),
    height
  }
}

module.exports = { buildHistoryPosterModel }
