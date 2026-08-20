const STORAGE_KEY = 'appearanceTheme'
const THEMES = new Set(['light', 'dark'])

const PALETTES = {
  light: {
    navBackground: '#F7FAF8',
    navFront: '#000000',
    tabBackground: '#FFFFFF',
    tabColor: '#8E8E93',
    tabSelected: '#248D52'
  },
  dark: {
    navBackground: '#111513',
    navFront: '#ffffff',
    tabBackground: '#171A18',
    tabColor: '#8E938F',
    tabSelected: '#48D17B'
  }
}

function normalizeTheme(theme) {
  return THEMES.has(theme) ? theme : 'light'
}

function getTheme() {
  const app = typeof getApp === 'function' ? getApp() : null
  const globalTheme = app && app.globalData && app.globalData.appearanceTheme
  if (THEMES.has(globalTheme)) return globalTheme
  let stored = 'light'
  try { stored = wx.getStorageSync(STORAGE_KEY) } catch (err) {}
  return normalizeTheme(stored)
}

function applyNativeChrome(pageType = 'home', theme = getTheme()) {
  const normalized = normalizeTheme(theme)
  const palette = { ...PALETTES[normalized] }
  if (pageType !== 'home' && normalized === 'light') palette.navBackground = '#F2F2F7'

  wx.setNavigationBarColor({
    frontColor: palette.navFront,
    backgroundColor: palette.navBackground,
    animation: { duration: 180, timingFunc: 'easeInOut' }
  })

  if (wx.setTabBarStyle) {
    wx.setTabBarStyle({
      color: palette.tabColor,
      selectedColor: palette.tabSelected,
      backgroundColor: palette.tabBackground,
      borderStyle: normalized === 'dark' ? 'black' : 'white'
    })
  }
  return normalized
}

function setTheme(theme, page, pageType = 'home') {
  const normalized = normalizeTheme(theme)
  try { wx.setStorageSync(STORAGE_KEY, normalized) } catch (err) {}
  const app = typeof getApp === 'function' ? getApp() : null
  if (app && app.globalData) app.globalData.appearanceTheme = normalized
  if (page && typeof page.setData === 'function') page.setData({ appearanceTheme: normalized })
  applyNativeChrome(pageType, normalized)
  return normalized
}

module.exports = { getTheme, setTheme, applyNativeChrome, normalizeTheme, PALETTES }
