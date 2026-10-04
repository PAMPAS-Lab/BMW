import { defineProduct } from '@bmw-agent/platform'
import { videoFeature } from '@bmw-agent/feature-video'
/** Browser is boundary, media is native, web is runtime. */
export const bmwProduct=defineProduct({
 id:'bmw',name:'BMW',userDataName:'BMW',sessionPartition:'persist:bmw',features:[videoFeature]
})
