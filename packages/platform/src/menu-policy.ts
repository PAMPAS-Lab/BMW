import path from 'node:path'

export function suggestedPageFilename(title, url) {
  let value = String(title || '').trim()
  if (!value) {
    try { value = new URL(url).hostname || 'page' } catch { value = 'page' }
  }
  const safe = value.replace(/[<>:"/\\|?*\u0000-\u001f]+/g, '-').replace(/[. ]+$/g, '').slice(0, 100) || 'page'
  return `${safe}.html`
}

export function pageSaveType(filePath) {
  return path.extname(filePath).toLowerCase() === '.mhtml' ? 'MHTML' : 'HTMLComplete'
}

export function isApplicationMenuShortcut(input, platform = process.platform) {
  if (!input || input.type !== 'keyDown' || input.isAutoRepeat) return false
  const key = String(input.key || '').toLowerCase()
  if (key === 'm' && input.shift && (platform === 'darwin' ? input.meta : input.control) && !input.alt) return true
  if (key === 'f10' && !input.alt && !input.control && !input.meta && !input.shift) return true
  if (platform === 'darwin') return key === 'f2' && input.control && !input.alt && !input.meta && !input.shift
  return key === 'alt' && !input.control && !input.meta && !input.shift
}

export function isSavePageShortcut(input, platform = process.platform) {
  if (!input || input.type !== 'keyDown' || input.isAutoRepeat) return false
  const command = platform === 'darwin' ? input.meta === true : input.control === true
  return String(input.key || '').toLowerCase() === 's' && command && !input.alt && !input.shift
}
