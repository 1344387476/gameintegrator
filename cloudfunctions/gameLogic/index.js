const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command
const SUPPORTED_ACTIONS = new Set(['TRANSFER', 'BATCH_TRANSFER', 'BET', 'ALLIN', 'CLAIM', 'PASS'])
const MAX_TRANSACTION_RETRIES = 3
const MAX_RECENT_OPERATION_IDS = 50

class BusinessError extends Error {}

function assert(condition, message) {
  if (!condition) throw new BusinessError(message)
}

function assertPositiveInteger(value, fieldName = '积分') {
  assert(typeof value === 'number' && Number.isSafeInteger(value) && value > 0, `${fieldName}必须是正整数`)
  return value
}

function getScore(player) {
  const score = player.score === undefined ? 0 : player.score
  assert(Number.isSafeInteger(score), '房间积分数据异常，请联系房主')
  return score
}

function safeAdd(value, delta) {
  const result = value + delta
  assert(Number.isSafeInteger(result), '积分超出允许范围')
  return result
}

function assertOperationId(operationId) {
  assert(typeof operationId === 'string' && operationId.length >= 8 && operationId.length <= 80, '操作标识无效，请重试')
  return operationId
}

function buildMessage({ sender, content, messageType, toPlayer, operationId, amount, potAfter }) {
  return {
    operationId,
    fromOpenid: sender.openid,
    fromNickname: sender.nickname || '',
    fromAvatarFileID: sender.avatarFileID || '',
    content,
    messageType,
    toOpenid: toPlayer ? toPlayer.openid : '',
    toNickname: toPlayer ? (toPlayer.nickname || '') : '',
    toAvatarFileID: toPlayer ? (toPlayer.avatarFileID || '') : '',
    timestamp: db.serverDate(),
    ...(Number.isSafeInteger(amount) ? { amount } : {}),
    ...(Number.isSafeInteger(potAfter) ? { potAfter } : {})
  }
}

function prepareOperation({ action, payload, room, openid, operationId }) {
  const players = (room.players || []).map(player => ({ ...player }))
  const sender = players.find(player => player.openid === openid && !player.isExited)
  assert(sender, '您不在该房间中或已退出')
  assert(room.status === 'active', '房间已结束，不能继续操作')

  const updates = { players }
  const messages = []
  const findActivePlayer = (targetOpenid) => {
    const player = players.find(item => item.openid === targetOpenid && !item.isExited)
    assert(player, '接收玩家不在房间中')
    return player
  }

  if (action === 'TRANSFER') {
    assert(room.mode === 'normal', '普通转账只能在普通模式使用')
    const amount = assertPositiveInteger(payload.amount)
    assert(typeof payload.toOpenid === 'string' && payload.toOpenid, '请选择接收玩家')
    assert(payload.toOpenid !== openid, '不能给自己转账')
    const receiver = findActivePlayer(payload.toOpenid)
    sender.score = safeAdd(getScore(sender), -amount)
    receiver.score = safeAdd(getScore(receiver), amount)
    messages.push(buildMessage({ sender, content: `转给 ${receiver.nickname || '玩家'} ${amount} 分`, messageType: 'transfer', toPlayer: receiver, operationId, amount }))
  } else if (action === 'BATCH_TRANSFER') {
    assert(room.mode === 'normal', '批量转账只能在普通模式使用')
    assert(Array.isArray(payload.transferList) && payload.transferList.length > 0, '请至少选择一位接收玩家')
    assert(payload.transferList.length <= 7, '接收玩家数量过多')
    const recipientIds = new Set()
    let totalAmount = 0
    for (const item of payload.transferList) {
      assert(item && typeof item.openid === 'string' && item.openid, '接收玩家无效')
      assert(item.openid !== openid, '不能给自己转账')
      assert(!recipientIds.has(item.openid), '接收玩家不能重复')
      recipientIds.add(item.openid)
      const amount = assertPositiveInteger(item.amount)
      const receiver = findActivePlayer(item.openid)
      receiver.score = safeAdd(getScore(receiver), amount)
      totalAmount = safeAdd(totalAmount, amount)
      messages.push(buildMessage({ sender, content: `转给 ${receiver.nickname || '玩家'} ${amount} 分`, messageType: 'transfer', toPlayer: receiver, operationId, amount }))
    }
    sender.score = safeAdd(getScore(sender), -totalAmount)
  } else if (action === 'BET' || action === 'ALLIN') {
    assert(room.mode === 'bet', '下注操作只能在下注模式使用')
    const amount = assertPositiveInteger(payload.amount)
    if (action === 'ALLIN') {
      const allInValue = room.allInVal
      assert(Number.isSafeInteger(allInValue) && allInValue > 0, '房主尚未设置 All-in 值')
      assert(amount === allInValue, 'All-in 金额与房间设置不一致')
    }
    const pot = room.pot === undefined ? 0 : room.pot
    assert(Number.isSafeInteger(pot) && pot >= 0, '奖池数据异常，请联系房主')
    sender.score = safeAdd(getScore(sender), -amount)
    sender.lastDepositAmount = amount
    sender.lastDepositTime = new Date().toISOString()
    updates.pot = safeAdd(pot, amount)
    messages.push(buildMessage({ sender, content: `${action === 'ALLIN' ? 'All-in' : '下注'} ${amount} 分`, messageType: action === 'ALLIN' ? 'allin' : 'bet', operationId, amount, potAfter: updates.pot }))
  } else if (action === 'CLAIM') {
    assert(room.mode === 'bet', '领取奖池只能在下注模式使用')
    const pot = room.pot === undefined ? 0 : room.pot
    assert(Number.isSafeInteger(pot) && pot > 0, '奖池为空或数据异常')
    sender.score = safeAdd(getScore(sender), pot)
    updates.pot = 0
    messages.push(buildMessage({ sender, content: `收走了奖池 ${pot} 分`, messageType: 'claim', toPlayer: sender, operationId, amount: pot, potAfter: 0 }))
  } else if (action === 'PASS') {
    assert(room.mode === 'bet', '跳过回合只能在下注模式使用')
    messages.push(buildMessage({ sender, content: `${sender.nickname || '玩家'} 跳过了这回合`, messageType: 'pass', operationId }))
  }

  return { updates, messages }
}

function isDuplicateOperation(room, operationId) {
  return Array.isArray(room.recentOperationIds) && room.recentOperationIds.includes(operationId)
}

function waitBeforeRetry(attempt) {
  const delay = 40 * (attempt + 1) + Math.floor(Math.random() * 80)
  return new Promise(resolve => setTimeout(resolve, delay))
}

async function executeOperation({ action, payload, openid, operationId }) {
  let lastError
  for (let attempt = 0; attempt < MAX_TRANSACTION_RETRIES; attempt += 1) {
    let transaction
    try {
      transaction = await db.startTransaction()
      const roomRes = await transaction.collection('rooms').doc(payload.roomId).get()
      const room = roomRes.data
      assert(room, '房间已不存在')
      if (isDuplicateOperation(room, operationId)) {
        await transaction.rollback()
        return { success: true, duplicated: true }
      }

      const { updates, messages } = prepareOperation({ action, payload, room, openid, operationId })
      const existingOperationIds = Array.isArray(room.recentOperationIds) ? room.recentOperationIds : []
      updates.lastActiveTime = db.serverDate()
      updates.recentOperationIds = [...existingOperationIds, operationId].slice(-MAX_RECENT_OPERATION_IDS)

      if (messages.length > 0) {
        const messageRef = transaction.collection('messages').doc(payload.roomId)
        const messageRes = await messageRef.get().catch(() => null)
        await transaction.collection('rooms').doc(payload.roomId).update({ data: updates })
        if (messageRes && messageRes.data) {
          await messageRef.update({ data: { messages: _.push(...messages) } })
        } else {
          await messageRef.set({ data: { messages, createdAt: db.serverDate() } })
        }
      } else {
        await transaction.collection('rooms').doc(payload.roomId).update({ data: updates })
      }
      await transaction.commit()
      return { success: true }
    } catch (error) {
      lastError = error
      if (transaction) {
        try { await transaction.rollback() } catch (rollbackError) {}
      }
      if (error instanceof BusinessError) throw error
      if (attempt < MAX_TRANSACTION_RETRIES - 1) await waitBeforeRetry(attempt)
    }
  }
  throw lastError || new Error('操作失败，请重试')
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const { action, payload = {} } = event || {}
  try {
    assert(SUPPORTED_ACTIONS.has(action), '不支持的操作')
    assert(payload && typeof payload === 'object', '请求参数无效')
    assert(typeof payload.roomId === 'string' && payload.roomId.trim(), '房间ID无效')
    const operationId = assertOperationId(payload.operationId)
    return await executeOperation({ action, payload, openid: OPENID, operationId })
  } catch (error) {
    console.error('gameLogic 操作失败:', error)
    return { success: false, msg: error.message || '操作失败，请重试' }
  }
}
