const { randomUUID } = require('node:crypto')
const sharp = require('sharp')
const { ApiError, safeErrorCode } = require('./errors')
const { FILE_ID_PATTERN } = require('./avatar-storage')

const MAX_AVATAR_BYTES = 2 * 1024 * 1024
// 单机内存有限，关闭跨请求图像缓存，每次解码仅用一个工作线程。
sharp.cache(false)
sharp.concurrency(1)

function imageType(buffer) {
  if (buffer.length >= 3 && buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return 'image/jpeg'
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png'
  if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'image/webp'
  return null
}

function isAnimatedPng(buffer) {
  // libpng可能只报告APNG的首帧，显式识别动画控制块后拒绝。
  for (let offset = 8; offset + 12 <= buffer.length;) {
    const length = buffer.readUInt32BE(offset)
    if (offset + 12 + length > buffer.length) break
    const type = buffer.toString('ascii', offset + 4, offset + 8)
    if (type === 'acTL') return true
    if (type === 'IEND') break
    offset += length + 12
  }
  return false
}

async function normalizeAvatar(buffer, mimetype) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw new ApiError(400, 'INVALID_AVATAR', '头像内容为空')
  if (buffer.length > MAX_AVATAR_BYTES) throw new ApiError(413, 'REQUEST_TOO_LARGE', '头像不能超过2 MiB')
  const type = imageType(buffer)
  // 部分上传客户端只提供通用二进制MIME；仍必须通过文件签名和实际解码。
  if (!type || (type !== mimetype && mimetype !== 'application/octet-stream')) throw new ApiError(415, 'UNSUPPORTED_AVATAR', '请上传真实的JPEG、PNG或WebP图片')
  try {
    if (type === 'image/png' && isAnimatedPng(buffer)) throw new Error('animated PNG')
    const options = { limitInputPixels: 2048 * 2048, failOn: 'warning' }
    const metadata = await sharp(buffer, options).metadata()
    if ((metadata.pages || 1) !== 1 || !metadata.width || !metadata.height) throw new Error('invalid dimensions or animation')
    // 重新编码会移除EXIF/GPS和附带内容；透明背景转白色，保留长宽比。
    const output = await sharp(buffer, options).rotate()
      .resize(512, 512, { fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#ffffff' }).jpeg({ quality: 85 }).timeout({ seconds: 5 }).toBuffer()
    if (output.length > 512 * 1024) throw new Error('oversized output')
    return output
  } catch {
    throw new ApiError(400, 'INVALID_AVATAR', '图片损坏、尺寸过大或为动图，请选择静态图片')
  }
}

function createProfile({ store, storage }) {
  let uploading = false
  return {
    async update(userId, nickname) {
      if (typeof nickname !== 'string' || /[\u0000-\u001f\u007f-\u009f\ud800-\udfff]/u.test(nickname)) {
        throw new ApiError(400, 'INVALID_REQUEST', '昵称格式无效')
      }
      const value = nickname.trim()
      if (!value || [...value].length > 10) throw new ApiError(400, 'INVALID_REQUEST', '昵称需要1～10个字符')
      return store.updateNickname(userId, value)
    },
    async upload(userId, readUpload, log) {
      // 包括接收、解码和保存；不排队积累文件Buffer。单进程同时处理一个头像。
      if (uploading) throw new ApiError(503, 'UPLOAD_BUSY', '头像上传繁忙，请稍后重试')
      uploading = true
      try {
        const { buffer, mimetype } = await readUpload()
        const normalized = await normalizeAvatar(buffer, mimetype)
        const fileId = randomUUID()
        try { await storage.put(fileId, normalized) } catch (error) {
          log.warn({ code: safeErrorCode(error), fileId }, 'avatar write failed; manual inspection required')
          throw error
        }
        let result
        try { result = await store.replaceAvatar(userId, fileId) } catch (error) {
          // COMMIT响应丢失时无法断定未提交，绝不能删掉可能已在使用的新头像。
          log.warn({ code: safeErrorCode(error), fileId }, 'avatar reference save uncertain; manual inspection required')
          throw error
        }
        if (result.previousFileId && result.previousFileId !== fileId) {
          try { await storage.remove(result.previousFileId) } catch (error) {
            log.warn({ code: safeErrorCode(error), fileId: result.previousFileId }, 'avatar cleanup pending; manual inspection required')
          }
        }
        return result.user
      } finally { uploading = false }
    },
    async read(userId, fileId) {
      if (!FILE_ID_PATTERN.test(fileId) || !await store.canReadAvatar(userId, fileId)) {
        throw new ApiError(404, 'AVATAR_NOT_FOUND', '头像不存在或无权访问')
      }
      try { return await storage.read(fileId) } catch (error) {
        if (error.code === 'ENOENT') throw new ApiError(404, 'AVATAR_NOT_FOUND', '头像不存在或无权访问')
        throw error
      }
    }
  }
}

module.exports = { createProfile, normalizeAvatar, MAX_AVATAR_BYTES }
