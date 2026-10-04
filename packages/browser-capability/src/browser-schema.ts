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
}

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
  action('observe', 'Read the target page structure and visible content.', {
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
    maxItems: { type: 'number', description: 'Maximum media items to return.' }
  }),
  action('page.viewport.set', 'Set the target page viewport.', {
    width: { type: 'number' },
    height: { type: 'number' },
    deviceScaleFactor: { type: 'number' },
    mobile: { type: 'boolean' }
  }),
  action('media.screenshot', 'Return a PNG image to the model and save its metadata in the Session-owned Project. Capture a Project-owned screenshot artifact.', {
    mode: { type: 'string', enum: ['viewport', 'fullpage', 'background', 'observe'] },
    selector: { type: 'string' },
    index: { type: 'number', description: 'Zero-based match when selector identifies multiple page elements.' },
    filename: { type: 'string', description: 'Optional Project artifact filename.' }
  }),
  action('media.download', 'Download an HTTP(S) media resource with the BMW browser Session into the active Project artifact store.', {
    url: { type: 'string' },
    filename: { type: 'string', description: 'Optional Project artifact filename.' }
  }, ['url']),
  action('media.video.capture', 'Record a selected HTML video stream as browser-native WebM with MediaRecorder. The complete flag is true only when playback ends; reaching the duration limit produces a truncated capture.', {
    selector: { type: 'string' },
    index: { type: 'number', description: 'Zero-based match when selector identifies multiple page elements.' },
    filename: { type: 'string', description: 'Optional Project artifact filename.' },
    fromStart: { type: 'boolean', description: 'Restart finite media at time zero before capture. Defaults to true.' },
    maxDurationMs: { type: 'number', description: 'Safety limit from 1 second to 30 minutes. Defaults to 15 minutes.' }
  }, ['selector']),
  action('media.inspect', 'Read duration, container, video/audio tracks, transparency metadata and decode support of a current Project artifact. No tab, file path or URL is needed.', {
    artifactId: { type: 'string', description: 'Existing filename ID in the current Project artifact store; never a host path or URL.' }
  }, ['artifactId']),
  action('media.frames.sample', 'Extract 1 to 8 PNG frames from a Project video artifact and return them as model images with actual presentation timestamps. Opaque finite local files up to 512 MiB/30 minutes; thumbnails up to 1280x720.', {
    artifactId: { type: 'string', description: 'Existing filename ID in the current Project artifact store; never a host path or URL.' },
    timestampsSeconds: { type: 'array', minItems: 1, maxItems: 8, items: { type: 'number', minimum: 0, maximum: 1800 }, description: 'Requested media timestamps in seconds, within the video track. Actual frame timestamps are returned.' },
    maxWidth: { type: 'integer', minimum: 16, maximum: 1280 },
    maxHeight: { type: 'integer', minimum: 16, maximum: 720 }
  }, ['artifactId', 'timestampsSeconds']),
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
  action('media.record.start', 'Start browser-native recording for the target tab.', { fps: { type: 'number' } }),
  action('media.record.stop', 'Stop recording and save a Project-owned media artifact.'),
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

export function assertBrowserRequest(value: unknown, allowedActions: readonly string[] = BROWSER_CORE_ACTIONS): BrowserRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Browser request must be an object.')
  }
  const request = value as Record<string, unknown>
  if (typeof request.action !== 'string' || !allowedActions.includes(request.action)) {
    throw new TypeError(`Unsupported browser action: ${String(request.action)}`)
  }
  return request as BrowserRequest
}

export function targetTabId(request: Readonly<Record<string, unknown>>): string | undefined {
  return typeof request.tabId === 'string' ? request.tabId : undefined
}
