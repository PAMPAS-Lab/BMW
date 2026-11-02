import { ImageDecodeBudget, imageHeader } from '../image-contract.js'
import type { ImageInspection } from '../image-contract.js'

/** Restore light readable paper when a page screenshot captured dark text over the #0a0d12 fallback canvas. */
function normalizeDarkCanvasOverride(context: CanvasRenderingContext2D, width: number, height: number): void {
  if (width < 64 || height < 64) return
  const img = context.getImageData(0, 0, width, height),
    rgba = img.data
  const isBg = (i: number) =>
    Math.abs(rgba[i] - 11) <= 3 && Math.abs(rgba[i + 1] - 12) <= 3 && Math.abs(rgba[i + 2] - 17) <= 3
  const rowBgRatio = new Float32Array(height),
    rowBrightCount = new Uint16Array(height)
  let darkBgTextRows = 0
  const step = Math.max(1, Math.floor(width / 160))
  for (let y = 0; y < height; y++) {
    let bg = 0,
      bright = 0,
      samples = 0
    for (let x = 0; x < width; x += step) {
      samples++
      const i = (y * width + x) * 4
      if (isBg(i)) bg++
      else if (x >= 72 && (rgba[i] + rgba[i + 1] + rgba[i + 2]) / 3 > 140) bright++
    }
    rowBgRatio[y] = bg / samples
    rowBrightCount[y] = bright
    if (rowBgRatio[y] > 0.25 && bright === 0) darkBgTextRows++
  }
  if (darkBgTextRows / height < 0.45) return
  const inPhotoBand = new Uint8Array(height)
  let run = 0
  for (let y = 0; y < height; y++) {
    if (rowBrightCount[y] > 0) run++
    else {
      if (run >= 8) for (let k = y - run; k < y; k++) inPhotoBand[k] = 1
      run = 0
    }
  }
  if (run >= 8) for (let k = height - run; k < height; k++) inPhotoBand[k] = 1
  for (let y = 0; y < height; y++) {
    if (inPhotoBand[y]) continue
    let leftAvatar = 0
    for (let x = 0; x < Math.min(width, 96); x++) {
      const i = (y * width + x) * 4
      if (rgba[i] > 120 || rgba[i + 1] > 120 || rgba[i + 2] > 120) leftAvatar++
    }
    const preserveLeftBadge = leftAvatar >= 4
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      if (preserveLeftBadge && x < 72 && !isBg(i)) continue
      const r = rgba[i],
        g = rgba[i + 1],
        b = rgba[i + 2]
      if (g > r + 25 && g > b + 20) {
        const t = Math.min(1, Math.max(0, (g - 20) / 180))
        rgba[i] = Math.round(248 * (1 - t) + 13 * t)
        rgba[i + 1] = Math.round(250 * (1 - t) + 138 * t)
        rgba[i + 2] = Math.round(252 * (1 - t) + 71 * t)
        continue
      }
      const lum = (r + g + b) / 3
      if (lum < 20) {
        rgba[i] = 248
        rgba[i + 1] = 250
        rgba[i + 2] = 252
      } else if (lum <= 75) {
        const alpha = Math.min(1, (lum - 13) / 28)
        rgba[i] = Math.round(248 * (1 - alpha) + 23 * alpha)
        rgba[i + 1] = Math.round(250 * (1 - alpha) + 37 * alpha)
        rgba[i + 2] = Math.round(252 * (1 - alpha) + 54 * alpha)
      } else {
        const alpha = Math.min(1, (lum - 13) / 140)
        rgba[i] = Math.round(248 * (1 - alpha) + 51 * alpha)
        rgba[i + 1] = Math.round(250 * (1 - alpha) + 65 * alpha)
        rgba[i + 2] = Math.round(252 * (1 - alpha) + 85 * alpha)
      }
    }
  }
  context.putImageData(img, 0, 0)
}

/** Shared inspector/preview/export decoder with admission before allocation. */
export async function decodeProjectImage(
  data: Uint8Array,
  budget: ImageDecodeBudget
): Promise<{ image: HTMLCanvasElement; info: ImageInspection }> {
  const header = imageHeader(data)
  budget.reserve(header.pixels)
  const bitmap = await createImageBitmap(new Blob([data as Uint8Array<ArrayBuffer>], { type: header.contentType }))
  try {
    if (!(
      (bitmap.width === header.width && bitmap.height === header.height) ||
      (bitmap.width === header.height && bitmap.height === header.width)
    ))
      throw new Error('Decoded image dimensions disagree with its header.')
    const image = document.createElement('canvas')
    image.width = bitmap.width
    image.height = bitmap.height
    const context = image.getContext('2d')
    if (!context) throw new Error('Image canvas is unavailable.')
    context.drawImage(bitmap, 0, 0)
    normalizeDarkCanvasOverride(context, bitmap.width, bitmap.height)
    return { image, info: { kind: 'image', ...header, width: bitmap.width, height: bitmap.height, canDecode: true } }
  } finally {
    bitmap.close()
  }
}
