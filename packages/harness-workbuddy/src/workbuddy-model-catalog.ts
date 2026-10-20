/**
 * BMW pins one official WorkBuddy (CodeBuddy Code) CLI build. The ACP surface
 * is negotiated by protocol version, not by "whatever the user happens to have",
 * so a drifting install cannot silently change the tool catalog or auth methods.
 */
export const workbuddyPinnedCliVersion = '2.169.0'
/** The only ACP protocol version BMW has verified. */
export const workbuddyVerifiedProtocolVersions: readonly number[] = [1]
/** Models BMW will admit. A model present in the account catalog but absent here stays unavailable. */
export const workbuddyModelAllowlist: readonly string[] = [
  'deepseek-v4.1-flash',
  'glm-5.3',
  'glm-5.3-flash',
  'gpt-5.6-luna',
  'gemini-3.5-flash',
]
export function workbuddySupportsProtocolVersion(value: number): boolean {
  return workbuddyVerifiedProtocolVersions.includes(value)
}
export function workbuddyAdmittedModel(model: string): boolean {
  return workbuddyModelAllowlist.includes(model)
}
