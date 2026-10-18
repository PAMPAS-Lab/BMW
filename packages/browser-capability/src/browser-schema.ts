import {assertPageScope} from './page-scope.js'
import type {BrowserActionContext} from './browser-host.js'
export type JsonSchema = Readonly<Record<string, unknown>>

export interface BrowserInputSchema extends JsonSchema {
  readonly type: 'object'
  readonly properties: Readonly<Record<string, JsonSchema>>
  readonly required: readonly string[]
  readonly additionalProperties: boolean
}

export interface BrowserActionDefinition {
  readonly action: string
  readonly description: string
  readonly inputSchema: BrowserInputSchema
  readonly execute?: (context: BrowserActionContext, input: BrowserRequest) => unknown | Promise<unknown>
  readonly help?: (query: BrowserHelpQuery) => unknown
}
export interface BrowserHelpQuery {forOperation?:string;forSubOperation?:string}

export interface BrowserRequest extends Record<string, unknown> {
  action: string
  tabId?: string
}

const tabTarget: Readonly<Record<string, JsonSchema>> = Object.freeze({
  tabId: { type: 'string', description: 'Target tab ID. Omit to use the visible tab.' }
})

function action(action: string, description: string, properties: Readonly<Record<string, JsonSchema>> = {}, required: readonly string[] = []): BrowserActionDefinition {
  return Object.freeze({
    action,
    description,
    inputSchema: Object.freeze({
      type: 'object',
      properties: Object.freeze({ ...tabTarget, ...properties }),
      required: Object.freeze([...required]),
      additionalProperties: false
    })
  })
}

const drawingColor:JsonSchema={type:'string',pattern:'^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$'}
const drawingFill:JsonSchema={type:'string',pattern:'^(none|#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?)$'}
const drawingCoordinate:JsonSchema={type:'number',minimum:0,maximum:16384}
const drawingStyle={color:drawingColor,fill:drawingFill,lineWidth:{type:'number',minimum:1,maximum:64},opacity:{type:'number',minimum:.05,maximum:1}}
const drawingShapes:JsonSchema={type:'array',minItems:1,maxItems:128,description:'Ordered overlay primitives in actual image pixels: x/y are top-left; width/height are sizes; line/arrow use x1/y1 to x2/y2; text wraps to maxWidth; path uses points. Hex colors only. Up to 4096 total path points and 4096 text characters. Redact uses opaque color and opacity=1.',items:{anyOf:[
  {type:'object',additionalProperties:false,required:['type','x','y','width','height'],properties:{...drawingStyle,type:{type:'string',enum:['rect','ellipse','redact']},x:drawingCoordinate,y:drawingCoordinate,width:{type:'number',minimum:1,maximum:16384},height:{type:'number',minimum:1,maximum:16384}}},
  {type:'object',additionalProperties:false,required:['type','x1','y1','x2','y2'],properties:{...drawingStyle,type:{type:'string',enum:['line','arrow']},x1:drawingCoordinate,y1:drawingCoordinate,x2:drawingCoordinate,y2:drawingCoordinate}},
  {type:'object',additionalProperties:false,required:['type','points'],properties:{...drawingStyle,type:{type:'string',const:'path'},points:{type:'array',minItems:2,maxItems:256,items:{type:'object',additionalProperties:false,required:['x','y'],properties:{x:drawingCoordinate,y:drawingCoordinate}}}}},
  {type:'object',additionalProperties:false,required:['type','x','y','text'],properties:{...drawingStyle,type:{type:'string',const:'text'},x:drawingCoordinate,y:drawingCoordinate,text:{type:'string',minLength:1,maxLength:512},fontSize:{type:'number',minimum:8,maximum:128},bold:{type:'boolean'},maxWidth:{type:'number',minimum:1,maximum:16384},background:drawingFill}}
]}}

export const BROWSER_CORE_ACTION_DEFINITIONS: readonly BrowserActionDefinition[] = Object.freeze([
  action('status', 'Inspect the active Project and browser state.'),
  action('help', 'Discover the current authenticated browser action catalog. With forAction, return that exact action description and closed input schema; without it, return the action index. Use after an unknown action or parameter error, then correct the request instead of guessing aliases.', {
    forAction: { type: 'string', maxLength: 200, description: 'Exact action name from the current catalog, for example media.video.capture.' },
    forOperation:{type:'string',maxLength:100,description:'An exact feature operation returned by its help index.'},
    forSubOperation:{type:'string',maxLength:100,description:'An exact nested operation returned by the selected operation help.'}
  }),
  action('tabs.list', 'List tabs owned by the active Project.'),
  action('tabs.open', 'Open or reuse an Agent-owned browser tab.', {
    url: { type: 'string' },
    foreground: { type: 'boolean', description: 'Defaults to false for background work.' },
    reuse: { type: 'boolean', description: 'Defaults to true; reuse an exact URL or suitable same-origin Agent tab.' }
  }, ['url']),
  action('tabs.show', 'Show a Project-owned browser tab.'),
  action('tabs.close', 'Close a Project-owned browser tab.'),
  action('navigate', 'Navigate a Project-owned browser tab.', { url: { type: 'string' } }, ['url']),
  action('back', 'Navigate the target tab backward.'),
  action('forward', 'Navigate the target tab forward.'),
  action('reload', 'Reload the target tab.'),
  action('observe', 'Read visible content in an optional selected body range; exclude recommendation/avatar/promotion selectors explicitly. Reports missing ranges and truncation without falling back to the whole page.', {
    selector: { type: 'string' },
    index: { type: 'number', description: 'Zero-based match when selector identifies multiple page elements.' },
    excludeSelectors:{type:'array',maxItems:16,items:{type:'string',minLength:1,maxLength:500}},
    maxCharacters: { type: 'number' },
    mode: { type: 'string', enum: ['viewport', 'fullpage', 'background', 'observe'] }
  }),
  action('click', 'Click an element by selector or visible text.', {
    selector: { type: 'string' },
    text: { type: 'string' }
  }),
  action('type', 'Type a value into a page element.', {
    selector: { type: 'string' },
    value: { type: 'string' }
  }, ['selector', 'value']),
  action('wait', 'Wait for a bounded duration.', { milliseconds: { type: 'number' } }),
  action('key', 'Dispatch a keyboard key to the target page.', {
    key: { type: 'string' },
    modifiers: { type: 'array', items: { type: 'string' }, description: 'Keyboard modifiers such as shift, control, alt, or meta.' }
  }, ['key']),
  action('hover', 'Hover an element by selector or visible text.', {
    selector: { type: 'string' },
    text: { type: 'string' }
  }),
  action('page.diagnostics', 'Collect page console and network diagnostics and an image screenshot.'),
  action('page.media.list', 'List downloadable images, video sources, posters, and observed media responses within a page or selected element.', {
    selector: { type: 'string' },
    index: { type: 'number', description: 'Zero-based match when selector identifies multiple page elements.' },
    maxItems: { type: 'number', description: 'Maximum media items to return.' },
    excludeSelectors:{type:'array',maxItems:16,items:{type:'string',minLength:1,maxLength:500}}
  }),
  action('page.viewport.set', 'Set the target page viewport.', {
    width: { type: 'number' },
    height: { type: 'number' },
    deviceScaleFactor: { type: 'number' },
    mobile: { type: 'boolean' }
  }),
  action('media.screenshot', 'Return an actual PNG from a Project page. With sourceBinding and the exact collected body selector/index, native URL/text checks bind the page screenshot into that source acquisition as verified image media; no photo or video is required.', {
    mode: { type: 'string', enum: ['viewport', 'fullpage', 'background', 'observe'] },
    selector: { type: 'string' },
    index: { type: 'number', description: 'Zero-based match when selector identifies multiple page elements.' },
    filename: { type: 'string', description: 'Optional Project artifact filename.' },
    sourceBinding:{type:'object',additionalProperties:false,required:['sourceId','acquisitionId','expectedRevision'],properties:{sourceId:{type:'string',pattern:'^[a-zA-Z0-9-]{1,80}$'},acquisitionId:{type:'string',pattern:'^[a-zA-Z0-9-]{1,80}$'},expectedRevision:{type:'integer',minimum:0,maximum:1000000}}}
  }),
  action('media.download', 'Download an HTTP(S) media resource with the BMW browser Session into the active Project artifact store.', {
    url: { type: 'string' },
    filename: { type: 'string', description: 'Optional Project artifact filename.' }
  }, ['url']),
  action('media.preserve','Preserve an observed page HTTP media file or complete unencrypted HLS VOD. Discover URLs with page.media.list (without selector includes observed network manifests). Saves original delivery manifests/segments with SHA256, plus a packet-copy MP4 verified against original encoded payloads and PTS; never claims author upload/master provenance. Highest-bandwidth variant is selected and reported; separate audio retained. Unsupported encryption/live/ranges/alternate tracks fail and roll back. Bounded to 512 MiB, 30 minutes, 2000 segments, two minutes. Network candidates belong to the page, so verify the selected clip visually; use media.frames.sample on delivery file PTS, not capture source time.',{url:{type:'string'}},['url']),
  action('media.video.capture', 'Capture a selected HTML video as WebM: native source frames -> WebCodecs -> verified muxed file PTS, retaining audio. complete only at ended. Adaptive source sizes are contained within the initial output canvas with black letterboxing, never claimed as original resolution/lossless; per-frame source dimensions remain in captureTimeline. captureTimeline maps captured source frames to file PTS, including pauses/rate changes; sample with media.capture.frames.sample. Optional playbackPlan applies bounded pause/rate steps at observed source times, without seeking. Original player state is restored.', {
    selector: { type: 'string' },
    index: { type: 'number', description: 'Zero-based match when selector identifies multiple page elements.' },
    filename: { type: 'string', description: 'Optional Project artifact filename.' },
    fromStart: { type: 'boolean', description: 'Restart finite media at time zero before capture. Defaults to true.' },
    maxDurationMs: { type: 'number', description: 'Safety limit from 1 second to 30 minutes. Defaults to 15 minutes.' },
    playbackPlan:{type:'array',maxItems:16,description:'Optional strictly increasing source-time steps. Apply pauseMs and/or rate at the first observed frame reaching sourceSeconds. No seeking; final receipt records actual play/pause/rate events.',items:{type:'object',additionalProperties:false,required:['sourceSeconds'],properties:{sourceSeconds:{type:'number',minimum:0,maximum:86400},pauseMs:{type:'integer',minimum:1,maximum:10000},rate:{type:'number',minimum:.25,maximum:4}}}}
  }, ['selector']),
  action('media.inspect', 'Read duration, container, video/audio tracks, transparency and decode support of a Project artifact. captureTimeline, when available, provides indexed source-PTS ranges and a media.capture.frames.sample request. durationSeconds and media.frames.sample use the recording-file clock, never source time. No tab, path or URL needed.', {
    artifactId: { type: 'string', description: 'Existing filename ID in the current Project artifact store; never a host path or URL.' }
  }, ['artifactId']),
  action('media.audio.sample','Save a 0.001–10 second Project audio interval as playable PCM16 WAV, retaining native sample rate and channels without gain/resampling. Returns input/output SHA256, file-PTS range, RMS/peak/clipping/missing sample metrics and 100ms windows. Requires exactly one decodable audio track. Technical analysis is not listening: listeningStatus stays not-performed; text/image-only runtimes must not claim to hear it. Use media.audio.preview for user playback controls; speech transcription is separate.',{artifactId:{type:'string',description:'Existing filename ID in the current Project artifact store; never a host path or URL.'},startSeconds:{type:'number',minimum:0,maximum:1800},endSeconds:{type:'number',minimum:.001,maximum:1800}},['artifactId','startSeconds','endSeconds']),
  action('media.audio.preview','Open a bounded Project WAV audition in BMW native media viewer with user playback controls and no autoplay. This does not feed audio to the model or certify a human listened. Requires an idle media controller.',{artifactId:{type:'string',description:'Existing filename ID in the current Project artifact store; never a host path or URL.'}},['artifactId']),
  action('media.frames.sample', 'Extract 1 to 8 PNG frames from a Project video artifact and return them as model images with actual presentation timestamps. Opaque finite local files up to 512 MiB/30 minutes; thumbnails up to 1280x720.', {
    artifactId: { type: 'string', description: 'Existing filename ID in the current Project artifact store; never a host path or URL.' },
    timestampsSeconds: { type: 'array', minItems: 1, maxItems: 8, items: { type: 'number', minimum: 0, maximum: 1800 }, description: 'Requested media timestamps in seconds, within the video track. Actual frame timestamps are returned.' },
    maxWidth: { type: 'integer', minimum: 16, maximum: 1280 },
    maxHeight: { type: 'integer', minimum: 16, maximum: 720 }
  }, ['artifactId', 'timestampsSeconds']),
  action('media.capture.frames.sample','Sample 1 to 8 source times from a Project capture. Version 2 uses a SHA-bound per-frame source-to-file PTS map, decodes the actual recording and verifies returned file PTS; arbitrary captured middle/tail supported through pauses and speed changes. Returns actual source PTS, decoded file PTS, delta and PNG hash. Legacy v1 remains first/tail PNG only. Never interpolate by duration; outside-range or changed artifacts fail.',{
    artifactId:{type:'string',description:'Existing filename ID in the current Project artifact store; never a host path or URL.'},
    sourceTimestampsSeconds:{type:'array',minItems:1,maxItems:8,items:{type:'number',minimum:0,maximum:86400},description:'Requested source media seconds within the indexed ranges. Selects the preceding captured source frame, returns its actual source PTS and verified recording-file PTS (v2); legacy v1 reports file PTS null.'}
  },['artifactId','sourceTimestampsSeconds']),
  action('media.convert', 'Export an opaque Project artifact or timestamp trim to MP4 (H.264/AAC) or WebM (VP9/Opus), optionally resizing. Browser-native WebCodecs capability is checked; unsupported or discarded tracks fail instead of silently losing audio. Finite files up to 512 MiB/30 minutes, two-minute job deadline. Exports are reparsed to return actual duration and tracks; frame boundaries and audio encoder padding may affect duration. Exports do not prove the source capture is complete.', {
    artifactId: { type: 'string', description: 'Existing filename ID in the current Project artifact store; never a host path or URL.' },
    outputFormat: { type: 'string', enum: ['mp4', 'webm'] },
    trimStartSeconds: { type: 'number', minimum: 0, maximum: 1800 },
    trimEndSeconds: { type: 'number', minimum: 0, maximum: 1800 },
    outputWidth: { type: 'integer', minimum: 16, maximum: 3840, description: 'Even pixel width; supply both export dimensions.' },
    outputHeight: { type: 'integer', minimum: 16, maximum: 2160, description: 'Even pixel height; aspect ratio is preserved with letterboxing.' }
  }, ['artifactId', 'outputFormat']),
  action('media.image.inspect', 'Read actual decoded dimensions and format of a current Project static PNG/JPEG/WebP. Input up to 32 MiB/16 megapixels; no tab needed. Use these dimensions for pixel-based annotation.', {
    artifactId:{type:'string',description:'Existing filename ID in the current Project artifact store; never a host path or URL.'}
  },['artifactId']),
  action('media.image.annotate', 'Annotate an existing Project screenshot/image with boxes, ellipses, arrows, lines, freehand paths, text or opaque redaction. Keeps source dimensions and original unchanged. Requires artifactId and shapes. Coordinates use actual image pixels, not CSS viewport units; stay within bounds. Saves a new PNG (20 MiB maximum), returns it as a model image. Read the returned image to verify your marks. No HTML, SVG, scripts or remote images.', {
    artifactId:{type:'string',description:'Existing filename ID in the current Project artifact store; never a host path or URL.'},shapes:drawingShapes
  },['artifactId','shapes']),
  action('media.image.draw', 'Draw a diagram or illustration using native Canvas primitives. Requires width/height (integers 32..4096, at most 8 megapixels) and shapes. Background defaults white; none preserves transparency. Supports rect, ellipse, line, arrow, path, text and redact. Pixel coordinates, hex colors, default red stroke 4px; text default 24px with top-left anchor and wrapping. Shapes and text must fit. Saves a new Project PNG and returns it as a model image. No arbitrary code, SVG, HTML, paths or URLs.', {
    width:{type:'number'},height:{type:'number'},background:drawingFill,shapes:drawingShapes
  },['width','height','shapes']),
  action('media.record.start', 'Start browser-native page recording with bounded page click/scroll/viewport events. Events use recording seconds and viewport CSS pixels; DPR and output mapping are saved in a Project sidecar. Programmatic Agent clicks are marked separately. Pause is unsupported; top-frame navigation continues. No input text or global keyboard capture.', { fps: { type: 'number' } }),
  action('media.record.stop', 'Stop recording and save a Project-owned media artifact and event record. discard=true cancels and removes only this recording and sidecar.', {discard:{type:'boolean'}}),
  action('project.context', 'Read the active Project documents and metadata.'),
  action('project.memory.append', 'Append a provenance-stamped note to Project Memory.', {
    content: { type: 'string', description: 'Text to append to Project memory/tasks.' }
  }, ['content']),
  action('project.tasks.append', 'Append a task to the active Project task document.', {
    content: { type: 'string', description: 'Text to append to Project memory/tasks.' }
  }, ['content']),
  action('schedule.list', 'List daily Agent tasks and recent runs for the active Project.'),
  action('schedule.create', 'Create a persistent daily Agent task in the active Project and Agent Session.', {
    scheduleName: { type: 'string', description: 'Short user-facing task name.' },
    schedulePrompt: { type: 'string', description: 'Complete natural-language instructions to execute at each occurrence.' },
    scheduleTime: { type: 'string', description: 'Local 24-hour time in HH:mm format.' },
    scheduleTimeZone: { type: 'string', description: 'IANA time zone such as Asia/Shanghai.' },
    scheduleEnabled: { type: 'boolean', description: 'Defaults to true.' }
  }, ['scheduleName', 'schedulePrompt', 'scheduleTime', 'scheduleTimeZone']),
  action('schedule.update', 'Update or enable/disable a daily Agent task owned by the active Project.', {
    scheduledTaskId: { type: 'string' },
    scheduleName: { type: 'string', description: 'Short user-facing task name.' },
    schedulePrompt: { type: 'string', description: 'Complete natural-language instructions to execute at each occurrence.' },
    scheduleTime: { type: 'string', description: 'Local 24-hour time in HH:mm format.' },
    scheduleTimeZone: { type: 'string', description: 'IANA time zone such as Asia/Shanghai.' },
    scheduleEnabled: { type: 'boolean', description: 'Defaults to true.' }
  }, ['scheduledTaskId']),
  action('schedule.remove', 'Remove an idle daily Agent task owned by the active Project.', {
    scheduledTaskId: { type: 'string' }
  }, ['scheduledTaskId']),
  action('schedule.run', 'Queue an immediate run of a daily Agent task without changing its next scheduled occurrence.', {
    scheduledTaskId: { type: 'string' }
  }, ['scheduledTaskId'])
])

export const BROWSER_CORE_ACTIONS = Object.freeze(BROWSER_CORE_ACTION_DEFINITIONS.map((definition) => definition.action))
export const BROWSER_ACTIONS = BROWSER_CORE_ACTIONS

function requestError(message:string,allowedActions:readonly string[],definition?:BrowserActionDefinition,fields?:string[]):TypeError {
  return new TypeError(JSON.stringify({code:definition?'BMW_BROWSER_ARGUMENTS_INVALID':'BMW_BROWSER_ACTION_UNSUPPORTED',message,stage:'validation',executed:false,
    ...(fields?{fields:fields.slice(0,16).map(field=>field.slice(0,80))}:{}),
    ...(definition?{action:definition.action,requiredFields:definition.inputSchema.required,acceptedFields:['action',...Object.keys(definition.inputSchema.properties)]}:{supportedActions:allowedActions.slice(0,128)}),
    ...(allowedActions.includes('help')?{recovery:{action:'help',...(definition?{forAction:definition.action}:{})}}:{})}))
}

export function assertBrowserRequest(value: unknown, allowedActions: readonly string[] = BROWSER_CORE_ACTIONS, definitions:readonly BrowserActionDefinition[]=BROWSER_CORE_ACTION_DEFINITIONS): BrowserRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Browser request must be an object.')
  }
  const request = value as Record<string, unknown>
  if (typeof request.action !== 'string' || !allowedActions.includes(request.action)) {
    throw requestError('Unsupported browser action. Use an exact action from supportedActions.',allowedActions)
  }
  const definition=definitions.find(definition=>definition.action===request.action)
  if(definition){
    const unknown=Object.keys(request).filter(key=>key!=='action'&&!Object.hasOwn(definition.inputSchema.properties,key))
    if(unknown.length)throw requestError('Unknown fields for this action; no operation was executed.',allowedActions,definition,unknown)
    const missing=definition.inputSchema.required.filter(key=>request[key]===undefined)
    if(missing.length)throw requestError('Required fields are missing; no operation was executed.',allowedActions,definition,missing)
    const invalid=Object.entries(definition.inputSchema.properties).filter(([key,schema])=>{
      const value=request[key];if(value===undefined)return false
      if(schema.type==='string')return typeof value!=='string'||typeof schema.maxLength==='number'&&value.length>schema.maxLength
      if(schema.type==='number')return typeof value!=='number'||!Number.isFinite(value)
      if(schema.type==='boolean')return typeof value!=='boolean'
      if(schema.type==='array')return !Array.isArray(value)
      if(schema.type==='object')return !value||typeof value!=='object'||Array.isArray(value)
      return false
    }).map(([key])=>key)
    if(invalid.length)throw requestError('Fields have invalid types or bounds; request help for the exact input schema.',allowedActions,definition,invalid)
  }
  if(request.action==='observe'||request.action==='page.media.list')assertPageScope(request)
  return request as BrowserRequest
}

export function targetTabId(request: Readonly<Record<string, unknown>>): string | undefined {
  return typeof request.tabId === 'string' ? request.tabId : undefined
}
