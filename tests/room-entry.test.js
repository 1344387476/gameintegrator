const test = require('node:test')
const assert = require('node:assert/strict')

const {
  extractInvite,
  extractRoomId,
  parseScannedRoomId
} = require('../miniprogram/utils/room-entry')

test('解析小程序码 scanCode 返回的编码 scene', () => {
  assert.equal(parseScannedRoomId({
    path: 'pages/home/home?scene=roomId%3DABC123'
  }), 'ABC123')
})

test('解析被二次编码的 scene', () => {
  assert.equal(extractRoomId('pages/home/home?scene=roomId%253DABC123'), 'ABC123')
})

test('兼容直接 roomId 参数和纯房间号二维码', () => {
  assert.equal(extractRoomId('pages/home/home?roomId=abc123&from=share'), 'ABC123')
  assert.equal(parseScannedRoomId({ result: 'abc123' }), 'ABC123')
})

test('不把页面路径当作房间号', () => {
  assert.equal(parseScannedRoomId({ path: 'pages/home/home' }), '')
})

test('解析自建后端永久UUID分享邀请和新版scene', () => {
  assert.equal(extractInvite('pages/home/home?roomId=22222222-2222-4222-8222-222222222222&from=share'),
    '22222222-2222-4222-8222-222222222222')
  assert.equal(extractInvite('pages/home/home?scene=rEjMzMzMzQzOIMzMzMzMzMw'), 'rEjMzMzMzQzOIMzMzMzMzMw')
})
