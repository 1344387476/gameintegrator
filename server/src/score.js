const { ApiError } = require('./errors')

const MAX = BigInt(Number.MAX_SAFE_INTEGER)
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
const FIELDS = {
  TRANSFER: ['toUserId', 'amount'], BATCH_TRANSFER: ['transferList'], BET: ['amount'],
  BASE_BET: [], ALLIN: [], CLAIM: [], SET_BASE_BET: ['amount']
}

function invalid() { throw new ApiError(400, 'INVALID_REQUEST', '计分参数无效') }
function exactObject(value, fields) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== fields.length || !fields.every(key => Object.hasOwn(value, key))) invalid()
}
function positive(value) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) throw new ApiError(400, 'INVALID_AMOUNT', '金额必须是正安全整数')
  return value
}
function target(value) { if (typeof value !== 'string' || !UUID.test(value)) invalid(); return value }

function normalizeScoreCommand(input) {
  exactObject(input, ['operationId', 'action', 'payload'])
  if (typeof input.operationId !== 'string' || !/^[A-Za-z0-9_-]{8,80}$/u.test(input.operationId) || typeof input.action !== 'string' || !Object.hasOwn(FIELDS, input.action)) invalid()
  exactObject(input.payload, FIELDS[input.action])
  const payload = {}
  if (Object.hasOwn(input.payload, 'toUserId')) payload.toUserId = target(input.payload.toUserId)
  if (Object.hasOwn(input.payload, 'amount')) payload.amount = positive(input.payload.amount)
  if (input.action === 'BATCH_TRANSFER') {
    const list = input.payload.transferList
    if (!Array.isArray(list) || list.length < 1 || list.length > 7) invalid()
    payload.transferList = list.map(item => {
      exactObject(item, ['toUserId', 'amount'])
      return { toUserId: target(item.toUserId), amount: positive(item.amount) }
    }).sort((a, b) => a.toUserId < b.toUserId ? -1 : a.toUserId > b.toUserId ? 1 : 0)
    if (new Set(payload.transferList.map(item => item.toUserId)).size !== list.length) invalid()
    if (payload.transferList.reduce((sum, item) => sum + BigInt(item.amount), 0n) > MAX) throw new ApiError(400, 'INVALID_AMOUNT', '批量总金额超过安全整数上限')
  }
  return { operationId: input.operationId, action: input.action, payload }
}

function integer(value) {
  if ((typeof value !== 'string' || !/^-?\d+$/u.test(value)) && !Number.isSafeInteger(value)) throw new ApiError(409, 'LEDGER_INVALID', '账本数据异常')
  const result = BigInt(value)
  if (result < -MAX || result > MAX) throw new ApiError(409, 'LEDGER_INVALID', '账本数据异常')
  return result
}
function inRange(value) {
  if (value < -MAX || value > MAX) throw new ApiError(409, 'SCORE_OVERFLOW', '操作结果超过安全整数上限')
  return value
}

function assertBalanced(room, members) {
  const pot = integer(room.pot)
  if (pot < 0n || members.reduce((sum, member) => sum + integer(member.score), pot) !== 0n) {
    throw new ApiError(409, 'LEDGER_UNBALANCED', '账本不平，请联系维护者核查')
  }
}

function calculateScore(room, members, userId, { action, payload }) {
  const actor = members.find(member => member.user_id === userId && !member.is_exited)
  if (!actor) throw new ApiError(403, 'ROOM_MEMBER_REQUIRED', '只有在房玩家可以计分')
  const normal = action === 'TRANSFER' || action === 'BATCH_TRANSFER'
  if (room.mode !== (normal ? 'normal' : 'bet')) throw new ApiError(409, 'WRONG_ROOM_MODE', '当前房间模式不支持此操作')
  const scores = new Map(members.map(member => [member.user_id, integer(member.score)]))
  const before = new Map(scores)
  let pot = integer(room.pot)
  if (pot < 0n) throw new ApiError(409, 'LEDGER_INVALID', '奖池数据异常')
  const total = values => [...values.values()].reduce((sum, score) => sum + score, 0n)
  if (total(scores) + pot !== 0n) throw new ApiError(409, 'LEDGER_UNBALANCED', '账本不平，请联系维护者核查')
  let baseBetValue = room.base_bet_value === null ? null : integer(room.base_bet_value)
  if (baseBetValue !== null && baseBetValue <= 0n) throw new ApiError(409, 'LEDGER_INVALID', '底注数据异常')
  let amount
  const actorScore = scores.get(userId)
  if (normal) {
    const transfers = action === 'TRANSFER' ? [payload] : payload.transferList
    amount = transfers.reduce((sum, item) => sum + BigInt(item.amount), 0n)
    for (const item of transfers) {
      if (item.toUserId === userId) throw new ApiError(400, 'SELF_TRANSFER', '不能向自己转分')
      if (!members.some(member => member.user_id === item.toUserId && !member.is_exited)) throw new ApiError(400, 'INVALID_RECIPIENT', '接收者必须是在房玩家')
      scores.set(item.toUserId, inRange(scores.get(item.toUserId) + BigInt(item.amount)))
    }
    scores.set(userId, inRange(actorScore - amount))
  } else if (action === 'SET_BASE_BET') {
    if (room.owner_user_id !== userId) throw new ApiError(403, 'ROOM_OWNER_REQUIRED', '只有房主可以设置底注')
    amount = BigInt(payload.amount)
    baseBetValue = amount
  } else if (action === 'CLAIM') {
    if (pot === 0n) throw new ApiError(409, 'EMPTY_POT', '奖池为空')
    amount = pot
    scores.set(userId, inRange(actorScore + amount))
    pot = 0n
  } else {
    if (action === 'BASE_BET') {
      if (baseBetValue === null) throw new ApiError(409, 'BASE_BET_NOT_SET', '请房主先设置底注')
      amount = baseBetValue
    } else if (action === 'ALLIN') {
      if (actorScore <= 0n) throw new ApiError(409, 'ALLIN_NOT_AVAILABLE', '只有正积分可以All-in')
      amount = actorScore
    } else amount = BigInt(payload.amount)
    scores.set(userId, inRange(actorScore - amount))
    pot = inRange(pot + amount)
  }
  if (total(scores) + pot !== 0n) throw new ApiError(409, 'LEDGER_UNBALANCED', '账本不平，请联系维护者核查')
  const changes = members.filter(member => scores.get(member.user_id) !== before.get(member.user_id))
    .map(member => ({ member, before: before.get(member.user_id), after: scores.get(member.user_id) }))
  return { actor, amount, pot, baseBetValue, changes, deposit: ['BET', 'BASE_BET', 'ALLIN'].includes(action) }
}

module.exports = { normalizeScoreCommand, calculateScore, assertBalanced, UUID }
