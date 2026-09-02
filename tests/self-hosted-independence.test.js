const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')

function sourceFiles(directory, extensions) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const target = path.join(directory, entry.name)
    if (entry.isDirectory()) return sourceFiles(target, extensions)
    return extensions.has(path.extname(entry.name)) ? [target] : []
  })
}

test('小程序发布运行码不调用微信云开发', () => {
  const files = sourceFiles(path.join(root, 'miniprogram'), new Set(['.js', '.json', '.wxml', '.wxss']))
  const forbidden = [
    { pattern: /wx\s*\.\s*cloud/u, label: 'wx.cloud' },
    { pattern: /cloud:\/\//u, label: 'cloud://' },
    { pattern: /@cloudbase\/|wx-server-sdk/u, label: 'CloudBase SDK' }
  ]

  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8')
    for (const item of forbidden) {
      assert.doesNotMatch(source, item.pattern, `${path.relative(root, file)} 不应包含 ${item.label}`)
    }
  }
})

test('自建后端生产依赖不包含微信云开发 SDK', () => {
  const rootManifest = require('../package.json')
  assert.equal(Object.hasOwn(rootManifest.dependencies || {}, 'wx-server-sdk'), false)
  assert.equal(Object.keys(rootManifest.dependencies || {}).some(name => name.startsWith('@cloudbase/')), false)

  const manifest = require('../server/package.json')
  const dependencies = Object.keys(manifest.dependencies || {})
  assert.equal(dependencies.includes('wx-server-sdk'), false)
  assert.equal(dependencies.some(name => name.startsWith('@cloudbase/')), false)

  const files = sourceFiles(path.join(root, 'server', 'src'), new Set(['.js']))
  for (const file of files) {
    assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /wx-server-sdk|@cloudbase\//u,
      `${path.relative(root, file)} 不应加载微信云开发 SDK`)
  }
})
