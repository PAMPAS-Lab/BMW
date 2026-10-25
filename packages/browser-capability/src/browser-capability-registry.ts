import {assertBrowserActionContext} from './browser-host.js'
import {compactToolSchema} from './tool-schema-compaction.js'
import type {BrowserActionContext} from './browser-host.js'
import { assertBrowserRequest, BROWSER_CORE_ACTION_DEFINITIONS } from './browser-schema.js'
import type { BrowserActionDefinition, BrowserInputSchema, BrowserRequest, JsonSchema, BrowserHelpQuery } from './browser-schema.js'

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
      ,...(typeof definition.help==='function'?{help:definition.help}:{})
    }))
  }

  ownerOf(action: string): string | null {
    return this.actions.get(action)?.owner || null
  }

  definition(action: string): RegisteredBrowserAction | null {
    return this.actions.get(action) || null
  }

  assertRequest(value:unknown):BrowserRequest { return assertBrowserRequest(value,this.allowedActions,[...this.actions.values()]) }

  help(forAction?:string,query:BrowserHelpQuery={}):unknown {
    if(!forAction&&(query.forOperation!==undefined||query.forSubOperation!==undefined))throw new TypeError('Feature operation help requires forAction.')
    if(forAction!==undefined){
      const definition=this.definition(forAction)
      if(!definition)throw new TypeError(JSON.stringify({code:'BMW_BROWSER_ACTION_UNSUPPORTED',message:'Unknown help target; use an exact action from supportedActions.',stage:'validation',executed:false,supportedActions:this.allowedActions,recovery:{action:'help'}}))
      if(definition.help)return definition.help(query)
      if(query.forOperation!==undefined||query.forSubOperation!==undefined)throw new TypeError('This action has no nested operation; use its closed input schema.')
      return {action:definition.action,description:definition.description,inputSchema:{...definition.inputSchema,properties:{action:{const:definition.action},...definition.inputSchema.properties},required:['action',...definition.inputSchema.required]}}
    }
    return {tool:'browser',actions:[...this.actions.values()].map(definition=>({action:definition.action,description:definition.description.slice(0,160),requiredFields:definition.inputSchema.required})),next:{action:'help',forAction:'observe'}}
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
      additionalProperties: false,
      // Shared field schemas remain at the root; each branch preserves the
      // owning action's description, required fields and closed field set.
      oneOf: [...this.actions.values()].map(definition => ({
        type: 'object',
        description: definition.description,
        properties: {
          ...Object.fromEntries(Object.keys(definition.inputSchema.properties).map(name => [name, {}])),
          action: { const: definition.action }
        },
        required: ['action', ...definition.inputSchema.required],
        additionalProperties: false
      }))
    }
  }

  toolDefinition(): { name: 'browser'; description: string; inputSchema: BrowserInputSchema } {
    // Feature overviews sometimes concatenate the exact action descriptions
    // already retained in schema branches. Publish that text only once.
    const actionDescriptions=[...this.actions.values()].map(action=>action.description).join(' ')
    const fragments = (this.product.features || []).map((feature) => feature.browserDescription).filter((text):text is string=>Boolean(text)&&!actionDescriptions.includes(text!))
    const base = `The only ${this.product.name} model capability. Search, inspect, navigate, interact with, capture, record, and analyze tabs owned by the active Project, usually in the background. Use the schema branch matching action: fields belonging to other actions are not accepted. Use media.inspect, media.frames.sample, and media.convert for Project-owned video/audio artifacts; sampled PNGs are returned as images and conversion preserves all supported tracks or fails. Use media.image.inspect to measure Project images. media.image.draw creates a new canvas and requires width, height and shapes; do not pass artifactId or filename. Example: {"action":"media.image.draw","width":320,"height":180,"shapes":[{"type":"text","x":20,"y":20,"text":"Diagram","color":"#172536"}]}. media.image.annotate marks an existing image and requires artifactId and shapes; do not pass width, height or filename. Example: {"action":"media.image.annotate","artifactId":"existing.png","shapes":[{"type":"rect","x":10,"y":10,"width":50,"height":30}]}. Both save a new Project PNG and return it as an image; shapes use actual image pixels and preserve the original. Parameter validation errors do not mean a primitive is unsupported; correct the named fields before retrying. No Shell, unrestricted filesystem, or external browser tool is available.`
    return {
      name: 'browser',
      description: ['Start with {"action":"observe"} to read the current page, or {"action":"tabs.list"} for Project tabs. Discover actions with {"action":"help"}; get exact fields with {"action":"help","forAction":"media.video.capture"}. Only names in the action enum exist. Unknown-action/argument failures return a recovery request and executed:false; inspect that contract and correct fields, never add guessed parameters. Long-media workflow: page.media.list -> media.preserve streams complete HTTP/HLS delivery to a Project archive (4 GiB/six hours, no decoded playback) -> media.inspect verifies metadata -> media.segment creates local bounded packet-copy work units with source SHA/time mapping -> decode, transcribe and sample those units. Do not use a thirty-minute decoding limit to reject complete download, and do not silently substitute short capture for a full source. YouTube direct or supported SABR tracks use bound default audio; SABR requires a same-player native POST witness and verified complete tracks. Website attestation rejection, unavailable witnesses and signature-only delivery fail explicitly; storage budgets do not certify long-video site coverage. media.audio.sample saves bounded playable WAV and technical evidence; media.audio.preview opens user controls with no autoplay. These do not certify that the active model heard audio.',base, ...fragments].join(' '),
      inputSchema: compactToolSchema(this.inputSchema())
    }
  }
}
