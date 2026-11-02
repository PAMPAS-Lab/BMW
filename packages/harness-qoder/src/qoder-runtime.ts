import type { Options } from '@qodercn-ai/qodercn-agent-sdk'

/** Disable discovery itself; an empty SDK skills allowlist only filters model context. */
export function qoderBrowserRuntimeOptions(): Pick<
  Options,
  'tools' | 'skills' | 'plugins' | 'settingSources' | 'strictMcpConfig' | 'settings'
> {
  return {
    tools: [],
    skills: [],
    plugins: [],
    settingSources: [],
    strictMcpConfig: true,
    settings: { skills: { enabled: false, loadFromAgentsDirectory: false, disableShellExecution: true } }
  }
}
