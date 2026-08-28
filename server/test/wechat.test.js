const test = require('node:test')
const assert = require('node:assert/strict')
const { createWechatClient } = require('../src/wechat')
const { testConfig } = require('../test-support/config')

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
