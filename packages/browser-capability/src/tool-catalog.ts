import type { BrowserInputSchema } from './browser-schema.js'

export interface BrowserToolCatalog { name: 'browser'; description: string; inputSchema: BrowserInputSchema }
function record(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) }

/** The authenticated catalog is still validated at the MCP process boundary. */
export function browserToolCatalog(value: unknown): BrowserToolCatalog {
  if (!record(value) || value.name !== 'browser' || typeof value.description !== 'string') throw new Error('BMW catalog must describe exactly browser')
  const schema = value.inputSchema
  if (!record(schema) || schema.type !== 'object' || schema.additionalProperties !== false || !record(schema.properties)) throw new Error('Invalid BMW browser input schema')
  const action = schema.properties.action
  if (!record(action) || action.type !== 'string' || !Array.isArray(action.enum) || !action.enum.length || !action.enum.every((name) => typeof name === 'string' && name.length)) throw new Error('Invalid BMW browser action enum')
  if (!Array.isArray(schema.required) || schema.required.length !== 1 || schema.required[0] !== 'action') throw new Error('BMW browser requires action')
  return value as unknown as BrowserToolCatalog
}
