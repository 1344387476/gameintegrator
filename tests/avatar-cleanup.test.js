const test = require('node:test')
const assert = require('node:assert/strict')

for (const [name, cleanup] of [
  ['userFunctions', require('../cloudfunctions/userFunctions/avatarCleanup')],
  ['roomFunctions', require('../cloudfunctions/roomFunctions/avatarCleanup')]
]) {
  test(`${name} 只删除一条被替换的受管头像`, async () => {
    const calls = []
    const cloud = { deleteFile: async options => calls.push(options) }
    const oldFileID = 'cloud://env.test/avatars/old.jpg'
    const newFileID = 'cloud://env.test/avatars/new.jpg'

    assert.equal(await cleanup.deleteReplacedAvatar(cloud, oldFileID, newFileID), true)
    assert.deepEqual(calls, [{ fileList: [oldFileID] }])
  })

  test(`${name} 不删除当前头像或非头像路径`, async () => {
    const calls = []
    const cloud = { deleteFile: async options => calls.push(options) }
    const current = 'cloud://env.test/avatars/current.jpg'

    assert.equal(await cleanup.deleteReplacedAvatar(cloud, current, current), false)
    assert.equal(await cleanup.deleteReplacedAvatar(cloud, 'cloud://env.test/room-qrcodes/ABC.png', current), false)
    assert.equal(calls.length, 0)
  })
}
