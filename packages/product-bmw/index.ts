import { defineProduct } from '@bmw-agent/platform'
import {libraryFeature} from '@bmw-agent/feature-library'
import { videoFeature } from '@bmw-agent/feature-video'
/** Browser is boundary, media is native, web is runtime. */
export const bmwProduct=defineProduct({
 id:'bmw',name:'BMW',userDataName:'BMW',sessionPartition:'persist:bmw',features:[libraryFeature,videoFeature]
})
