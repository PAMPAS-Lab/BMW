import type {FeatureActivation} from './feature-contract.js'
import type { BrowserActionDefinition } from '@bmw-agent/browser-capability'

export type { BrowserActionDefinition } from '@bmw-agent/browser-capability'

export const PRODUCT_IDS = ['bmw'] as const
export type ProductId = (typeof PRODUCT_IDS)[number]
export type ProductName = 'BMW'

const PRODUCT_NAMES: Readonly<Record<ProductId, ProductName>> = Object.freeze({
  bmw: 'BMW'
})

export interface FeatureModule {
  readonly id: string
  readonly actionNamespace?: string
  readonly browserActions?: readonly BrowserActionDefinition[]
  readonly browserDescription?: string
  readonly main?: FeatureActivation
  readonly renderer?: Readonly<Record<string, unknown>>
}

export interface ProductDefinition {
  readonly id: ProductId
  readonly name: ProductName
  readonly userDataName: string
  readonly sessionPartition: string
  readonly features: readonly FeatureModule[]
}

export interface ResolvedProductDefinition extends ProductDefinition {
  readonly featureIds: readonly string[]
}

/** Validate and freeze the public product-composition contract. */
export function defineProduct(input: ProductDefinition): Readonly<ResolvedProductDefinition> {
  if (!input || typeof input !== 'object') throw new TypeError('Product definition is required.')
  if (!PRODUCT_IDS.includes(input.id)) throw new TypeError(`Unknown BMW product id: ${String(input.id)}`)
  if (input.name !== PRODUCT_NAMES[input.id]) throw new TypeError(`Product ${input.id} must be named ${PRODUCT_NAMES[input.id]}.`)
  if (!input.userDataName || !input.sessionPartition) {
    throw new TypeError('Product name, userDataName, sessionPartition are required.')
  }
  const features = Object.freeze([...(input.features || [])])
  const featureIds = new Set<string>()
  for (const feature of features) {
    if (!feature?.id) throw new TypeError('Every product feature requires an id.')
    if (featureIds.has(feature.id)) throw new TypeError(`Duplicate product feature: ${feature.id}`)
    if (feature.main && typeof feature.main.activate !== 'function') throw new TypeError(`Feature ${feature.id} requires main.activate.`)
    if (feature.actionNamespace !== undefined && (typeof feature.actionNamespace !== 'string' || !feature.actionNamespace.trim())) throw new TypeError(`Feature ${feature.id} requires a nonempty action namespace.`)
    featureIds.add(feature.id)
    const modelTools = (feature as FeatureModule & { tools?: readonly unknown[] }).tools
    if (modelTools?.length) throw new TypeError(`Feature ${feature.id} attempted to register a model tool; only browser actions are allowed.`)
  }
  return Object.freeze({ ...input, features, featureIds: Object.freeze([...featureIds]) })
}

export function hasFeature(product: ResolvedProductDefinition, id: string): boolean {
  return product.featureIds.includes(id)
}

export const productDefinitionInternals = { PRODUCT_IDS, PRODUCT_NAMES }
