const { contextBridge, ipcRenderer } = require('electron') as typeof import('electron')
contextBridge.exposeInMainWorld('bmwNarration', {
  onCommand: (listener: (value: unknown) => void) => ipcRenderer.on('bmw-narration-request', (_event, value: unknown) => listener(value)),
  reply: (value: unknown) => ipcRenderer.send('bmw-narration-result', value)
})
