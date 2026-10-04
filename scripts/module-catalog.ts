export type ModuleId = 'agent-contract' | 'browser-capability' | 'media-native' | 'platform' | 'feature-video' | 'harness-dsh' | 'product-bmw' | 'application' | 'validation'
export interface ModuleDefinition {
  id: ModuleId
  responsibility: string
  roots: readonly string[]
  runtimeDependencies: readonly ModuleId[]
  typeDependencies?: readonly ModuleId[]
  installedImports?: Readonly<Record<string, readonly string[]>>
}
export const modules: readonly ModuleDefinition[] = [
  {id:'agent-contract',responsibility:'Provider-neutral Agent runtime/client/context interfaces and selection coordination.',roots:['packages/agent-contract/'],runtimeDependencies:[]},
  {id:'media-native',responsibility:'Project artifact IO, capture, decode, processing, narration, composition and sandboxed workers.',roots:['packages/media-native/'],runtimeDependencies:[]},
  {id:'browser-capability',responsibility:'One browser catalog, validated actions, Project pages, Bridge/MCP admission, FIFO and renderer reads.',roots:['packages/browser-capability/'],runtimeDependencies:[],typeDependencies:['media-native']},
  {id:'platform',responsibility:'Application lifecycle, Projects/storage, permissions/settings/schedules, Shell and typed Feature host.',roots:['packages/platform/'],runtimeDependencies:['agent-contract','browser-capability','media-native']},
  {id:'feature-video',responsibility:'Video actions, draft/CAS/audio provenance, Studio state/IPC/UI and prompt context.',roots:['packages/feature-video/'],runtimeDependencies:['browser-capability','media-native'],typeDependencies:['platform']},
  {id:'harness-dsh',responsibility:'Sole Agent driver: DSH process/auth/transport, compatibility, client adapter and managed configuration.',roots:['packages/harness-dsh/'],runtimeDependencies:['agent-contract'],installedImports:{'packages/harness-dsh/dsh/plugins/browser-mcp/index.ts':['@deepseek-ai/dsh-mcp-client']}},
  {id:'product-bmw',responsibility:'BMW product composition and enabled Features; no driver selection or application loop.',roots:['packages/product-bmw/'],runtimeDependencies:['platform','feature-video']},
  {id:'application',responsibility:'Select BMW and its sole DSH driver, then enter the platform application.',roots:['apps/bmw/','scripts/product-entry.ts'],runtimeDependencies:['product-bmw','harness-dsh','platform']},
  {id:'validation',responsibility:'Development-only verification, fixtures, dependency analysis and test selection; never a model capability.',roots:['scripts/','types/'],runtimeDependencies:['agent-contract','media-native','browser-capability','platform','feature-video','harness-dsh','product-bmw','application']}
]
export function ownerOf(file: string): ModuleDefinition | undefined {
  return modules.find(module => module.roots.some(root => root.endsWith('/') ? file.startsWith(root) : file === root))
}
export interface InterfaceDefinition {
  id: string
  provider: ModuleId
  consumers: readonly ModuleId[]
  files: readonly string[]
  guarantees: string
  tests: readonly string[]
}
export const interfaces: readonly InterfaceDefinition[] = [
  {id:'agent-driver',provider:'agent-contract',consumers:['platform','harness-dsh','application'],files:['packages/agent-contract/index.ts','packages/agent-contract/src/context-sync.ts'],guarantees:'Driver lifecycle, normalized membership/context, stale-selection rejection and per-driver Project bindings; core has no DSH protocol.',tests:['agent.context','api.types','driver']},
  {id:'feature-lifecycle',provider:'platform',consumers:['feature-video','product-bmw'],files:['packages/platform/src/feature-contract.ts','packages/platform/src/product-definition.ts'],guarantees:'Named activation/configure/layout/context/shutdown hooks; malformed runtime hooks fail before wiring; no extra model tools.',tests:['platform.feature-contract','api.types','desktop.workspace']},
  {id:'browser-feature-host',provider:'browser-capability',consumers:['platform','feature-video'],files:['packages/browser-capability/src/browser-host.ts'],guarantees:'Minimum Project/settings/media ports, actor enum, cancellation signal; validated action dispatch remains the only execution entry.',tests:['browser.host-contract','api.types','video.boundary','driver']},
  {id:'browser-model',provider:'browser-capability',consumers:['platform','feature-video'],files:['packages/browser-capability/src/browser-schema.ts','packages/browser-capability/src/tool-catalog.ts','packages/browser-capability/src/bridge-server.ts','packages/browser-capability/src/browser-mcp-server.ts'],guarantees:'Exactly browser; bounded closed requests, authenticated Project/Session admission, FIFO, cancellation and image admission.',tests:['browser.schema','browser.catalog','browser.operations','browser.shutdown','browser.deadline','platform.boundaries','driver']},
  {id:'native-media',provider:'media-native',consumers:['browser-capability','platform','feature-video'],files:['packages/media-native/src/media-port.ts','packages/media-native/src/media-contract.ts','packages/media-native/src/composition-contract.ts','packages/media-native/src/narration-contract.ts','packages/media-native/src/image-contract.ts','packages/media-native/src/image-drawing-contract.ts','packages/media-native/src/visual-segments.ts','packages/media-native/src/caption-export.ts'],guarantees:'Artifact IDs rather than caller paths; bounded request/reply admission; actual duration/track checks; cancellation drains output before rollback.',tests:['media.port-contract','api.types','media.controller','media.processing','media.production','media.processing-runtime','video','localNarration']},
  {id:'project-storage',provider:'platform',consumers:['browser-capability','feature-video','application'],files:['packages/platform/src/project-store.ts','packages/platform/src/state-load.ts','packages/platform/src/global-settings-store.ts','packages/platform/src/scheduled-task-store.ts','packages/platform/src/permission-store.ts','packages/platform/src/layout-store.ts','packages/platform/src/session-continuity.ts'],guarantees:'Project identity/documents/driver bindings, preserved unreadable Project/settings/tasks/permissions/layout/login state and encrypted snapshots, only missing-file initialization; no production Profile in tests.',tests:['platform.projects','platform.state','platform.permission-store','platform.continuity-state','platform.driver-binding','startup-recovery','startup-exit','startup.permissions.retry','startup.permissions.exit','startup.layout.retry','startup.layout.exit','startup.continuity-config.retry','startup.continuity-config.exit','startup.continuity-snapshot.retry','startup.continuity-snapshot.exit','desktop.projects']},
  {id:'studio-draft',provider:'feature-video',consumers:['platform','browser-capability'],files:['packages/feature-video/src/studio-contract.ts','packages/feature-video/src/studio-schema.ts','packages/feature-video/src/studio-service.ts','packages/feature-video/src/studio-store.ts'],guarantees:'Project-owned drafts/artifacts, revision conflicts, actual narration provenance and stale export rejection; independent caption/visual edits.',tests:['video.studio','video.settings','video.boundary','studio','desktop.workspace']},
  {id:'sandbox-io',provider:'media-native',consumers:['feature-video','platform'],files:['packages/media-native/src/artifact-job-io.ts','packages/media-native/src/capture-policy.ts','packages/media-native/src/text-export.ts'],guarantees:'Pinned Project artifacts, token/sender/offset bounds, isolated browser workers; no shell, cookies or unrestricted filesystem exposure.',tests:['media.processing','media.controller','media.capture','video','studio']}
]

/** Concrete implementation/assembly checks are separate from provider-neutral interface guarantees. */
export interface ImplementationCheck {
  id: string
  modules: readonly ModuleId[]
  contracts: readonly string[]
  guarantees: string
  watch: readonly string[]
  tests: readonly string[]
}
export const implementationChecks: readonly ImplementationCheck[] = [
  {id:'platform-shell-admission',modules:['platform'],contracts:['browser-model','project-storage','feature-lifecycle'],guarantees:'Every Shell invoke admits only its live trusted main frame before application code; other Renderers, child frames and navigated content are denied.',watch:['packages/platform/src/shell-ipc.ts','packages/platform/src/main.ts','packages/platform/src/preload/shell-preload.cts'],tests:['platform.shell-ipc','driver']},
  {id:'bmw-dsh-assembly',modules:['harness-dsh','application','platform'],contracts:['agent-driver','browser-model'],
    guarantees:'Actual installed DSH startup/authentication, prompt assembly, normalized sessions and persisted DSH binding compatibility. Consumes the generic interfaces; does not define Browser or AgentDriver code dependencies.',
    watch:['packages/harness-dsh/','packages/agent-contract/','apps/bmw/','packages/product-bmw/'],tests:['dsh','platform.driver-binding']}
]
