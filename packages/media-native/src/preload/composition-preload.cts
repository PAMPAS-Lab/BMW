import type { CompositionBridge, CompositionCommand } from '../composition-contract.js'
const { contextBridge, ipcRenderer } = require('electron') as typeof import('electron')
const bridge: CompositionBridge = {
  onCommand: listener => { ipcRenderer.on('bmw-composition-process', (_event, value: CompositionCommand) => listener(value)) },
  read: (token, assetIndex, offset, length) => ipcRenderer.invoke('bmw-composition-read', { token, assetIndex, offset, length }),
  write: (token, position, data) => ipcRenderer.invoke('bmw-composition-write', { token, position, data }),
  reply: value => ipcRenderer.send('bmw-composition-reply', value)
}
contextBridge.exposeInMainWorld('bmwComposition', bridge)
