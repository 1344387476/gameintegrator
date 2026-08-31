const test = require('node:test')
const assert = require('node:assert/strict')
const { createWechatClient } = require('../src/wechat')
const { testConfig } = require('../test-support/config')
const { createWechatQRCodeClient } = require('../src/wechat-qrcode')
const { roomScene } = require('../src/qrcode')
const sharp = require('sharp')

test('微信登录只调用固定服务端地址，正确发送code，结果仅保留openid', async () => {
  const config = testConfig().wechat
  let calls = 0
  const exchange = createWechatClient(config, async (url, options) => {
    calls++
    assert.equal(url.origin, 'https://api.weixin.qq.com')
    assert.equal(url.pathname, '/sns/jscode2session')
    assert.equal(url.searchParams.get('appid'), config.appId)
    assert.equal(url.searchParams.get('secret'), config.appSecret)
    assert.equal(url.searchParams.get('js_code'), 'login-code')
    assert.equal(url.searchParams.get('grant_type'), 'authorization_code')
    assert.equal(options.redirect, 'error')
    assert.ok(options.signal instanceof AbortSignal)
    return { ok: true, json: async () => ({ openid: 'wechat-user', session_key: 'private-session-key', unionid: 'private-union-id' }) }
  })
  assert.deepEqual(await exchange('login-code'), { openid: 'wechat-user' })
  assert.equal(calls, 1)
})

test('微信错误映射明确，不回传上游正文或密钥，不自动重用一次性code', async t => {
  for (const [errcode, statusCode, code] of [
    [40029, 401, 'WECHAT_CODE_INVALID'], [40163, 401, 'WECHAT_CODE_INVALID'],
    [45011, 429, 'WECHAT_RATE_LIMITED'], [40125, 502, 'WECHAT_UNAVAILABLE'], [-1, 502, 'WECHAT_UNAVAILABLE']
  ]) {
    await t.test(String(errcode), async () => {
      let calls = 0
      const exchange = createWechatClient(testConfig().wechat, async () => {
        calls++
        return { ok: true, json: async () => ({ errcode, errmsg: 'private upstream detail' }) }
      })
      await assert.rejects(exchange('code'), error => {
        assert.equal(error.statusCode, statusCode)
        assert.equal(error.code, code)
        assert.ok(!error.message.includes('private'))
        assert.equal(error.cause, undefined)
        return true
      })
      assert.equal(calls, 1)
    })
  }
})

test('超时、HTTP错误、非JSON或无有效身份均失败关闭', async () => {
  const failures = [
    async () => { throw new Error('https://api.weixin.qq.com/?secret=do-not-log') },
    async () => ({ ok: false }),
    async () => ({ ok: true, json: async () => { throw new SyntaxError('private body') } }),
    ...[null, [], {}, { openid: 'missing-key' }, { openid: 'bad\nidentifier', session_key: 'key' }, { errcode: '0', openid: 'user', session_key: 'key' }].map(data => async () => ({ ok: true, json: async () => data }))
  ]
  for (const fetchImpl of failures) {
    await assert.rejects(createWechatClient(testConfig().wechat, fetchImpl)('code'), error => {
      assert.equal(error.statusCode, 502)
      assert.ok(!/secret|private|do-not-log/u.test(error.message))
      assert.equal(error.cause, undefined)
      return true
    })
  }
})

test('小程序码使用固定微信接口和release，缓存token并只对失效token重试一次', async () => {
  const config = testConfig().wechat
  const scene = roomScene('39159b22-69ba-4aaf-8fc8-b1109a81c726')
  const png = await sharp({ create: { width: 16, height: 16, channels: 3, background: 'white' } }).png().toBuffer()
  let tokens = 0, images = 0, clock = 1000
  const client = createWechatQRCodeClient(config, async (url, options) => {
    assert.equal(url.origin, 'https://api.weixin.qq.com')
    assert.equal(options.method, 'POST')
    assert.equal(options.redirect, 'error')
    assert.ok(options.signal instanceof AbortSignal)
    const input = JSON.parse(options.body)
    if (url.pathname === '/cgi-bin/stable_token') {
      tokens++
      assert.deepEqual(input, { grant_type: 'client_credential', appid: config.appId, secret: config.appSecret, force_refresh: false })
      return Response.json({ access_token: `private-token-${tokens}`, expires_in: 7200 })
    }
    assert.equal(url.pathname, '/wxa/getwxacodeunlimit')
    assert.equal(url.searchParams.get('access_token'), `private-token-${tokens}`)
    assert.deepEqual(input, { scene, page: 'pages/home/home', width: 400, env_version: 'release', check_path: true })
    images++
    if (images === 1) return Response.json({ errcode: 42001, errmsg: 'private detail' })
    return new Response(png, { headers: { 'content-type': 'image/png' } })
  }, () => clock)
  assert.equal((await sharp(await client(scene)).metadata()).format, 'png')
  await client(scene)
  assert.equal(tokens, 2)
  assert.equal(images, 3)
  clock += 7200 * 1000
  await client(scene)
  assert.equal(tokens, 3)
})

test('小程序码拒绝超大/损坏/伪装图片、微信错误与网络错误，不泄露凭证', async () => {
  const scene = roomScene('39159b22-69ba-4aaf-8fc8-b1109a81c726')
  const badResponses = [
    () => { throw new Error('private access_token secret URL') },
    () => new Response('private', { status: 502 }),
    () => new Response('not an image'),
    () => new Response('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>'),
    () => new Response(Buffer.alloc(1024 * 1024 + 1)),
    () => new Response('oversize', { headers: { 'content-length': '1048577' } }),
    () => Response.json({ errcode: 41030, errmsg: 'private path' }),
    () => Response.json({ errcode: 40001, errmsg: 'private token' })
  ]
  for (const respond of badResponses) {
    let calls = 0
    const client = createWechatQRCodeClient(testConfig().wechat, async url => {
      calls++
      return url.pathname === '/cgi-bin/stable_token' ? Response.json({ access_token: 'private-token', expires_in: 7200 }) : respond()
    })
    await assert.rejects(client(scene), error => {
      assert.equal(error.code, 'QRCODE_UNAVAILABLE')
      assert.ok(!/private|secret|access_token/u.test(error.message))
      assert.equal(error.cause, undefined)
      return true
    })
    assert.ok(calls <= 4)
  }
  const rateLimited = createWechatQRCodeClient(testConfig().wechat, async url => url.pathname === '/cgi-bin/stable_token'
    ? Response.json({ access_token: 'token', expires_in: 7200 }) : Response.json({ errcode: 45009 }))
  await assert.rejects(rateLimited(scene), { code: 'WECHAT_RATE_LIMITED' })
  for (const body of [{ access_token: 'bad', expires_in: '7200' }, { errcode: 40125, errmsg: 'private secret' }, null]) {
    await assert.rejects(createWechatQRCodeClient(testConfig().wechat, async () => Response.json(body))(scene), { code: 'QRCODE_UNAVAILABLE' })
  }
})
