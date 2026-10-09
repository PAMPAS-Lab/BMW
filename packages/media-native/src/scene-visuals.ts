import type {CompositionScene} from './composition-contract.js'
import type {VisualSegment} from './visual-segments.js'
/** Structural access only: this module can be used by contracts before schema initialization. */
export function sceneVisuals(scene:CompositionScene):(VisualSegment|CompositionScene&{sourceDurationSeconds?:number})[]{return scene.visualSegments??(scene.imageArtifactId||scene.videoArtifactId?[scene]:[])}
