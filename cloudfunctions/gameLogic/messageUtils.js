const MAX_ROOM_MESSAGES = 100

function retainRecentMessages(existingMessages, newMessages, limit = MAX_ROOM_MESSAGES) {
  const existing = Array.isArray(existingMessages) ? existingMessages : []
  const incoming = Array.isArray(newMessages) ? newMessages : [newMessages]
  return [...existing, ...incoming.filter(Boolean)].slice(-limit)
}

module.exports = {
  MAX_ROOM_MESSAGES,
  retainRecentMessages
}
