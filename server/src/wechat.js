const { ApiError } = require('./errors')

function createWechatClient(config, fetchImpl = globalThis.fetch) {
  return async function exchangeCode(code) {
    const url = new URL('https://api.weixin.qq.com/sns/jscode2session')
    url.search = new URLSearchParams({ appid: config.appId, secret: config.appSecret, js_code: code, grant_type: 'authorization_code' }).toString()
    let data
    try {
      const response = await fetchImpl(url, { signal: AbortSignal.timeout(config.timeoutMs), redirect: 'error' })
      if (!response.ok) throw new Error('upstream HTTP failure')
      data = await response.json()
    } catch {
      // URL中包含AppSecret；不传播原始网络错误、URL或微信响应正文。
      throw new ApiError(502, 'WECHAT_UNAVAILABLE', '微信登录服务暂不可用，请稍后重试')
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new ApiError(502, 'WECHAT_UNAVAILABLE', '微信登录服务返回异常')
    }
    if (data.errcode !== undefined && data.errcode !== 0) {
      if ([40029, 40163].includes(data.errcode)) throw new ApiError(401, 'WECHAT_CODE_INVALID', '微信登录凭证已失效，请重新登录')
      if (data.errcode === 45011) throw new ApiError(429, 'WECHAT_RATE_LIMITED', '微信登录请求过于频繁，请稍后重试')
      throw new ApiError(502, 'WECHAT_UNAVAILABLE', '微信登录服务暂不可用，请稍后重试')
    }
    if (typeof data.openid !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/u.test(data.openid) || typeof data.session_key !== 'string' || !data.session_key || data.session_key.length > 256) {
      throw new ApiError(502, 'WECHAT_UNAVAILABLE', '微信登录服务返回异常')
    }
    // 此阶段不需要解密微信数据，不持久化或返回session_key。
    return { openid: data.openid }
  }
}

module.exports = { createWechatClient }
