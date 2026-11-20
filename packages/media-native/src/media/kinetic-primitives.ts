/** Deterministic, seek-safe Canvas 2D primitives for BMW native video compositions. */

export interface SpringConfig {
  damping?: number
  stiffness?: number
  mass?: number
}

/** Analytical damped harmonic oscillator mapped to 0..1 without simulation state. */
export function spring(t: number, startTime = 0, cfg: SpringConfig = {}): number {
  const local = t - startTime
  if (local <= 0) return 0
  const damping = cfg.damping ?? 15,
    stiffness = cfg.stiffness ?? 180,
    mass = Math.max(0.1, cfg.mass ?? 1)
  const omega0 = Math.sqrt(stiffness / mass),
    zeta = damping / (2 * Math.sqrt(stiffness * mass))
  let value: number
  if (zeta < 1) {
    const omegaD = omega0 * Math.sqrt(1 - zeta * zeta),
      envelope = Math.exp(-zeta * omega0 * local)
    value = 1 - envelope * (Math.cos(omegaD * local) + ((zeta * omega0) / omegaD) * Math.sin(omegaD * local))
  } else {
    const envelope = Math.exp(-omega0 * local)
    value = 1 - envelope * (1 + omega0 * local)
  }
  return local > 2.5 ? 1 : Math.max(0, Math.min(1.12, value))
}

/** Smooth cubic ease progressing 0..1 across [startTime, startTime + duration]. */
export function easeOutCubic(t: number, startTime = 0, duration = 0.5): number {
  if (t <= startTime) return 0
  const p = Math.max(0, Math.min(1, (t - startTime) / Math.max(0.001, duration)))
  return 1 - Math.pow(1 - p, 3)
}

export interface SwissGridOptions {
  light?: boolean
  gridSpacing?: number
  accentColor?: string
  glowX?: number
  glowY?: number
}

/** Swiss architectural grid backdrop and corner micro-crosshairs drawn with path strokes only. */
export function drawSwissGridBackground(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  opts: SwissGridOptions = {}
): void {
  const spacing = Math.max(24, opts.gridSpacing ?? 48),
    light = Boolean(opts.light),
    lineColor = light ? 'rgba(15, 23, 42, 0.05)' : 'rgba(148, 163, 184, 0.08)',
    crossColor = opts.accentColor ?? (light ? 'rgba(35, 105, 219, 0.35)' : 'rgba(162, 244, 208, 0.35)')
  ctx.save()
  ctx.beginPath()
  ctx.rect(x, y, w, h)
  ctx.clip()
  ctx.strokeStyle = lineColor
  ctx.lineWidth = 1
  ctx.beginPath()
  for (let gx = x + spacing; gx < x + w; gx += spacing) {
    ctx.moveTo(gx, y)
    ctx.lineTo(gx, y + h)
  }
  for (let gy = y + spacing; gy < y + h; gy += spacing) {
    ctx.moveTo(x, gy)
    ctx.lineTo(x + w, gy)
  }
  ctx.stroke()

  const inset = Math.min(18, spacing * 0.4),
    arm = 6
  ctx.strokeStyle = crossColor
  ctx.lineWidth = 1.5
  ctx.beginPath()
  for (const [cx, cy] of [
    [x + inset, y + inset],
    [x + w - inset, y + inset],
    [x + inset, y + h - inset],
    [x + w - inset, y + h - inset]
  ]) {
    ctx.moveTo(cx - arm, cy)
    ctx.lineTo(cx + arm, cy)
    ctx.moveTo(cx, cy - arm)
    ctx.lineTo(cx, cy + arm)
  }
  ctx.stroke()

  if (opts.glowX !== undefined && opts.glowY !== undefined && opts.accentColor) {
    ctx.globalAlpha = light ? 0.08 : 0.14
    ctx.strokeStyle = opts.accentColor
    ctx.lineWidth = 2
    for (const r of [spacing * 1.4, spacing * 2.4]) {
      ctx.beginPath()
      ctx.arc(opts.glowX, opts.glowY, r, 0, Math.PI * 2)
      ctx.stroke()
    }
  }
  ctx.restore()
}

export interface GlowCardOptions {
  radius?: number
  fill?: string
  border?: string
  borderWidth?: number
  accentTop?: string
  accentLeft?: string
}

/** High-contrast rounded panel with crisp border and optional top or left neon accent bar. */
export function drawGlowCard(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  opts: GlowCardOptions = {}
): void {
  const radius = opts.radius ?? 12
  ctx.save()
  ctx.beginPath()
  ctx.roundRect(x, y, w, h, radius)
  ctx.fillStyle = opts.fill ?? '#1e293b'
  ctx.fill()
  if (opts.accentLeft || opts.accentTop) {
    ctx.save()
    ctx.clip()
    if (opts.accentLeft) {
      ctx.fillStyle = opts.accentLeft
      ctx.fillRect(x, y, 5, h)
    }
    if (opts.accentTop) {
      ctx.fillStyle = opts.accentTop
      ctx.fillRect(x, y, w, 4)
    }
    ctx.restore()
  }
  if (opts.border) {
    ctx.beginPath()
    ctx.roundRect(x, y, w, h, radius)
    ctx.strokeStyle = opts.border
    ctx.lineWidth = opts.borderWidth ?? 1.5
    ctx.stroke()
  }
  ctx.restore()
}

/** Directional laser connector with arrowhead and deterministic traveling pulse dot. */
export function drawLaserConnector(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  color: string,
  time: number,
  progress = 1
): void {
  const p = Math.max(0, Math.min(1, progress))
  if (p <= 0) return
  const ex = x1 + (x2 - x1) * p,
    ey = y1 + (y2 - y1) * p,
    angle = Math.atan2(y2 - y1, x2 - x1)
  ctx.save()
  ctx.strokeStyle = color
  ctx.lineWidth = 2.5
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(x1, y1)
  ctx.lineTo(ex, ey)
  ctx.stroke()
  if (p > 0.25) {
    ctx.beginPath()
    ctx.moveTo(ex, ey)
    ctx.lineTo(ex - 10 * Math.cos(angle - 0.4), ey - 10 * Math.sin(angle - 0.4))
    ctx.moveTo(ex, ey)
    ctx.lineTo(ex - 10 * Math.cos(angle + 0.4), ey - 10 * Math.sin(angle + 0.4))
    ctx.stroke()
  }
  if (p >= 0.99) {
    const pulseT = (((time % 1.4) + 1.4) % 1.4) / 1.4,
      px = x1 + (x2 - x1) * pulseT,
      py = y1 + (y2 - y1) * pulseT
    ctx.fillStyle = color
    ctx.globalAlpha = 0.28
    ctx.beginPath()
    ctx.arc(px, py, 6.5, 0, Math.PI * 2)
    ctx.fill()
    ctx.globalAlpha = 0.95
    ctx.beginPath()
    ctx.arc(px, py, 3, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.restore()
}

/** Rounded horizontal highlight wipe bar without issuing fillText calls. */
export function drawHighlightWipe(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  color: string,
  progress: number
): void {
  const width = w * Math.max(0, Math.min(1, progress))
  if (width <= 0.5) return
  ctx.save()
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.roundRect(x, y, width, h, Math.min(h / 2, 4))
  ctx.fill()
  ctx.restore()
}
