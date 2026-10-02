import { defineProduct } from '@bmw-agent/platform'
import { baseDshDefinition } from '@bmw-agent/harness-dsh'
import { videoFeature } from '@bmw-agent/feature-video'

/** Public BMWVideo foundation; BMW is its product/display name. No Dev imports. */
export const bmwProduct = defineProduct({
  id: 'bmw', name: 'BMW', userDataName: 'BMW', sessionPartition: 'persist:bmw',
  dshPresetId: 'bmw', dsh: baseDshDefinition, features: [videoFeature]
})
