import {assertWorkspaceMode} from '@bmw-agent/agent-contract'
import type {WorkspaceMode} from '@bmw-agent/agent-contract'
import {activateFeature} from './feature-contract.js'
import type {FeatureActivationOptions, FeatureHost, FeatureRuntime} from './feature-contract.js'
import type {FeatureModule} from './product-definition.js'

/** Host coordinates independent workspaces; each feature owns its own content. */
export async function activateWorkspaces(features: readonly FeatureModule[], options: FeatureActivationOptions): Promise<FeatureRuntime> {
  const entries: {feature: FeatureModule; runtime: FeatureRuntime}[] = []
  for (const feature of features) if (feature.main) entries.push({feature, runtime: await activateFeature(feature.main, options)})
  let mode: WorkspaceMode = 'browser', host: FeatureHost | undefined
  const runtime: FeatureRuntime = {
    configure(config) {
      host = config
      for (const item of entries) item.runtime.configure?.({...config, openWorkspace: selected => runtime.setMode!(selected),
        sendToShell(channel,value) {if(channel!=='video-workspace-state'||item.feature.workspace===mode)config.sendToShell?.(channel,value)},
        sendToAgent(channel,value) {if(channel!=='video-workspace-state'||item.feature.workspace===mode)config.sendToAgent?.(channel,value)},
        setWorkspaceMode(selected) { mode = selected; config.setWorkspaceMode?.(selected) }})
    },
    installIpc(ipc) { for (const item of entries) item.runtime.installIpc?.(ipc) },
    layout(bounds, visible) { for (const item of entries) item.runtime.layout?.(bounds, visible && item.feature.workspace === mode) },
    async setMode(raw) {
      const next = assertWorkspaceMode(raw)
      await host?.collectionRuntime?.yield?.()
      for (const item of entries.filter(item => item.feature.workspace !== next)) await item.runtime.setMode?.(next)
      for (const item of entries.filter(item => item.feature.workspace === next)) await item.runtime.setMode?.(next)
      mode = next; host?.setWorkspaceMode?.(next)
    },
    async openPanel(id) {
      const item = entries.find(item => item.feature.panels?.includes(id))
      if (!item) throw new Error('Unknown BMW product panel.')
      if (item.feature.workspace) {await runtime.setMode!(item.feature.workspace);return {opened:true}}
      return item.runtime.openPanel?.(id)
    },
    async contextForSession(sessionId, projectId) {
      const item = entries.find(item => item.feature.workspace === mode)
      return await item?.runtime.contextForSession?.(sessionId, projectId) ?? {text: ''}
    },
    async onProjectActivated(project, options) { for (const item of entries) await item.runtime.onProjectActivated?.(project, options) },
    async onProjectWillArchive(id) { for (const item of entries) await item.runtime.onProjectWillArchive?.(id) },
    async onProjectArchived(id, next) { for (const item of entries) await item.runtime.onProjectArchived?.(id, next) },
    async onAgentStarted(project) { for (const item of entries) await item.runtime.onAgentStarted?.(project) },
    async onSessionWillChange() { for (const item of entries) await item.runtime.onSessionWillChange?.() },
    async onSessionChanged() { for (const item of entries) await item.runtime.onSessionChanged?.() },
    async onAgentLoaded() { for (const item of entries) await item.runtime.onAgentLoaded?.() },
    onMediaStatus(value) { for (const item of entries) item.runtime.onMediaStatus?.(value) },
    onAssistantChanged() { for (const item of entries) item.runtime.onAssistantChanged?.() },
    onStudioPresentation(value) { for (const item of entries) item.runtime.onStudioPresentation?.(value) },
    async stop() { for (const item of entries) await item.runtime.stop?.() }
  }
  return runtime
}
