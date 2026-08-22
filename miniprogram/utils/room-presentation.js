const SEAT_CLASSES = [
  'seat-top',
  'seat-bottom',
  'seat-left',
  'seat-right',
  'seat-top-left',
  'seat-top-right',
  'seat-bottom-right',
  'seat-bottom-left'
]

const RECORD_META = {
  transfer: { icon: '⇄', className: 'transfer' },
  bet: { icon: '↑', className: 'score' },
  allin: { icon: '★', className: 'score' },
  claim: { icon: '↓', className: 'claim' },
  pass: { icon: '—', className: 'pass' },
  create: { icon: '●', className: 'system' },
  join: { icon: '+', className: 'system' },
  leave: { icon: '−', className: 'system' },
  settle: { icon: '✓', className: 'system' }
}

function decorateMembers(members) {
  return (members || []).slice(0, SEAT_CLASSES.length).map((member, index) => ({
    ...member,
    seatClass: SEAT_CLASSES[index],
    seatIndex: index
  }))
}

function deriveLeader(members) {
  const players = members || []
  if (players.length === 0) {
    return { score: 0, leaders: [], overflow: 0, isTie: false }
  }

  const score = Math.max(...players.map(player => Number.isSafeInteger(player.score) ? player.score : 0))
  const allLeaders = players.filter(player => player.score === score)
  return {
    score,
    leaders: allLeaders.slice(0, 3),
    overflow: Math.max(0, allLeaders.length - 3),
    isTie: allLeaders.length > 1
  }
}

function decorateRecord(record) {
  const type = record && record.detail ? record.detail.type : 'other'
  const meta = RECORD_META[type] || { icon: '•', className: 'other' }
  return {
    ...record,
    eventIcon: meta.icon,
    eventClass: meta.className
  }
}

module.exports = {
  SEAT_CLASSES,
  decorateMembers,
  deriveLeader,
  decorateRecord
}
