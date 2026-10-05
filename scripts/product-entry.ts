import product, { agentDriver, createBmwAgentAssembly } from '../apps/bmw/product.js'
import { createBmwApplication } from '@bmw-agent/platform/application'
createBmwApplication(product,agentDriver,createBmwAgentAssembly())
