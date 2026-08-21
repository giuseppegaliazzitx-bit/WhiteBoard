/**
 * Theme: follows the OS until the user picks one, then their choice sticks.
 * Stored separately from board data so it survives a board reset.
 */
const KEY = 'board:theme'

export function initTheme(button) {
  const media = window.matchMedia('(prefers-color-scheme: dark)')

  const stored = read()
  apply(stored || (media.matches ? 'dark' : 'light'))

  // Only track the OS while the user has expressed no preference.
  media.addEventListener('change', (e) => {
    if (!read()) apply(e.matches ? 'dark' : 'light')
  })

  button?.addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'
    try { localStorage.setItem(KEY, next) } catch { /* private mode */ }
    apply(next)
  })
}

function read() {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'dark' || v === 'light' ? v : null
  } catch {
    return null
  }
}

function apply(theme) {
  document.documentElement.dataset.theme = theme
}
