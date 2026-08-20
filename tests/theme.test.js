const test = require('node:test')
const assert = require('node:assert/strict')
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
