import type {ImageDrawingRequest} from '@bmw-agent/media-native/drawing'
import type {AgentDriver} from '@bmw-agent/agent-contract'
import type {BrowserActionContext,BrowserFeatureHost} from '@bmw-agent/browser-capability/host'
import type {FeatureRuntime} from '@bmw-agent/platform/feature-contract'
import type {FeatureModule} from '@bmw-agent/platform'
import type {NativeMediaPort} from '@bmw-agent/media-native/port'
import {assertMediaArtifactReceipt} from '@bmw-agent/media-native/port'

/** Compile-only negative and positive consumer checks. Never a runtime fixture. */
function publicInterfaces(host:BrowserFeatureHost,driver:AgentDriver,feature:FeatureRuntime,media:NativeMediaPort):void {
  const context:BrowserActionContext={browserKernel:host,actor:'user',signal:new AbortController().signal}
  void driver.createRuntime;void context;void media.processArtifact
  const id:string=assertMediaArtifactReceipt({artifactId:'a.wav',durationSeconds:1}).artifactId;void id
  const drawing:ImageDrawingRequest={action:'media.image.draw',width:320,height:180,background:'#ffffff',shapes:[]};void drawing
  // @ts-expect-error model code cannot replace structured drawing primitives
  const executable:ImageDrawingRequest={action:'media.image.draw',width:320,height:180,background:'#ffffff',shapes:[],script:'draw()'};void executable
  // @ts-expect-error annotations require an existing Project artifact ID
  const outside:ImageDrawingRequest={action:'media.image.annotate',path:'/tmp/image.png',shapes:[]};void outside
  // @ts-expect-error an arbitrary actor cannot enter browser execution
  host.execute({action:'status'},{actor:'shell'})
  // @ts-expect-error a foreign workspace mode is not part of the Feature lifecycle
  feature.setMode?.('terminal')
  // @ts-expect-error a Feature hook is a function, not an open dictionary value
  const badFeature:FeatureModule={id:'bad',main:{activate:42}};void badFeature
  // @ts-expect-error a driver implementation must provide the complete runtime/client contract
  const badDriver:AgentDriver={id:'dsh'};void badDriver
  // @ts-expect-error a media provider cannot omit processing
  const badMedia:NativeMediaPort={compose:media.compose,narrate:media.narrate};void badMedia
}
void publicInterfaces
