import product, { agentDriver } from '../apps/bmw/product.js'
import { createBmwApplication } from '@bmw-agent/platform/application'
createBmwApplication(product,agentDriver)
