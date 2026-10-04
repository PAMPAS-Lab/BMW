import type {CoverBridge,CoverCommand} from '../media/processing.cover-contract.js'
import type { MediaProcessingBridge, MediaProcessingCommand } from '../media-contract.js'
const { contextBridge, ipcRenderer } = require('electron') as typeof import('electron')
const bridge: MediaProcessingBridge = {
  onCommand: (listener) => { ipcRenderer.on('bmw-media-process', (_event, value: MediaProcessingCommand) => listener(value)) },
  read: (token, offset, length) => ipcRenderer.invoke('bmw-media-read', { token, offset, length }),
  write: (token, outputIndex, position, data) => ipcRenderer.invoke('bmw-media-write', { token, outputIndex, position, data }),
  reply: (value) => ipcRenderer.send('bmw-media-reply', value)
}
contextBridge.exposeInMainWorld('bmwMediaProcessing', bridge)

const coverBridge:CoverBridge={onCommand:listener=>{ipcRenderer.on('bmw-cover-command',(_event,command:CoverCommand)=>listener(command))},read:(token,offset,length)=>ipcRenderer.invoke('bmw-cover-read',{token,offset,length}),write:(token,position,data)=>ipcRenderer.invoke('bmw-cover-write',{token,position,data}),reply:raw=>ipcRenderer.send('bmw-cover-reply',raw)}
contextBridge.exposeInMainWorld('bmwCover',coverBridge)
