import type {ProjectSourcePort,SourceCollection,SourceObservation,SourceCaptureGuard,VideoIdentity} from '@bmw-agent/media-native/sources'
import type {NativeMediaPort} from '@bmw-agent/media-native/port'
import type {BrowserRequest} from './browser-schema.js'
import type {CollectionPagePoolOptions,CollectionPageVisit} from './collection-page-pool.js'
export type {CollectionPagePoolOptions,CollectionPageVisit,CollectionPageRequest,CollectionPageResult,CollectionPageLink} from './collection-page-pool.js'

/** Minimal Project view: the platform owns storage, the browser owns page admission. */
export interface ActiveProject {id: string; name: string; directory: string}
export interface ActiveProjectProvider {active(): ActiveProject}
export interface VideoSettingsPort {
  snapshot(): {videoPreferences?: unknown; edgeNarrationEnabled?: boolean; qwenNarrationEnabled?: boolean}
  update(input: {videoPreferences: unknown}): unknown
}
export interface BrowserSessionOwner {projectId:string; sessionId:string}
export interface StudioLibraryTarget {draftId:string;expectedRevision:number}
export interface BrowserStudioProgress {draftId:string;revision:number;operation:'narrate-pending';phase:'started'|'scene-completed'|'completed'|'failed';currentSceneId?:string;completedSceneIds:string[];pendingSceneIds:string[];updatedAt:number}
export interface BrowserExecutionOptions {actor?: 'agent' | 'user'; signal?: AbortSignal; sessionOwner?:BrowserSessionOwner}
export interface BrowserFeatureHost {
  projectStore: ActiveProjectProvider
  settingsStore?: VideoSettingsPort
  recordingController: NativeMediaPort
  projectSources?:()=>ProjectSourcePort
  sourcePages?:()=>{id:string;url:string;title:string}[]
  captureSource?:(request:{sourceGuard:SourceCaptureGuard;videoSelector:string;videoIndex?:number;fromStart?:boolean;maxDurationMs?:number;filename:string;tabId?:string},signal?:AbortSignal)=>Promise<unknown>
  downloadSource?:(request:{url:string;pageUrl:string;filename:string;tabId?:string;sourceGuard?:SourceCaptureGuard},signal?:AbortSignal)=>Promise<unknown>
  preserveSource?:(request:{url:string;pageUrl:string;tabId?:string;sourceGuard?:SourceCaptureGuard},signal?:AbortSignal)=>Promise<unknown>
  verifySourceVideo?:(request:SourceCaptureGuard&{tabId?:string},signal?:AbortSignal)=>Promise<VideoIdentity>
  collectSource?:(request:SourceCollection,signal?:AbortSignal)=>Promise<SourceObservation>
  collectPageBatch?<T>(options:CollectionPagePoolOptions,work:(visit:CollectionPageVisit)=>Promise<T>,signal?:AbortSignal):Promise<T>
  recoverCollectionPages?():Promise<void>
  execute(request: unknown, options?: BrowserExecutionOptions): Promise<unknown>
  videoStudioOpen?: (owner:BrowserSessionOwner) => Promise<unknown>
  videoStudioSelect?: (owner:BrowserSessionOwner,draftId:string) => Promise<unknown>
  libraryExecute?: (request:unknown,actor:'user'|'agent',signal?:AbortSignal) => Promise<unknown>
  libraryOpen?: (owner:BrowserSessionOwner,target?:StudioLibraryTarget) => Promise<unknown>
  videoStudioUse?: (owner:BrowserSessionOwner,material:{artifactId?:string;sourceId?:string;acquisitionId?:string},target:StudioLibraryTarget) => Promise<unknown>
  libraryNews?: (request:unknown,owner:BrowserSessionOwner,actor:'user'|'agent',signal?:AbortSignal) => Promise<unknown>
  libraryResearch?: (request:unknown,actor:'user'|'agent',signal?:AbortSignal) => Promise<unknown>
  libraryRecommendations?: (request:unknown,actor:'agent'|'user',owner?:BrowserSessionOwner,signal?:AbortSignal) => Promise<unknown>
  libraryRecommendationValidity?: (admission:unknown,topic:unknown,signal?:AbortSignal) => Promise<string[]>
  libraryCollecting?: (request:unknown,actor:'agent'|'user',owner?:BrowserSessionOwner,signal?:AbortSignal) => Promise<unknown>
  libraryCollectionBatch?: (request:unknown,actor:'agent'|'user',owner?:BrowserSessionOwner,signal?:AbortSignal) => Promise<unknown>
  libraryStreams?: (request:unknown,actor:'agent'|'user',signal?:AbortSignal) => Promise<unknown>
  libraryExports?: (request:unknown,signal?:AbortSignal) => Promise<unknown>
  videoStudioContext?: (owner?:BrowserSessionOwner) => unknown
  videoStudioChanged?: (owner?:BrowserSessionOwner,progress?:BrowserStudioProgress) => void
}
export interface BrowserActionContext {
  browserKernel: BrowserFeatureHost
  actor?: 'agent' | 'user'
  signal?: AbortSignal
  sessionOwner?:BrowserSessionOwner
}
/** Only the host creates this interface; it is never a model request property. */
export function assertBrowserFeatureHost(raw: unknown): BrowserFeatureHost {
  const value = raw as Partial<BrowserFeatureHost> | null
  if (!value || typeof value !== 'object' || typeof value.projectStore?.active !== 'function' ||
      typeof value.execute !== 'function' ||
      ['narrate', 'compose', 'processArtifact'].some(method => typeof value.recordingController?.[method as keyof NativeMediaPort] !== 'function')) {
    throw new TypeError('Invalid browser Feature host port.')
  }
  const project = value.projectStore.active()
  if (!project || typeof project.id !== 'string' || !project.id || typeof project.name !== 'string' || !project.name || typeof project.directory !== 'string' || !/^(?:\/|[a-zA-Z]:[\\/]|\\\\)/.test(project.directory)) throw new TypeError('Invalid active Project host reply.')
  for (const hook of ['videoStudioOpen','videoStudioSelect','videoStudioUse','libraryOpen','libraryExecute','libraryNews','libraryResearch','libraryExports','libraryStreams','libraryCollecting','libraryCollectionBatch','libraryRecommendations','libraryRecommendationValidity','videoStudioContext','videoStudioChanged','projectSources','sourcePages','collectSource','collectPageBatch','recoverCollectionPages','downloadSource','preserveSource','captureSource','verifySourceVideo'] as const) if (value[hook] !== undefined && typeof value[hook] !== 'function') throw new TypeError('Invalid browser Feature hook: '+hook)
  if (value.settingsStore && (typeof value.settingsStore.snapshot !== 'function' || typeof value.settingsStore.update !== 'function')) throw new TypeError('Invalid settings host port.')
  return value as BrowserFeatureHost
}
export function assertBrowserActionContext(raw: unknown): BrowserActionContext {
  const value = raw as Partial<BrowserActionContext> | null
  if (!value || typeof value !== 'object' || (value.actor !== undefined && !['agent', 'user'].includes(value.actor))) throw new TypeError('Invalid browser action context.')
  assertBrowserFeatureHost(value.browserKernel)
  if (value.signal !== undefined && !(value.signal instanceof AbortSignal)) throw new TypeError('Invalid browser cancellation signal.')
  if(value.sessionOwner!==undefined&&(typeof value.sessionOwner?.projectId!=='string'||!value.sessionOwner.projectId||typeof value.sessionOwner?.sessionId!=='string'||!value.sessionOwner.sessionId))throw new TypeError('Invalid browser Session owner.')
  return value as BrowserActionContext
}
export type BrowserExecute = (request: BrowserRequest, options?: BrowserExecutionOptions) => Promise<unknown>
