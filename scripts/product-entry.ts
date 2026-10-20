import {safeStorage} from 'electron'
import product, {createBmwAgentAssembly} from '../apps/bmw/product.js'
import {createBmwApplication} from '@bmw-agent/platform/application'
createBmwApplication(product,createBmwAgentAssembly({},safeStorage))
