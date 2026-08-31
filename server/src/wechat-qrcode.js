const sharp = require('sharp')
const { ApiError } = require('./errors')

const unavailable = () => new ApiError(502, 'QRCODE_UNAVAILABLE', '微信二维码服务暂不可用，请稍后重试')

async function readBounded(response, maximum) {
  if (!response.ok || !response.body) {
    await response.body?.cancel()
    throw unavailable()
  }
  if (Number(response.headers.get('content-length')) > maximum) {
    await response.body.cancel()
    throw unavailable()
  }
  const chunks = []
  let size = 0
  for await (const chunk of response.body) {
    size += chunk.length
    if (size > maximum) throw unavailable()
    chunks.push(Buffer.from(chunk))
  }
  return Buffer.concat(chunks)
}

function createWechatQRCodeClient(config, fetchImpl = globalThis.fetch, now = Date.now) {
  let cached = null
  let pendingToken = null
  async function token() {
    if (cached && cached.expiresAt > now()) return cached.value
    if (!pendingToken) {
      pendingToken = (async () => {
        const response = await fetchImpl(new URL('https://api.weixin.qq.com/cgi-bin/stable_token'), {
          method: 'POST', headers: { 'content-type': 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(config.timeoutMs),
          body: JSON.stringify({ grant_type: 'client_credential', appid: config.appId, secret: config.appSecret, force_refresh: false })
        })
        const data = JSON.parse((await readBounded(response, 16384)).toString('utf8'))
        if (!data || (data.errcode !== undefined && data.errcode !== 0) || typeof data.access_token !== 'string' ||
          !/^[\x21-\x7e]{1,2048}$/u.test(data.access_token) || !Number.isInteger(data.expires_in) || data.expires_in < 60 || data.expires_in > 86400) throw unavailable()
        cached = { value: data.access_token, expiresAt: now() + (data.expires_in - 60) * 1000 }
        return cached.value
      })().finally(() => { pendingToken = null })
    }
    return pendingToken
  }
  return async scene => {
    if (typeof scene !== 'string' || !/^r[A-Za-z0-9_-]{22}$/u.test(scene)) throw new ApiError(400, 'INVALID_REQUEST', '邀请参数无效')
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        const credential = await token()
        const url = new URL('https://api.weixin.qq.com/wxa/getwxacodeunlimit')
        url.searchParams.set('access_token', credential)
        const response = await fetchImpl(url, { method: 'POST', headers: { 'content-type': 'application/json' },
          redirect: 'error', signal: AbortSignal.timeout(config.timeoutMs),
          body: JSON.stringify({ scene, page: 'pages/home/home', width: 400, env_version: 'release', check_path: true }) })
        const buffer = await readBounded(response, 1024 * 1024)
        if (buffer.toString('utf8', 0, 100).trimStart().startsWith('{')) {
          const error = JSON.parse(buffer.toString('utf8'))
          if (!attempt && [40001, 40014, 42001].includes(error.errcode)) {
            if (cached?.value === credential) cached = null
            continue
          }
          if ([45009, 45011].includes(error.errcode)) throw new ApiError(429, 'WECHAT_RATE_LIMITED', '微信二维码请求过于频繁，请稍后重试')
          throw unavailable()
        }
        const pipeline = sharp(buffer, { limitInputPixels: 1024 * 1024, failOn: 'warning' })
        const metadata = await pipeline.metadata()
        if (!['png', 'jpeg'].includes(metadata.format) || (metadata.pages || 1) !== 1 ||
          !metadata.width || !metadata.height || metadata.width > 1024 || metadata.height > 1024) throw unavailable()
        const image = await pipeline.png().toBuffer()
        if (image.length > 262144) throw unavailable()
        return image
      }
      throw unavailable()
    } catch (error) {
      // 网络URL包含token，token请求包含AppSecret，禁止传播上游原始错误或响应。
      if (error instanceof ApiError) throw error
      throw unavailable()
    }
  }
}

module.exports = { createWechatQRCodeClient }
