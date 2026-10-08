import { contextBridge, ipcRenderer } from 'electron'
import type { AssistantUiPort, AssistantState } from '@bmw-agent/agent-contract'
const port: AssistantUiPort = {
  sendStudioPrompt:value=>ipcRenderer.invoke('video-studio-prompt',value),
  setStudioChat:value=>ipcRenderer.invoke('video-studio-chat',value),
  onStudioPresentation(listener){const receive=(_event:unknown,value:unknown)=>listener(value);ipcRenderer.on('bmw-studio-presentation',receive);return ()=>ipcRenderer.removeListener('bmw-studio-presentation',receive)},
  composerContext: () => ipcRenderer.invoke('video-workspace-state'),
  setWorkspaceMode: mode => ipcRenderer.invoke('video-workspace-mode', mode),
  invoke: command => ipcRenderer.invoke('bmw-assistant-command', command),
  subscribe(listener) {
    const receive = (_event: unknown, value: AssistantState) => listener(value)
    ipcRenderer.on('bmw-assistant-state', receive)
    return () => ipcRenderer.removeListener('bmw-assistant-state', receive)
  },
  onOpenSettings(listener) {
    const receive=()=>listener()
    ipcRenderer.on('bmw-assistant-open-settings',receive)
    return ()=>ipcRenderer.removeListener('bmw-assistant-open-settings',receive)
  },
  onComposerPrefill(listener) {
    const receive=(_event:unknown,value:unknown)=>listener(value)
    ipcRenderer.on('bmw-assistant-prefill',receive)
    return ()=>ipcRenderer.removeListener('bmw-assistant-prefill',receive)
  },
  onComposerContext(listener) {
    const receive = (_event: unknown, value: unknown) => listener(value)
    ipcRenderer.on('video-workspace-state', receive)
    return () => ipcRenderer.removeListener('video-workspace-state', receive)
  }
}
contextBridge.exposeInMainWorld('bmwAssistant', port)
