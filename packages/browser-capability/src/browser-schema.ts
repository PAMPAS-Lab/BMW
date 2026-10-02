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
  readonly execute?: (context: Record<string, any>, input: BrowserRequest) => unknown | Promise<unknown>
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
  action('media.video.capture', 'Save a complete page video as browser-native WebM by recording the selected HTML video stream with MediaRecorder.', {
    selector: { type: 'string' },
    index: { type: 'number', description: 'Zero-based match when selector identifies multiple page elements.' },
    filename: { type: 'string', description: 'Optional Project artifact filename.' },
    fromStart: { type: 'boolean', description: 'Restart finite media at time zero before capture. Defaults to true.' },
    maxDurationMs: { type: 'number', description: 'Safety limit from 1 second to 30 minutes. Defaults to 15 minutes.' }
  }, ['selector']),
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
  action('schedule.create', 'Create a persistent daily Agent task in the active Project and DSH Session.', {
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
