function limitDisplayText(value, maxLength, fallback = '') {
  const normalized = String(value === undefined || value === null ? '' : value).trim().replace(/\s+/g, ' ')
  if (!normalized) return fallback
  return [...normalized].slice(0, maxLength).join('')
}

function safeInteger(value, fallback = 0) {
  return Number.isSafeInteger(value) ? value : fallback
}

module.exports = { limitDisplayText, safeInteger }
