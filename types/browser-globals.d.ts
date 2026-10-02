/** Browser globals exposed only by BMW sandboxed preloads and Chromium WebGPU. */
interface Window {
  bmw: Record<string, (...args: any[]) => any>
  bmwMedia: Record<string, (...args: any[]) => any>
  bmwWvl?: Record<string, (...args: any[]) => any>
  __ModuleLoader__?: { load(definition: unknown): void }
}

interface Document {
  querySelector(selectors: string): any
  querySelectorAll(selectors: string): any[]
}

declare const GPUBufferUsage: Record<'STORAGE' | 'COPY_DST' | 'COPY_SRC' | 'MAP_READ', number>
declare const GPUMapMode: Record<'READ', number>
