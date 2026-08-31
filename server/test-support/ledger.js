const { randomUUID } = require('node:crypto')
const { testConfig } = require('./config')
const { createIdentityStore } = require('../src/identity-store')
const { createAuth } = require('../src/auth')
const { createRoomStore } = require('../src/room-store')
const { createProfileStore } = require('../src/profile-store')
const { createScoreStore } = require('../src/score-store')

async function setupLedger(db, mode = 'normal') {
  const config = testConfig()
  const auth = createAuth({ store: createIdentityStore(db, config.wechat.appId), sessionTtlSeconds: 600, exchangeCode: async code => ({ openid: code }) })
  const prefix = randomUUID()
  const [alice, bob, carol, outsider] = await Promise.all(['alice', 'bob', 'carol', 'outsider'].map(name => auth.login(`${prefix}-${name}`)))
  const rooms = createRoomStore(db, config.wechat.appId)
  const profiles = createProfileStore(db, config.wechat.appId)
  const scores = createScoreStore(db, config.wechat.appId)
  const room = await rooms.create(alice.user.id, { operationId: randomUUID(), roomName: '账本测试', mode })
  for (const user of [bob, carol]) await rooms.joinById(user.user.id, room.roomId, { operationId: randomUUID() })
  const score = async (user, action, payload = {}, operationId = randomUUID()) => scores.execute(user.user.id, room.roomId, { operationId, action, payload })
  const snapshot = () => rooms.get(alice.user.id, room.roomId)
  return { db, config, auth, rooms, profiles, scores, alice, bob, carol, outsider, room, score, snapshot }
}

module.exports = { setupLedger }
