const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { normalizeTheme, PALETTES } = require('../miniprogram/utils/theme')

test('主题值仅接受 light 和 dark', () => {
  assert.equal(normalizeTheme('light'), 'light')
  assert.equal(normalizeTheme('dark'), 'dark')
  assert.equal(normalizeTheme('system'), 'light')
  assert.equal(normalizeTheme(undefined), 'light')
})

test('深浅主题均提供原生导航与 TabBar 颜色', () => {
  for (const name of ['light', 'dark']) {
    assert.match(PALETTES[name].navBackground, /^#[0-9A-F]{6}$/i)
    assert.match(PALETTES[name].tabBackground, /^#[0-9A-F]{6}$/i)
    assert.match(PALETTES[name].tabSelected, /^#[0-9A-F]{6}$/i)
  }
})

test('房间页隐藏原生导航栏并让青雾柔光背景延伸到胶囊按钮区域', () => {
  const source = fs.readFileSync(path.join(__dirname, '../miniprogram/utils/theme.js'), 'utf8')
  const config = JSON.parse(fs.readFileSync(path.join(__dirname, '../miniprogram/pages/room/room.json'), 'utf8'))
  const wxss = fs.readFileSync(path.join(__dirname, '../miniprogram/pages/room/room.wxss'), 'utf8')
  assert.match(source, /pageType === 'room'[\s\S]*?navBackground = '#F6FAFB'/)
  assert.equal(config.navigationStyle, 'custom')
  assert.equal(config.navigationBarBackgroundColor, '#F6FAFB')
  assert.match(wxss, /rgba\(100,210,220,\.13\)/)
  assert.match(wxss, /#F6FAFB/)
})

test('首页背景和原生导航栏与房间页使用同一青雾方案', () => {
  const config = JSON.parse(fs.readFileSync(path.join(__dirname, '../miniprogram/pages/home/home.json'), 'utf8'))
  const wxss = fs.readFileSync(path.join(__dirname, '../miniprogram/pages/home/home.wxss'), 'utf8')
  assert.equal(PALETTES.light.navBackground, '#F6FAFB')
  assert.equal(config.navigationBarBackgroundColor, '#F6FAFB')
  assert.equal(config.navigationStyle, 'custom')
  assert.match(wxss, /rgba\(100,210,220,\.13\)/)
  assert.match(wxss, /#F6FAFB/)
})

test('全局背景变量和全部页面统一使用沉浸式导航', () => {
  const appConfig = JSON.parse(fs.readFileSync(path.join(__dirname, '../miniprogram/app.json'), 'utf8'))
  const appWxss = fs.readFileSync(path.join(__dirname, '../miniprogram/app.wxss'), 'utf8')
  const pages = ['home', 'room', 'record'].map(name => JSON.parse(
    fs.readFileSync(path.join(__dirname, `../miniprogram/pages/${name}/${name}.json`), 'utf8')
  ))
  assert.equal(appConfig.window.navigationStyle, 'custom')
  assert.equal(appConfig.window.backgroundColor, '#F6FAFB')
  assert.match(appWxss, /--app-background:\s*#F6FAFB/)
  assert.match(appWxss, /--page-bg:\s*var\(--app-background\)/)
  for (const config of pages) assert.equal(config.navigationStyle, 'custom')
})

test('房间弹窗深色模式不会出现白字白底', () => {
  const wxss = fs.readFileSync(path.join(__dirname, '../miniprogram/pages/room/room.wxss'), 'utf8')
  assert.match(wxss, /\.room-page\.theme-dark \.modal-header[\s\S]*?background:\s*#202421/)
  assert.match(wxss, /\.room-page\.theme-dark \.confirm-text[\s\S]*?background:\s*#252a27;\s*color:\s*#f4f5f4/)
})

test('房间信息记录列表拥有可收缩的独立滚动区域', () => {
  const wxss = fs.readFileSync(path.join(__dirname, '../miniprogram/pages/room/room.wxss'), 'utf8')
  assert.match(wxss, /\.message-panel\s*\{[\s\S]*?display:\s*flex;[\s\S]*?flex:\s*1;[\s\S]*?min-height:\s*0;[\s\S]*?flex-direction:\s*column;[\s\S]*?overflow:\s*hidden;/)
  assert.match(wxss, /\.chat-scroll\s*\{[\s\S]*?flex:\s*1;[\s\S]*?height:\s*0;[\s\S]*?min-height:\s*0;/)
})
