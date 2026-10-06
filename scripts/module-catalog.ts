export type ModuleId = 'agent-contract' | 'agent-ui' | 'browser-capability' | 'media-native' | 'platform' | 'feature-video' | 'harness-dsh' | 'harness-qoder' | 'harness-codex' | 'product-bmw' | 'application' | 'validation'
export interface ModuleDefinition {
  id: ModuleId
  responsibility: string
  roots: readonly string[]
  runtimeDependencies: readonly ModuleId[]
  typeDependencies?: readonly ModuleId[]
  installedImports?: Readonly<Record<string, readonly string[]>>
}
export const modules: readonly ModuleDefinition[] = [
  {id:'agent-contract',responsibility:'Provider-neutral Agent backend, settings, events and BMW Project/Session context contracts.',roots:['packages/agent-contract/'],runtimeDependencies:[]},
  {id:'agent-ui',responsibility:'BMW-owned sandboxed conversation renderer and preload; only typed Host IPC, no provider or browser execution privileges.',roots:['packages/agent-ui/'],runtimeDependencies:['agent-contract']},
  {id:'media-native',responsibility:'Project artifact IO, capture, decode, processing, narration, composition and sandboxed workers.',roots:['packages/media-native/'],runtimeDependencies:[]},
  {id:'browser-capability',responsibility:'One browser catalog, validated actions, Project pages, Bridge/MCP admission, FIFO and renderer reads.',roots:['packages/browser-capability/'],runtimeDependencies:[],typeDependencies:['media-native']},
  {id:'platform',responsibility:'Application lifecycle, Projects/storage, permissions/settings/schedules, Shell and typed Feature host.',roots:['packages/platform/'],runtimeDependencies:['agent-contract','browser-capability','media-native']},
  {id:'feature-video',responsibility:'Video actions, draft/CAS/audio provenance, Studio state/IPC/UI and prompt context.',roots:['packages/feature-video/'],runtimeDependencies:['browser-capability','media-native'],typeDependencies:['platform']},
  {id:'harness-dsh',responsibility:'Official DSH Agent process/auth/transport, native Project mappings, effective tool admission and explicit cold migration export.',roots:['packages/harness-dsh/'],runtimeDependencies:['agent-contract'],installedImports:{'packages/harness-dsh/dsh/plugins/browser-mcp/index.ts':['@deepseek-ai/dsh-mcp-client']}},
  {id:'harness-qoder',responsibility:'Official Qoder CN SDK/Worker Agent loop, pre-input effective browser catalog admission and normalized stream events.',roots:['packages/harness-qoder/'],runtimeDependencies:['agent-contract']},
  {id:'harness-codex',responsibility:'Official Codex App Server, isolated effective model catalog preflight, dynamic browser tool transport and normalized receipts/events.',roots:['packages/harness-codex/'],runtimeDependencies:['agent-contract']},
  {id:'product-bmw',responsibility:'BMW product composition and enabled Features; no driver selection or application loop.',roots:['packages/product-bmw/'],runtimeDependencies:['platform','feature-video']},
  {id:'application',responsibility:'Select BMW and its configured drivers, then enter the platform application.',roots:['apps/bmw/','scripts/product-entry.ts'],runtimeDependencies:['product-bmw','harness-dsh','harness-qoder','harness-codex','agent-ui','platform']},
  {id:'validation',responsibility:'Development-only verification, fixtures, dependency analysis and test selection; never a model capability.',roots:['scripts/','types/'],runtimeDependencies:['agent-contract','agent-ui','media-native','browser-capability','platform','feature-video','harness-dsh','harness-qoder','harness-codex','product-bmw','application']}
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
  {id:'agent-driver',provider:'agent-contract',consumers:['platform','harness-dsh','harness-qoder','harness-codex','application'],files:['packages/agent-contract/index.ts','packages/agent-contract/src/context-sync.ts','packages/agent-contract/src/conversation.ts'],guarantees:'Stable BMW Sessions, closed event/capability admission, lifecycle and per-driver provider resume anchors; core owns no provider Agent loop.',tests:['agent.context','agent.conversation','api.types','driver']},
  {id:'agent-settings',provider:'agent-contract',consumers:['platform','agent-ui','harness-dsh','harness-qoder','harness-codex','application'],files:['packages/agent-contract/src/driver-settings.ts','packages/agent-contract/src/assistant-ui.ts'],guarantees:'Closed official-control requests and redacted account/model projections, no echoed secrets or model input; settings and actual native cleanup hold Host exclusion before Project transitions.',tests:['agent.driver-settings','agent.assistant-ui','platform.agent-settings','codex.settings','codex.backend','qoder.settings','dsh.settings','assistant.application','dsh']},
  {id:'agent-conversations',provider:'platform',consumers:['application'],files:['packages/platform/src/conversation-store.ts','packages/platform/src/agent-history-store.ts','packages/platform/src/agent-host.ts','packages/platform/src/session-service.ts','packages/platform/src/agent-data-format.ts'],guarantees:'Visible blank Sessions, durable submission receipts, Project membership, immutable provider bindings, FIFO until actual resource drain, generic display-history ownership and uncertain-delivery recovery without replay.',tests:['platform.conversation-store','platform.agent-history','platform.agent-host','agent.data-migration']},
  {id:'feature-lifecycle',provider:'platform',consumers:['feature-video','product-bmw'],files:['packages/platform/src/feature-contract.ts','packages/platform/src/product-definition.ts'],guarantees:'Named activation/configure/layout/context/shutdown hooks; malformed runtime hooks fail before wiring; no extra model tools.',tests:['platform.feature-contract','api.types','desktop.workspace']},
  {id:'browser-feature-host',provider:'browser-capability',consumers:['platform','feature-video'],files:['packages/browser-capability/src/browser-host.ts'],guarantees:'Minimum Project/settings/media ports, actor enum, cancellation signal; validated action dispatch remains the only execution entry.',tests:['browser.host-contract','api.types','video.boundary','driver']},
  {id:'browser-model',provider:'browser-capability',consumers:['platform','feature-video'],files:['packages/browser-capability/src/browser-schema.ts','packages/browser-capability/src/tool-catalog.ts','packages/browser-capability/src/bridge-server.ts','packages/browser-capability/src/browser-mcp-server.ts'],guarantees:'Exactly browser; bounded closed requests, authenticated Project/Session admission, FIFO, cancellation and image admission.',tests:['browser.sources','browser.schema','browser.catalog','browser.operations','browser.shutdown','browser.deadline','platform.boundaries','driver']},
  {id:'native-media',provider:'media-native',consumers:['browser-capability','platform','feature-video'],files:['packages/media-native/src/media-port.ts','packages/media-native/src/media-contract.ts','packages/media-native/src/composition-contract.ts','packages/media-native/src/narration-contract.ts','packages/media-native/src/image-contract.ts','packages/media-native/src/image-drawing-contract.ts','packages/media-native/src/visual-segments.ts','packages/media-native/src/focus-contract.ts','packages/media-native/src/recording-contract.ts','packages/media-native/src/source-contract.ts','packages/media-native/src/speech-contract.ts','packages/media-native/src/caption-export.ts'],guarantees:'Artifact IDs rather than caller paths; bounded request/reply admission; actual duration/track checks; cancellation drains output before rollback.',tests:['speech','media.speech','platform.sources','video.sources','sources','media.port-contract','api.types','media.controller','media.processing','media.production','media.processing-runtime','video','localNarration']},
  {id:'project-storage',provider:'platform',consumers:['browser-capability','feature-video','application'],files:['packages/platform/src/project-store.ts','packages/platform/src/project-source-store.ts','packages/platform/src/state-load.ts','packages/platform/src/global-settings-store.ts','packages/platform/src/scheduled-task-store.ts','packages/platform/src/permission-store.ts','packages/platform/src/layout-store.ts','packages/platform/src/session-continuity.ts'],guarantees:'BMW Project identity/documents/page state without native mappings, preserved unreadable Project/settings/tasks/permissions/layout/login state and encrypted snapshots, only missing-file initialization; no production Profile in tests.',tests:['platform.sources','platform.projects','platform.state','platform.permission-store','platform.continuity-state','platform.driver-binding','startup-recovery','startup-exit','startup.permissions.retry','startup.permissions.exit','startup.layout.retry','startup.layout.exit','startup.continuity-config.retry','startup.continuity-config.exit','startup.continuity-snapshot.retry','startup.continuity-snapshot.exit','desktop.projects']},
  {id:'studio-draft',provider:'feature-video',consumers:['platform','browser-capability'],files:['packages/feature-video/src/studio-contract.ts','packages/feature-video/src/studio-schema.ts','packages/feature-video/src/studio-service.ts','packages/feature-video/src/studio-store.ts'],guarantees:'Project-owned drafts/artifacts, revision conflicts, actual narration provenance and stale export rejection; independent caption/visual edits.',tests:['video.sources','video.studio','video.settings','video.boundary','studio','desktop.workspace']},
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
  {id:'bmw-agent-entry',modules:['application','platform','agent-ui','harness-dsh','harness-codex','harness-qoder'],contracts:['agent-driver','agent-settings','agent-conversations','studio-draft','project-storage'],guarantees:'Production entry owns the Assistant, creates independent blank driver Sessions before input, preserves Project pages and Studio ownership across driver changes/restart, runs schedules on their pinned driver/Session with restored selection, and rejects invalid saved bindings without fallback.',watch:['scripts/product-entry.ts','apps/bmw/','packages/platform/src/assistant-service.ts','packages/platform/src/main.ts'],tests:['bmw.agent-assembly','assistant.default','assistant.application','assistant.schedules']},
  {id:'platform-shell-admission',modules:['platform'],contracts:['browser-model','project-storage','feature-lifecycle'],guarantees:'Every Shell invoke admits only its live trusted main frame before application code; other Renderers, child frames and navigated content are denied.',watch:['packages/platform/src/shell-ipc.ts','packages/platform/src/main.ts','packages/platform/src/preload/shell-preload.cts'],tests:['platform.shell-ipc','driver']},
  {id:'bmw-dsh-assembly',modules:['harness-dsh','application','platform'],contracts:['agent-driver','browser-model'],
    guarantees:'Actual installed DSH startup/authentication, prompt assembly, native lifecycle, harness-owned immutable Workspace mappings and explicit cold history export. Consumes the generic interfaces; does not define Browser or AgentDriver code dependencies.',
    watch:['packages/harness-dsh/','packages/agent-contract/','apps/bmw/','packages/product-bmw/'],tests:['dsh','dsh.project-bindings','dsh.migration-history','agent.data-migration']}
]
