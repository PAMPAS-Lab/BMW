export { bmwProduct as default } from '@bmw-agent/product-bmw'
// Retain the legacy driver port for product/storage compatibility; the entry
// supplies the owned Assistant and all official backends through the assembly.
export { dshDriver as agentDriver } from '@bmw-agent/harness-dsh'
export {createBmwAgentAssembly} from './agent-assembly.js'
