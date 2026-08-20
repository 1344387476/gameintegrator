const { limitDisplayText, safeInteger } = require('./display')

function normalizePlayer(player, index) {
  const score = safeInteger(player && player.score)
  return {
    openid: player && player.openid ? player.openid : `player-${index}`,
    nickname: limitDisplayText(player && (player.name || player.nickname), 10, '玩家'),
    avatarUrl: (player && player.avatarUrl) || '/images/avatar.png',
    score,
    order: index
  }
}

function buildSettlementPlan(players) {
  const normalized = (players || []).map(normalizePlayer)
  const debtors = normalized
    .filter(player => player.score < 0)
    .map(player => ({ ...player, remaining: -player.score }))
  const creditors = normalized
    .filter(player => player.score > 0)
    .map(player => ({ ...player, remaining: player.score }))
  const transfers = []

  const addTransfer = (debtor, creditor, amount) => {
    if (amount <= 0) return
    transfers.push({
      key: `${debtor.openid}-${creditor.openid}-${transfers.length}`,
      amount,
      from: debtor,
      to: creditor
    })
    debtor.remaining -= amount
    creditor.remaining -= amount
  }

  // 先消掉金额完全相同的输家和赢家，减少实际转账笔数。
  debtors.forEach(debtor => {
    const exact = creditors.find(creditor => creditor.remaining === debtor.remaining && creditor.remaining > 0)
    if (exact) addTransfer(debtor, exact, debtor.remaining)
  })

  // 剩余收款人从小额到大额依次结清，结果稳定，也更容易当场核对。
  debtors.forEach(debtor => {
    while (debtor.remaining > 0) {
      const creditor = creditors
        .filter(item => item.remaining > 0)
        .sort((a, b) => a.remaining - b.remaining || a.order - b.order)[0]
      if (!creditor) break
      addTransfer(debtor, creditor, Math.min(debtor.remaining, creditor.remaining))
    }
  })

  const groups = debtors.map(debtor => ({
    key: debtor.openid,
    payer: debtor,
    transfers: transfers.filter(item => item.from.openid === debtor.openid).map(item => ({
      key: item.key,
      amount: item.amount,
      receiver: item.to
    }))
  })).filter(group => group.transfers.length > 0)

  const totalLoss = debtors.reduce((sum, player) => sum + (-player.score), 0)
  const totalWin = creditors.reduce((sum, player) => sum + player.score, 0)
  return {
    groups,
    isBalanced: totalLoss === totalWin,
    difference: Math.abs(totalLoss - totalWin),
    hasTransfers: transfers.length > 0
  }
}

module.exports = { buildSettlementPlan }
