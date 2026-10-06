import { fileURLToPath } from 'node:url'
export const assistantPagePath = fileURLToPath(new URL('./src/renderer/assistant.html', import.meta.url))
export const assistantPreloadPath = fileURLToPath(new URL('./src/preload/assistant-preload.cjs', import.meta.url))
