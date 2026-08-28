class ApiError extends Error {
  constructor(statusCode, code, message) {
    super(message)
    this.statusCode = statusCode
    this.code = code
  }
}

function safeErrorCode(error) {
  return typeof error?.code === 'string' && /^[A-Z0-9_]{1,48}$/u.test(error.code) ? error.code : 'INTERNAL_ERROR'
}

module.exports = { ApiError, safeErrorCode }
