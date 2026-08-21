const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const gameMessages = require('../cloudfunctions/gameLogic/messageUtils')
const roomMessages = require('../cloudfunctions/roomFunctions/messageUtils')

for (const [name, utils] of [
  ['gameLogic', gameMessages],
  ['roomFunctions', roomMessages]
]) {
  test(`${name} 只保留最近100条房间信息`, () => {
    const existing = Array.from({ length: 98 }, (_, index) => ({ id: index + 1 }))
    const incoming = Array.from({ length: 7 }, (_, index) => ({ id: index + 99 }))
    const retained = utils.retainRecentMessages(existing, incoming)

    assert.equal(utils.MAX_ROOM_MESSAGES, 100)
    assert.equal(retained.length, 100)
    assert.equal(retained[0].id, 6)
    assert.equal(retained[99].id, 105)
  })

  test(`${name} 批量消息保持原有顺序且不修改输入数组`, () => {
    const existing = [{ id: 1 }, { id: 2 }]
    const incoming = [{ id: 3 }, { id: 4 }]
    const retained = utils.retainRecentMessages(existing, incoming)

    assert.deepEqual(retained.map(item => item.id), [1, 2, 3, 4])
    assert.deepEqual(existing.map(item => item.id), [1, 2])
    assert.deepEqual(incoming.map(item => item.id), [3, 4])
  })
}

test('房间生命周期结束时不再保留消息文档', () => {
  const source = fs.readFileSync(path.join(__dirname, '../cloudfunctions/roomFunctions/index.js'), 'utf8')
  const removals = source.match(/transaction\.collection\('messages'\)\.doc\(roomId\)\.remove\(\)/g) || []

  assert.equal(removals.length, 3)
  assert.doesNotMatch(source, /messageType:\s*'settle'/)
})

test('新房间把信息聚合到 rooms 且不再创建 messages 文档', () => {
  const source = fs.readFileSync(path.join(__dirname, '../cloudfunctions/roomFunctions/index.js'), 'utf8')

  assert.match(source, /recentMessages:\s*\[\{/)
  assert.match(source, /stateVersion:\s*1/)
  assert.doesNotMatch(source, /collection\('messages'\)\.doc\(roomId\)\.set/)
})

test('房间页只有 rooms 一条实时监听', () => {
  const source = fs.readFileSync(path.join(__dirname, '../miniprogram/pages/room/room.js'), 'utf8')
  const watches = source.match(/\.watch\s*\(\s*\{/g) || []

  assert.equal(watches.length, 1)
  assert.match(source, /collection\('rooms'\)\.doc\(roomId\)\.watch/)
  assert.doesNotMatch(source, /collection\('messages'\)[\s\S]{0,120}\.watch/)
})
