const EMBEDDED_SHELL_TOKEN = /\s(?:Electron|BMW)\/[^\s]+/gi

/**
 * Present BMW page WebContents as the Chromium browser they actually are.
 * Google rejects Electron-branded user agents as embedded browsers even when
 * JavaScript is enabled, which prevents user-controlled OAuth inside BMW.
 */
export function browserCompatibleUserAgent(userAgent: unknown): string {
  return String(userAgent || '')
    .replace(EMBEDDED_SHELL_TOKEN, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}
