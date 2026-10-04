import {assertBrowserActionContext} from './browser-host.js'
import type {BrowserActionContext} from './browser-host.js'
import { BROWSER_CORE_ACTION_DEFINITIONS } from './browser-schema.js'
import type { BrowserActionDefinition, BrowserInputSchema, BrowserRequest, JsonSchema } from './browser-schema.js'

interface ProductFeatureLike {
  readonly id: string
  readonly browserActions?: readonly BrowserActionDefinition[]
  readonly browserDescription?: string
}

interface ProductLike {
  readonly id: string
  readonly name: string
  readonly features?: readonly ProductFeatureLike[]
}

interface RegisteredBrowserAction extends BrowserActionDefinition {
  readonly owner: string
  readonly execute?: (context: BrowserActionContext, input: BrowserRequest) => unknown | Promise<unknown>
}

/** Build the single browser Tool catalog from the selected product features. */
export class BrowserCapabilityRegistry {
  readonly product: ProductLike
  readonly actions = new Map<string, RegisteredBrowserAction>()
  readonly allowedActions: readonly string[]

  constructor(productDefinition: ProductLike) {
    if (!productDefinition?.id) throw new TypeError('A product definition is required.')
    this.product = productDefinition
    for (const definition of BROWSER_CORE_ACTION_DEFINITIONS) this.register(definition, 'browser-capability')
    for (const feature of productDefinition.features || []) {
      for (const contribution of feature.browserActions || []) {
        this.register(contribution, feature.id)
      }
    }
    this.allowedActions = Object.freeze([...this.actions.keys()])
  }

  register(definition: BrowserActionDefinition, owner: string): void {
    const action = definition?.action
    if (!action || typeof action !== 'string') throw new TypeError(`Feature ${owner} contributed an invalid browser action.`)
    if (!definition.description || typeof definition.description !== 'string') throw new TypeError(`Browser action ${action} requires a description.`)
    if (!definition.inputSchema || typeof definition.inputSchema !== 'object') throw new TypeError(`Browser action ${action} requires an input schema.`)
    const previousOwner = this.actions.get(action)?.owner
    if (previousOwner) throw new Error(`Browser action ${action} is registered by both ${previousOwner} and ${owner}.`)
    this.actions.set(action, Object.freeze({
      action,
      owner,
      inputSchema: definition.inputSchema,
      description: String(definition.description || ''),
      ...(typeof definition.execute === 'function' ? { execute: definition.execute } : {})
    }))
  }

  ownerOf(action: string): string | null {
    return this.actions.get(action)?.owner || null
  }

  definition(action: string): RegisteredBrowserAction | null {
    return this.actions.get(action) || null
  }

  async execute(action: string, context: unknown, input: BrowserRequest): Promise<{ handled: boolean; value: unknown }> {
    const definition = this.actions.get(action)
    if (!definition?.execute) return { handled: false, value: undefined }
    return { handled: true, value: await definition.execute(assertBrowserActionContext(context), input) }
  }

  snapshot(): Readonly<{ productId: string; actions: readonly string[]; owners: Record<string, string> }> {
    return Object.freeze({ productId: this.product.id, actions: this.allowedActions, owners: Object.fromEntries([...this.actions].map(([action, definition]) => [action, definition.owner])) })
  }

  inputSchema(): BrowserInputSchema {
    const properties: Record<string, JsonSchema> = {
      action: { type: 'string', enum: this.allowedActions }
    }
    for (const definition of this.actions.values()) {
      for (const [name, schema] of Object.entries(definition.inputSchema?.properties || {})) {
        const previous = properties[name]
        if (previous && JSON.stringify(previous) !== JSON.stringify(schema)) {
          throw new Error(`Browser input property ${name} has conflicting schemas in ${definition.owner}.`)
        }
        properties[name] = schema as JsonSchema
      }
    }
    return {
      type: 'object',
      properties,
      required: ['action'],
      additionalProperties: false
    }
  }

  toolDefinition(): { name: 'browser'; description: string; inputSchema: BrowserInputSchema } {
    const fragments = (this.product.features || []).map((feature) => feature.browserDescription).filter(Boolean)
    const base = `The only ${this.product.name} model capability. Search, inspect, navigate, interact with, capture, record, and analyze tabs owned by the active Project, usually in the background. Use media.inspect, media.frames.sample, and media.convert for Project-owned video/audio artifacts; sampled PNGs are returned as images and conversion preserves all supported tracks or fails. Use media.image.inspect to measure Project images, media.image.annotate for screenshot markup, and media.image.draw for diagrams and drawings. These bounded Canvas actions save a new Project PNG and return it as an image; shapes use actual image pixels and preserve the original. No Shell, unrestricted filesystem, or external browser tool is available.`
    return {
      name: 'browser',
      description: [base, ...fragments].join(' '),
      inputSchema: this.inputSchema()
    }
  }
}
