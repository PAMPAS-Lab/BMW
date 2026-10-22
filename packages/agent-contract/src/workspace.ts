export const WORKSPACE_MODES = ['browser', 'library', 'studio'] as const
export type WorkspaceMode = typeof WORKSPACE_MODES[number]
export function assertWorkspaceMode(raw: unknown): WorkspaceMode {
  if (raw !== 'browser' && raw !== 'library' && raw !== 'studio') throw new TypeError('Unknown BMW workspace.')
  return raw
}
