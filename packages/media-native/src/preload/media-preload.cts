const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('bmwMedia', {
  onCommand: (listener) => ipcRenderer.on('media-command', (_event, value) => listener(value)),
  chunk: (arrayBuffer) => ipcRenderer.send('media-chunk', arrayBuffer),
  state: (value) => ipcRenderer.send('media-state', value),
  finished: (value) => ipcRenderer.send('media-finished', value),
  comparison: (value) => ipcRenderer.send('media-comparison', value)
})
