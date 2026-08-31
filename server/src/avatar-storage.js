const fs = require('node:fs/promises')
const { constants } = require('node:fs')
const path = require('node:path')

const FILE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u

// 仅接收服务端生成的UUID；原文件名、客户端路径和URL从不进入文件系统。
async function createAvatarStorage(directory) {
  await fs.mkdir(directory, { recursive: true, mode: 0o700 })
  const stat = await fs.lstat(directory)
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('invalid avatar directory')
  const root = await fs.realpath(directory)
  await fs.access(root, constants.R_OK | constants.W_OK)
  function filename(fileId) {
    if (!FILE_ID_PATTERN.test(fileId)) throw new Error('invalid avatar file id')
    return path.join(root, `${fileId}.jpg`)
  }
  return {
    async put(fileId, buffer) {
      await fs.writeFile(filename(fileId), buffer, { flag: 'wx', mode: 0o600, flush: true })
    },
    async read(fileId) {
      const handle = await fs.open(filename(fileId), constants.O_RDONLY | (constants.O_NOFOLLOW || 0))
      try {
        const stat = await handle.stat()
        if (!stat.isFile() || stat.size > 512 * 1024) throw new Error('invalid stored avatar')
        return await handle.readFile()
      } finally { await handle.close() }
    },
    async remove(fileId) {
      // 每次仅删除一个已替换头像的明确路径；不扫描、不递归、不批量清理。
      try { await fs.unlink(filename(fileId)) } catch (error) {
        if (error.code !== 'ENOENT') throw error
      }
    }
  }
}

module.exports = { createAvatarStorage, FILE_ID_PATTERN }
