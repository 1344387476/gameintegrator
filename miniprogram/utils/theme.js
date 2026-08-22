const STORAGE_KEY = 'appearanceTheme'
const THEMES = new Set(['light', 'dark'])

const PALETTES = {
  light: {
    navBackground: '#F6FAFB',
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

function getCustomNavMetrics() {
  let windowInfo = {}
  let menuRect = null
  try {
    windowInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
    menuRect = wx.getMenuButtonBoundingClientRect ? wx.getMenuButtonBoundingClientRect() : null
  } catch (err) {}

  const statusBarHeight = Number(windowInfo.statusBarHeight) || 20
  const capsuleGap = menuRect && Number.isFinite(menuRect.top)
    ? Math.max(6, menuRect.top - statusBarHeight)
    : 8
  const navTop = menuRect && Number.isFinite(menuRect.top)
    ? Math.round(menuRect.top)
    : statusBarHeight + 6
  const navHeight = menuRect && Number.isFinite(menuRect.height)
    ? Math.round(menuRect.height)
    : 32
  const safeTop = menuRect && Number.isFinite(menuRect.bottom)
    ? Math.ceil(menuRect.bottom + capsuleGap)
    : Math.ceil(statusBarHeight + 48)

  return { safeTop, navTop, navHeight }
}

function applyNativeChrome(pageType = 'home', theme = getTheme()) {
  const normalized = normalizeTheme(theme)
  const palette = { ...PALETTES[normalized] }
  if (pageType === 'room' && normalized === 'light') palette.navBackground = '#F6FAFB'
  else if (pageType !== 'home' && normalized === 'light') palette.navBackground = '#F2F2F7'

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

module.exports = { getTheme, getCustomNavMetrics, setTheme, applyNativeChrome, normalizeTheme, PALETTES }
