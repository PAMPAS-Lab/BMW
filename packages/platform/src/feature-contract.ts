import type {NativeMediaPort} from '@bmw-agent/media-native/port'
import type {WorkspaceMode} from '@bmw-agent/agent-contract'
import type {ProjectSourcePort} from '@bmw-agent/media-native/sources'
import type {BrowserWindow, IpcMain, Notification, Session, WebContents} from 'electron'
import type {ActiveProject, ActiveProjectProvider, BrowserFeatureHost} from '@bmw-agent/browser-capability/host'

export interface FeatureActivationOptions {session: Session; projectStore: ActiveProjectProvider}
/** Read-only projection of the owned Assistant; no provider protocol or extra loop. */
export interface FeatureAssistantActivity {projectId:string;sessionId:string|null;status:string;runId:string|null;action?:string;message?:string;toolRunning?:boolean;toolStartedAt?:number;lastEventAt?:number;lastEventType?:string;lastToolAction?:string;lastToolCompletedAt?:number;lastToolSucceeded?:boolean;dispatchBlocked?:boolean}
export interface FeatureStudioRegion {top:number;bottom:number;floatBottom?:number;propertyWidth:number;resourceWidth?:number;avoid?:{x:number;y:number;width:number;height:number};obscured?:boolean}
export interface FeatureStudioPresentation {immersive:boolean;chatOpen:boolean;position?:{x:number;y:number};docked?:boolean;region?:FeatureStudioRegion;floatHeight?:number}
export interface CollectionBinding {projectId:string;sessionId:string;driverId:string}
export interface CollectionReceipt {state:'active'|'success'|'failed'|'interrupted'|'uncertain'|'missing';drained:boolean}
/** Host-only admission, receipt and cleanup facts. No provider transport is exposed. */
export interface CollectionRuntimePort {
  yield?():Promise<void>
  binding():CollectionBinding|null
  available(binding:CollectionBinding):string|null
  recoverable(binding:CollectionBinding):boolean
  enqueue(binding:CollectionBinding,text:string,collectionRunId?:string):{accepted:true;dispatchId:string}|{accepted:false;reason:string}
  receipt(binding:CollectionBinding,dispatchId:string):CollectionReceipt
  cancel(binding:CollectionBinding,dispatchId:string):Promise<void>
  /** Immutable official resume anchor; batch leases never substitute one. */
  anchor?(binding:CollectionBinding):string|null
  /** Trusted cleanup recovery of this exact background input, never replay. */
  recover?(binding:CollectionBinding,dispatchId:string):Promise<void>
}
export interface FeatureHost {
  collectionRuntime?:CollectionRuntimePort
  collectionSources?(projectId:string):ProjectSourcePort
  configureCollectionBrowser?(configure:(binding:CollectionBinding,runId:string,browser:BrowserFeatureHost)=>(()=>void)):void
  setStudioPresentation?(value:FeatureStudioPresentation):void
  browserKernel: BrowserFeatureHost
  projectStore: ActiveProjectProvider
  mediaController?: NativeMediaPort
  Notification?: typeof Notification
  getMainWindow(): BrowserWindow | undefined
  getShellWebContents(): WebContents | undefined
  getTheme(): string
  isProjectChanging(): boolean
  getAgentWebContents?(): WebContents | undefined
  getAgentUrl?(): string | null | undefined
  setWorkspaceMode?(mode: WorkspaceMode): void
  openWorkspace?(mode: WorkspaceMode): Promise<void>
  listLibraryProjects?(includeArchived: boolean): (ActiveProject & {archivedAt?: string})[]
  librarySources?(projectId: string): ProjectSourcePort
  libraryProfileDirectory?():string
  getCurrentSessionId?(): string | null | undefined
  enqueueAssistant(sessionId:string,text:string,frozenContext?:string):Promise<string>
  getAssistantActivity?():FeatureAssistantActivity
  cancelAssistant?(sessionId:string):Promise<unknown>
  sendToAgent?(channel: string, value: unknown): void
  sendToShell?(channel: string, value: unknown): void
  synchronizeAgentProject(project: ActiveProject, options?: {activate?: boolean; ensureSession?: boolean}): Promise<{sessionId?: string}>
  selectAgentSession?(sessionId: string): Promise<unknown>
  activateProject?(projectId: string): Promise<unknown>
  revealAgent(): void
}
export interface FeatureRuntime {
  configure?(host: FeatureHost): void
  installIpc?(ipc: IpcMain): void
  layout?(bounds: {x: number; y: number; width: number; height: number}, visible: boolean): void
  setMode?(mode: WorkspaceMode): Promise<void>
  openPanel?(id: string): Promise<unknown>
  contextForSession?(sessionId: string, projectId: string): Promise<{text: string}>
  onProjectActivated?(project: ActiveProject, options?: {snapshot?: boolean}): void | Promise<void>
  onProjectWillArchive?(projectId: string): void | Promise<void>
  onProjectArchived?(projectId: string, next: ActiveProject): void | Promise<void>
  onAgentStarted?(project: ActiveProject): void | Promise<void>
  onSessionWillChange?(): void | Promise<void>
  onSessionChanged?(): void | Promise<void>
  onAgentLoaded?(): void | Promise<void>
  onMediaStatus?(value: unknown): void
  onAssistantChanged?(): void
  onStudioPresentation?(value:FeatureStudioPresentation):void
  stop?(): void | Promise<void>
}
export interface FeatureActivation {activate(options: FeatureActivationOptions): FeatureRuntime | Promise<FeatureRuntime>}
const hooks: readonly (keyof FeatureRuntime)[] = ['configure','installIpc','layout','setMode','openPanel','contextForSession','onProjectActivated','onProjectWillArchive','onProjectArchived','onAgentStarted','onAgentLoaded','onSessionWillChange','onSessionChanged','onMediaStatus','onAssistantChanged','onStudioPresentation','stop']
export function assertFeatureRuntime(raw: unknown): FeatureRuntime {
  if (!raw || typeof raw !== 'object') throw new TypeError('Feature activation must return a runtime.')
  const value = raw as FeatureRuntime
  for (const hook of hooks) if (value[hook] !== undefined && typeof value[hook] !== 'function') throw new TypeError('Invalid Feature runtime hook: ' + hook)
  return value
}
export async function activateFeature(feature: FeatureActivation, options: FeatureActivationOptions): Promise<FeatureRuntime> {
  return assertFeatureRuntime(await feature.activate(options))
}
