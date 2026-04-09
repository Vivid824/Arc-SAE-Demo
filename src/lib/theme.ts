import type { ThemeName } from './schema'

const STORAGE_KEY = 'theme'

export function readStoredTheme(): ThemeName | null {
  if (typeof window === 'undefined') {
    return null
  }

  const value = window.localStorage.getItem(STORAGE_KEY)
  return value === 'light' || value === 'dark' ? value : null
}

export function writeStoredTheme(theme: ThemeName) {
  if (typeof window === 'undefined') {
    return
  }

  window.localStorage.setItem(STORAGE_KEY, theme)
}

export function resolveTheme(
  storedTheme: ThemeName | null,
  manifestDefaultTheme: ThemeName | null | undefined,
): ThemeName {
  return storedTheme ?? manifestDefaultTheme ?? 'light'
}

export function applyTheme(theme: ThemeName) {
  if (typeof document === 'undefined') {
    return
  }

  document.documentElement.dataset.theme = theme
  document.documentElement.style.colorScheme = theme
}

