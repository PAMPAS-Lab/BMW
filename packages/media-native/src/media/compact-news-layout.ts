import type { CompositionScene, MediaComposition } from '../composition-contract.js'
import { estimatedCaptionCues } from '../composition-contract.js'
import { focusFraming } from '../focus-contract.js'
import { visualAtTime, visualZoom } from '../visual-segments.js'
import { visualEffectFilter } from '../visual-effects.js'
import { withCanvasPaintRole } from './canvas-paint-role.js'
import { paintLoupe } from './loupe-paint.js'
import { readingCrop, speechReadingCrop, paintHighlights } from './card-details-paint.js'
export const COMPACT_NEWS_FONT = '"PingFang SC", "Microsoft YaHei", sans-serif'
const compactZhSegmenter =
  typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function'
    ? new Intl.Segmenter('zh-CN', { granularity: 'word' })
    : null
export interface CompactMeasure {
  font: string
  measureText(text: string): { width: number }
}
export interface CompactBlock {
  lines: string[]
  size: number
  overflow: boolean
}
const measuredBlocks = new WeakMap<CompactMeasure, Map<string, CompactBlock>>()
/** Fixed font, bounded rows, intact Latin tokens; never truncate or shrink to hide overflow. */
export function compactText(
  context: CompactMeasure,
  text: string,
  size: number,
  rows: number,
  width = 640
): CompactBlock {
  const old = context.font
  context.font = `500 ${size}px ${COMPACT_NEWS_FONT}`
  try {
    const cache = measuredBlocks.get(context) ?? new Map<string, CompactBlock>()
    measuredBlocks.set(context, cache)
    const key = JSON.stringify([size, rows, width, text, context.measureText('BMW中文').width]),
      saved = cache.get(key)
    if (saved) return { ...saved, lines: [...saved.lines] }
    const result: string[] = []
    for (const paragraph of text.split(/\r?\n/)) {
      const tokens = paragraph.match(/[A-Za-z][A-Za-z0-9'’.-]*|\d+(?:[.,]\d+)*|[\s\S]/gu) ?? []
      let line = ''
      for (const token of tokens) {
        if (line && context.measureText(line + token).width > width) {
          if (/^[，。！？；：、）】》”’]$/.test(token)) {
            const chars = Array.from(line),
              tail = chars.pop()!
            result.push(chars.join('').trim())
            line = tail + token
          } else {
            result.push(line.trim())
            line = token.trimStart()
          }
        } else line += token
      }
      if (line.trim()) result.push(line.trim())
    }
    // Balance a two-line cue, preferring a clause/word/CJK-Latin boundary and avoiding an orphan.
    if (result.length === 2 && !text.includes('\n')) {
      const tokens = text.match(/[A-Za-z][A-Za-z0-9'’.-]*|\d+(?:[.,]\d+)*|[\s\S]/gu) ?? []
      const multiWordBounds = new Set<number>()
      if (compactZhSegmenter) {
        const parts = Array.from(compactZhSegmenter.segment(text))
        let off = 0
        for (let i = 0; i < parts.length; i++) {
          const cur = parts[i]!,
            nxt = parts[i + 1]
          off += cur.segment.length
          if (nxt && ((cur.isWordLike && cur.segment.length >= 2) || (nxt.isWordLike && nxt.segment.length >= 2))) {
            multiWordBounds.add(off)
          }
        }
      }
      let best = Infinity,
        offset = 0
      for (let at = 1; at < tokens.length; at++) {
        offset += tokens[at - 1]!.length
        const a = tokens.slice(0, at).join('').trim(),
          b = tokens.slice(at).join('').trim(),
          aw = context.measureText(a).width,
          bw = context.measureText(b).width
        if (!a || !b || aw > width || bw > width || /^[，。！？；：、）】》”’]/.test(b) || /[（【《“‘]$/.test(a))
          continue
        const prev = tokens[at - 1] ?? '',
          next = tokens[at] ?? '',
          spaceBoundary = /\s$/.test(prev) || /^\s/.test(next),
          cjkLatinBoundary =
            (/[\u4e00-\u9fff]/.test(prev) && /^[A-Za-z0-9]/.test(next)) ||
            (/[A-Za-z0-9]/.test(prev) && /[\u4e00-\u9fff]/.test(next)),
          punctBoundary = /[，。！？；：、,;!?]$/.test(a),
          wordBoundary = multiWordBounds.has(offset)
        const score =
          Math.abs(aw - bw) +
          (Array.from(b).length < 4 ? width : 0) -
          (punctBoundary ? width * 0.28 : 0) -
          (spaceBoundary ? width * 0.25 : cjkLatinBoundary ? width * 0.25 : wordBoundary ? width * 0.08 : 0)
        if (score < best) {
          best = score
          result[0] = a
          result[1] = b
        }
      }
    }
    const block = {
      lines: result,
      size,
      overflow: result.length > rows || result.some(line => context.measureText(line).width > width)
    }
    if (cache.size >= 512) cache.clear()
    cache.set(key, block)
    return { ...block, lines: [...block.lines] }
  } finally {
    context.font = old
  }
}
export function compactGeometry(aspect = 16 / 9) {
  if (!Number.isFinite(aspect) || aspect < 1)
    throw new Error('STUDIO_COMPACT_MEDIA: 紧凑新闻需要横屏视频；竖屏素材请选择对应版式。')
  const width = Math.min(640, 480 * aspect),
    height = width / aspect,
    media = { x: (720 - width) / 2, y: Math.min(396, 826 - height), width, height },
    captionY = media.y + height + 24,
    englishY = captionY + 112 + 20,
    footerY = englishY + 84 + 22
  return { media, captionY, englishY, footerY, gap: 24, safeBottom: 1152 }
}
export function compactCue(
  context: CompactMeasure,
  cue: NonNullable<CompositionScene['captions']>[number],
  display: CompositionScene['captionDisplay']
) {
  const text = cue.text,
    translation = cue.translationText ?? '',
    translated = Boolean(translation.trim()),
    swapped = translated && /\p{Script=Han}/u.test(text) && !/\p{Script=Han}/u.test(translation),
    primary = swapped ? text : translation,
    secondary = swapped ? translation : text,
    chinese = display === 'original' ? text : translated ? primary : display === 'translation' ? '' : text,
    english = translated && display !== 'translation' && display !== 'original' ? secondary : ''
  return { chinese: compactText(context, chinese, 42, 2), english: compactText(context, english, 30, 2) }
}
/** Native diagrams occupy only the same picture slot; no caption/title overlays. */
export function compactDiagramScene(scene: CompositionScene): boolean {
  if (
    scene.videoArtifactId ||
    scene.imageArtifactId ||
    scene.visualSegments?.length ||
    !scene.label.includes('机制图解')
  )
    return false
  const layers = (scene.layers ?? []).filter(l => !l.hidden && l.opacity > 0),
    diagrams = layers.filter(
      l =>
        l.kind === 'diagram' &&
        l.science &&
        l.startSeconds === 0 &&
        l.durationSeconds >= scene.durationSeconds &&
        l.width * l.height >= 0.2
    ),
    box = compactGeometry().media
  if (diagrams.length !== 1 || layers.some(l => !['diagram', 'rectangle', 'text'].includes(l.kind))) return false
  return layers.every(l =>
    [l, ...(l.keyframes ?? [])].every(k => {
      const x = 'x' in k ? k.x : l.x,
        y = 'y' in k ? k.y : l.y,
        width = 'width' in k ? k.width : l.width,
        height = 'height' in k ? k.height : l.height
      return (
        x * 720 >= box.x - 1 &&
        y * 1280 >= box.y - 1 &&
        (x + width) * 720 <= box.x + box.width + 1 &&
        (y + height) * 1280 <= box.y + box.height + 1
      )
    })
  )
}
export function effectiveCompactTitle(context: CompactMeasure, compositionTitle: string, sceneTitle?: string): string {
  if (compositionTitle && !compactText(context, compositionTitle, 48, 2).overflow) return compositionTitle
  if (sceneTitle && !compactText(context, sceneTitle, 48, 2).overflow) return sceneTitle
  return compositionTitle || sceneTitle || ''
}
export function formatCompactSourceFooter(parts: string[]): string {
  const raw = parts
    .map(part => part.trim())
    .filter(Boolean)
    .join(' · ')
  if (!raw) return ''
  return /^素材来源[：:]/.test(raw)
    ? raw
    : `素材来源：${raw.replace(/^(?:画面来源|资料来源|数据来源|来源)[：:]\s*/, '')}`
}
export function isInterviewScene(
  title?: string,
  sceneTitle?: string,
  sceneLabel?: string,
  watermarkText?: string
): boolean {
  return /深度对话|对话原声|原声交锋|导读锚点|核心小结|收官小结|访谈实录|访谈\[|炉边谈话|Fireside/i.test(
    `${watermarkText ?? ''} ${title ?? ''} ${sceneTitle ?? ''} ${sceneLabel ?? ''}`
  )
}
export function compactSceneIssues(
  context: CompactMeasure,
  scene: CompositionScene,
  title: string,
  narrationDuration: number
): string[] {
  const issues: string[] = [],
    interviewMode = isInterviewScene(title, scene.title, scene.label),
    headerTitle = effectiveCompactTitle(context, title, scene.title),
    label = scene.label.split(/[｜|\n]/),
    head = label.shift() ?? '',
    footer = formatCompactSourceFooter(label)
  if (compactText(context, headerTitle, 48, 2).overflow)
    issues.push('顶层标题 draft.title 超出2行/48px，请在 video.studio configure 中传入简短中文顶层 title（≤22字）。')
  if (compactText(context, head, 30, 1).overflow || compactText(context, footer, 30, 2).overflow)
    issues.push('来源标识或日期超出固定区域；用 label 的｜分隔标识与素材来源及日期。')
  if (interviewMode && scene.bullets.some(b => compactText(context, b, 24, 1, 604).overflow))
    issues.push('访谈伴随条（bullets）单条需控制在1行/24px以内（宽604px）。')
  const nativeDiagram = compactDiagramScene(scene),
    hasImageCard =
      Boolean(scene.imageArtifactId || scene.visualSegments?.some(v => v.imageArtifactId)) &&
      (!scene.cardSpec ||
        ['diagram/image', 'evidence/screenshot', 'evidence/reading', 'evidence/highlight'].includes(
          scene.cardSpec.templateId
        )),
    mediaBox = compactGeometry().media,
    layersInMediaBox = (scene.layers ?? [])
      .filter(l => !l.hidden && l.opacity > 0)
      .every(l =>
        [l, ...(l.keyframes ?? [])].every(k => {
          const x = 'x' in k ? k.x : l.x,
            y = 'y' in k ? k.y : l.y,
            width = 'width' in k ? k.width : l.width,
            height = 'height' in k ? k.height : l.height
          return (
            x * 720 >= mediaBox.x - 2 &&
            y * 1280 >= mediaBox.y - 2 &&
            (x + width) * 720 <= mediaBox.x + mediaBox.width + 2 &&
            (y + height) * 1280 <= mediaBox.y + mediaBox.height + 2
          )
        })
      )
  if (
    (scene.cardSpec && !hasImageCard) ||
    scene.sceneTemplate ||
    (!interviewMode && scene.bullets.length) ||
    (!nativeDiagram && !layersInMediaBox && scene.layers?.some(l => !l.hidden && l.opacity > 0))
  )
    issues.push('紧凑模板自带标题/来源/字幕区；请移除手工卡片和可见叠层，避免覆盖保留区域。')
  if (
    !nativeDiagram &&
    !scene.videoArtifactId &&
    !scene.imageArtifactId &&
    (!scene.visualSegments?.length || scene.visualSegments.some(v => !v.videoArtifactId && !v.imageArtifactId))
  )
    issues.push(
      '紧凑新闻需要实际横屏主视频，或符合原生图解约束的末镜。图解所有可见对象/关键帧须在720×1280画布x40–680、y396–756区域内，至少一个diagram覆盖20%画布；字幕/来源区不可叠层。'
    )
  if (scene.audioArtifactId && !scene.voiceMuted && (scene.voiceVolume ?? 1) > 0 && narrationDuration > 0) {
    const voiceEnd = scene.voiceSegments?.length
      ? Math.max(...scene.voiceSegments.map(s => s.startSeconds + s.durationSeconds))
      : scene.voiceTiming
        ? scene.voiceTiming.startSeconds + scene.voiceTiming.durationSeconds
        : narrationDuration + 0.5
    if (scene.durationSeconds > voiceEnd + 1)
      issues.push(
        `镜头时长（${scene.durationSeconds.toFixed(2)}s）超出旁白结束（${voiceEnd.toFixed(2)}s）过多，会产生明显静音空白；请收紧 durationSeconds（若缩短了字幕请先缩短 captions 再改 scene.durationSeconds，若触发 reference-coverage 则用 prepare-scene-references 刷新参考帧）。`
      )
  }
  for (const [index, cue] of (scene.captions ?? estimatedCaptionCues(scene, 720, 1280, narrationDuration)).entries()) {
    const blocks = compactCue(context, cue, scene.captionDisplay),
      hasForeign =
        /[A-Za-z\u00C0-\u024F\u0400-\u04FF\u3040-\u30FF\uAC00-\uD7AF]{3,}/u.test(cue.text) &&
        !/\p{Script=Han}/u.test(cue.text)
    if (
      (hasForeign &&
        (!cue.translationText?.trim() ||
          scene.captionDisplay === 'original' ||
          scene.captionDisplay === 'translation')) ||
      (cue.translationText?.trim() && (scene.captionDisplay === 'original' || scene.captionDisplay === 'translation'))
    )
      issues.push(
        `字幕${index + 1}为外文原声，须同时显示中文译文（42px）与原始外文（30px）：请提供 cue.text 与 cue.translationText 并保持 captionDisplay="bilingual"。`
      )
    if (blocks.chinese.overflow || blocks.english.overflow)
      issues.push(
        `字幕${index + 1}需按语义和真实句界拆cue：中文42px最多2行，英文30px最多2行，宽640px；保留完整文字，不缩字或隐藏。`
      )
  }
  return issues
}
/** Preview and export share this exact primary-picture/caption geometry. */
export function paintCompactNews(
  context: CanvasRenderingContext2D,
  scene: CompositionScene,
  frame: { canvas: HTMLCanvasElement | OffscreenCanvas } | null,
  time: number,
  narrationDuration: number,
  output: Pick<MediaComposition, 'width' | 'height' | 'title' | 'style' | 'watermark'>,
  onTitle?: (text: string, x: number, y: number, width: number, height: number) => void
): void {
  const nativeDiagram = compactDiagramScene(scene)
  if (!frame && !nativeDiagram) throw new Error('STUDIO_COMPACT_MEDIA: 缺少可解码横屏视频。')
  const visual = visualAtTime(scene, time),
    framing = visual?.segment ?? scene,
    focused = focusFraming(framing, visual?.localSeconds ?? time),
    reading = scene.cardSpec?.version === 2 && 'reading' in scene.cardSpec ? scene.cardSpec.reading : undefined,
    crop =
      scene.cardCues?.some(c => c.kind === 'reading') && reading
        ? speechReadingCrop(reading, framing.imageArtifactId, focused.crop, time, scene.cardCues)
        : reading
          ? readingCrop(
              reading,
              framing.imageArtifactId,
              focused.crop,
              visual?.localSeconds ?? time,
              framing.durationSeconds || scene.durationSeconds
            )
          : focused.crop,
    zoom = reading ? 1 : visualZoom(framing, visual?.localSeconds ?? time),
    baseWidth = frame ? (frame.canvas.width * focused.crop.width) / zoom : 640,
    baseHeight = frame ? (frame.canvas.height * focused.crop.height) / zoom : 360,
    sourceWidth = frame ? (frame.canvas.width * crop.width) / zoom : 640,
    sourceHeight = frame ? (frame.canvas.height * crop.height) / zoom : 360,
    baseLayout = compactGeometry(baseWidth / baseHeight)
  const problems = compactSceneIssues(context, scene, output.title, narrationDuration)
  if (problems.length) throw new Error('STUDIO_TEXT_LAYOUT: ' + problems.join('；'))
  const light = output.style === 'clean-light',
    isInterviewColumn = isInterviewScene(output.title, scene.title, scene.label, output.watermark?.text),
    isWeeklyReview =
      !isInterviewColumn &&
      Boolean(
        output.watermark?.text?.includes('一周') ||
        output.title?.includes('中期选举巨震') ||
        /^(?:0[0-9]|第[一二三四五]幕)[｜|]/.test(scene.title ?? '')
      ),
    layout = isInterviewColumn
      ? {
          ...baseLayout,
          media: { x: baseLayout.media.x, y: 258, width: baseLayout.media.width, height: baseLayout.media.height },
          captionY: 718,
          englishY: 840,
          footerY: 960
        }
      : baseLayout,
    paper = isInterviewColumn ? '#0c0a09' : isWeeklyReview ? '#0f172a' : light ? '#f7f8fa' : '#19212b',
    ink = isInterviewColumn ? '#fafaf9' : isWeeklyReview ? '#f8fafc' : light ? '#172536' : '#edf2f7',
    muted = isInterviewColumn ? '#a8a29e' : isWeeklyReview ? '#94a3b8' : light ? '#586a7e' : '#b4c0cf',
    label = scene.label.split(/[｜|\n]/),
    meta = label.shift() ?? '',
    footer = formatCompactSourceFooter(label)
  context.save()
  try {
    context.scale(output.width / 720, output.height / 1280)
    if (isInterviewColumn) {
      const bgGrad = context.createLinearGradient(0, 0, 0, 1280)
      bgGrad.addColorStop(0, '#0c0a09')
      bgGrad.addColorStop(0.5, '#14110f')
      bgGrad.addColorStop(1, '#090807')
      context.fillStyle = bgGrad
      context.fillRect(0, 0, 720, 1280)
      context.fillStyle = '#10b981'
      context.fillRect(0, 0, 260, 5)
      context.fillStyle = '#f59e0b'
      context.fillRect(260, 0, 460, 5)
    } else if (isWeeklyReview) {
      const bgGrad = context.createLinearGradient(0, 0, 0, 1280)
      bgGrad.addColorStop(0, '#0b1120')
      bgGrad.addColorStop(0.5, '#0f172a')
      bgGrad.addColorStop(1, '#0b1325')
      context.fillStyle = bgGrad
      context.fillRect(0, 0, 720, 1280)
      context.fillStyle = '#f59e0b'
      context.fillRect(0, 0, 720, 5)
    } else {
      context.fillStyle = paper
      context.fillRect(0, 0, 720, 1280)
    }
    context.textBaseline = 'top'
    const draw = (text: string, x: number, y: number, size: number, color: string, weight = 500) => {
      context.font = `${weight} ${size}px ${COMPACT_NEWS_FONT}`
      context.fillStyle = color
      context.fillText(text, x, y)
    }
    if (isInterviewColumn) {
      const wmParts = (output.watermark?.text || '深度对话原声志｜巴伦投资大会 · 2026.11.06').split(/[｜|]/),
        badgeText = (wmParts[0] || '深度对话原声志 · FIRESIDE').trim(),
        rangeText = wmParts.slice(1).join(' · ').trim()
      context.font = `600 22px ${COMPACT_NEWS_FONT}`
      const badgeW = Math.max(200, Math.min(350, Math.ceil(context.measureText(badgeText).width) + 34))
      context.save()
      context.beginPath()
      context.rect(40, 36, badgeW, 40)
      context.fillStyle = 'rgba(16, 185, 129, 0.14)'
      context.fill()
      context.strokeStyle = 'rgba(16, 185, 129, 0.55)'
      context.lineWidth = 1.5
      context.stroke()
      context.beginPath()
      context.rect(40, 36, 5, 40)
      context.fillStyle = '#10b981'
      context.fill()
      context.restore()
      draw(badgeText, 56, 44, 22, '#6ee7b7', 600)
      if (rangeText) {
        context.font = `500 22px ${COMPACT_NEWS_FONT}`
        const rw = context.measureText(rangeText).width
        draw(rangeText, Math.max(40 + badgeW + 14, 680 - rw), 44, 22, '#a8a29e', 500)
      }
      const headerTitle = effectiveCompactTitle(context, output.title, scene.title),
        oneLine = compactText(context, headerTitle, 38, 1)
      if (!oneLine.overflow) {
        const line = oneLine.lines[0] ?? headerTitle
        draw(line, 40, 108, 38, '#fafaf9', 700)
        onTitle?.(line, 40 / 720, 108 / 1280, 640 / 720, 46 / 1280)
      } else {
        const twoLines = compactText(context, headerTitle, 34, 2)
        twoLines.lines.forEach((line, idx) => {
          draw(line, 40, 88 + idx * 44, 34, '#fafaf9', 700)
          onTitle?.(line, 40 / 720, (88 + idx * 44) / 1280, 640 / 720, 42 / 1280)
        })
      }
      const epMatch = /(?:EP\.?\s*0?([1-9])(?:\s*\/\s*0?([1-9]))?|\[0?([1-9])\/0?([1-9])\]|第([1-9])\/([1-9])集)/i.exec(
        `${output.watermark?.text ?? ''} ${output.title ?? ''} ${scene.title ?? ''}`
      )
      if (epMatch) {
        const epIdx = Math.max(1, Number(epMatch[1] || epMatch[3] || epMatch[5] || 1)),
          epTotal = Math.max(epIdx, Number(epMatch[2] || epMatch[4] || epMatch[6] || 5)),
          segGap = 8,
          segW = (640 - segGap * (epTotal - 1)) / epTotal
        for (let i = 0; i < epTotal; i++) {
          const sx = 40 + i * (segW + segGap)
          context.fillStyle =
            i + 1 === epIdx ? '#10b981' : i + 1 < epIdx ? 'rgba(16, 185, 129, 0.42)' : 'rgba(255, 255, 255, 0.14)'
          context.fillRect(sx, 181, segW, 4)
        }
      }
      const isSummaryAudio = /小结|收官|总结/.test(meta) || /小结|收官|总结/.test(scene.title || '')
      const isGuideAudio = !isSummaryAudio && (/导读/.test(meta) || Boolean(scene.narration.trim()))
      context.save()
      context.beginPath()
      context.rect(40, 192, 640, 50)
      context.fillStyle = '#1c1917'
      context.fill()
      context.strokeStyle = 'rgba(245, 158, 11, 0.28)'
      context.lineWidth = 1
      context.stroke()
      context.beginPath()
      context.rect(40, 192, 5, 50)
      context.fillStyle = isSummaryAudio ? '#f59e0b' : isGuideAudio ? '#38bdf8' : '#10b981'
      context.fill()
      context.restore()
      const modeLabel = meta || (isSummaryAudio ? '核心小结' : isGuideAudio ? '中文导读锚点' : '嘉宾同期原声')
      context.font = `600 20px ${COMPACT_NEWS_FONT}`
      const mw = Math.min(180, context.measureText(modeLabel).width + 24),
        actText = (scene.title || meta).trim()
      if (actText) {
        let actSize = 24
        context.font = `600 ${actSize}px ${COMPACT_NEWS_FONT}`
        const maxActW = 654 - mw - 56
        if (context.measureText(actText).width > maxActW) actSize = 21
        draw(actText, 56, actSize === 24 ? 205 : 207, actSize, '#fde68a', 600)
      }
      context.save()
      context.beginPath()
      context.rect(668 - mw, 201, mw, 32)
      context.fillStyle = isSummaryAudio
        ? 'rgba(245, 158, 11, 0.18)'
        : isGuideAudio
          ? 'rgba(56, 189, 248, 0.16)'
          : 'rgba(16, 185, 129, 0.16)'
      context.fill()
      context.strokeStyle = isSummaryAudio
        ? 'rgba(245, 158, 11, 0.52)'
        : isGuideAudio
          ? 'rgba(56, 189, 248, 0.48)'
          : 'rgba(16, 185, 129, 0.48)'
      context.lineWidth = 1
      context.stroke()
      context.restore()
      const fittedMode = compactText(context, modeLabel, 20, 1, mw - 16).lines[0] ?? modeLabel
      draw(fittedMode, 668 - mw + 12, 207, 20, isSummaryAudio ? '#fcd34d' : isGuideAudio ? '#7dd3fc' : '#6ee7b7', 600)
    } else if (isWeeklyReview) {
      const wmParts = (output.watermark?.text || '一周美科技股回顾｜2026.11.02–11.06').split(/[｜|]/),
        badgeText = (wmParts[0] || '一周美科技股回顾').trim(),
        rangeText = (wmParts[1] || '2026.11.02–11.06').trim()
      context.save()
      context.beginPath()
      context.rect(40, 44, 236, 42)
      context.fillStyle = 'rgba(245, 158, 11, 0.16)'
      context.fill()
      context.strokeStyle = 'rgba(245, 158, 11, 0.55)'
      context.lineWidth = 1.5
      context.stroke()
      context.beginPath()
      context.rect(40, 44, 5, 42)
      context.fillStyle = '#f59e0b'
      context.fill()
      context.restore()
      draw(badgeText, 56, 52, 24, '#fbbf24', 600)
      if (rangeText) {
        context.font = `500 24px ${COMPACT_NEWS_FONT}`
        const rw = context.measureText(rangeText).width
        draw(rangeText, Math.max(296, 680 - rw), 52, 24, '#94a3b8', 500)
      }
      const headerTitle = effectiveCompactTitle(context, output.title, scene.title),
        titleFit = compactText(context, headerTitle, 36, 1).overflow
          ? compactText(context, headerTitle, 32, 1)
          : compactText(context, headerTitle, 36, 1),
        titleSize = titleFit.size,
        titleLine = titleFit.lines[0] ?? headerTitle
      draw(titleLine, 40, 106, titleSize, '#f8fafc', 700)
      onTitle?.(titleLine, 40 / 720, 106 / 1280, 640 / 720, 44 / 1280)
      if (scene.title) {
        context.save()
        context.beginPath()
        context.rect(40, 162, 640, 48)
        context.fillStyle = '#1e293b'
        context.fill()
        context.strokeStyle = 'rgba(148, 163, 184, 0.25)'
        context.lineWidth = 1
        context.stroke()
        context.beginPath()
        context.rect(40, 162, 5, 48)
        context.fillStyle = '#38bdf8'
        context.fill()
        context.restore()
        const subLines = compactText(context, scene.title, 28, 1, 608).lines
        if (subLines[0]) draw(subLines[0], 56, 172, 28, '#fde68a', 600)
      }
      const stageMatch = /^0([0-5])/.exec(scene.title ?? ''),
        stageRaw = stageMatch ? Number(stageMatch[1]) : 1,
        activeStage = stageRaw <= 1 ? 0 : Math.min(4, stageRaw - 1),
        segW = (640 - 4 * 10) / 5
      context.save()
      for (let s = 0; s < 5; s++) {
        const sx = 40 + s * (segW + 10),
          isActive = s === activeStage,
          isDone = s < activeStage
        context.beginPath()
        context.rect(sx, isActive ? 226 : 228, segW, isActive ? 8 : 5)
        context.fillStyle = isActive ? '#f59e0b' : isDone ? '#38bdf8' : '#334155'
        context.fill()
      }
      context.restore()
      draw(meta, 40, 274, 28, '#94a3b8', 500)
    } else {
      if (output.watermark?.enabled) {
        context.save()
        context.globalAlpha = output.watermark.opacity
        draw(output.watermark.text, 40, 98, 28, muted, 600)
        context.restore()
      }
      const headerTitle = effectiveCompactTitle(context, output.title, scene.title)
      for (const [index, line] of compactText(context, headerTitle, 48, 2).lines.entries()) {
        draw(line, 40, 152 + index * 60, 48, ink, 700)
        onTitle?.(line, 40 / 720, (152 + index * 60) / 1280, 640 / 720, 58 / 1280)
      }
      if (meta) {
        context.fillStyle = light ? '#2563eb' : '#38bdf8'
        context.fillRect(40, 302, 5, 28)
        draw(meta, 56, 300, 28, light ? '#475569' : muted, 600)
      }
    }
    const m = layout.media
    context.save()
    if (!isInterviewColumn && !isWeeklyReview && frame) {
      context.save()
      context.shadowColor = light ? 'rgba(15, 23, 42, 0.10)' : 'rgba(0, 0, 0, 0.35)'
      context.shadowBlur = 22
      context.shadowOffsetY = 6
      context.fillStyle = light ? '#ffffff' : '#0f172a'
      context.fillRect(m.x, m.y, m.width, m.height)
      context.restore()
    }
    context.filter = visualEffectFilter(framing.effects)
    context.globalAlpha = visual?.opacity ?? 1
    if (frame) {
      context.drawImage(
        frame.canvas,
        frame.canvas.width * crop.x + (frame.canvas.width * crop.width - sourceWidth) / 2,
        frame.canvas.height * crop.y + (frame.canvas.height * crop.height - sourceHeight) / 2,
        sourceWidth,
        sourceHeight,
        m.x,
        m.y,
        m.width,
        m.height
      )
      if (scene.cardSpec?.version === 2 && 'highlights' in scene.cardSpec) {
        context.save()
        context.beginPath()
        context.rect(m.x, m.y, m.width, m.height)
        context.clip()
        paintHighlights(context, scene.cardSpec.highlights, framing.imageArtifactId, time, crop, m, scene.cardCues)
        context.restore()
      }
      if (focused.focus?.mode === 'loupe') {
        context.save()
        context.filter = visualEffectFilter(framing.effects)
        paintLoupe(context, frame.canvas, focused.focus, crop, m, m, focused.strength)
        context.restore()
      }
      if (focused.focus?.emphasize && focused.strength > 0) {
        const fx = m.x + ((focused.focus.x - crop.x) / crop.width) * m.width,
          fy = m.y + ((focused.focus.y - crop.y) / crop.height) * m.height
        context.save()
        context.globalAlpha = (visual?.opacity ?? 1) * focused.strength
        context.strokeStyle = '#ffcc33'
        context.lineWidth = 3
        context.beginPath()
        context.arc(fx, fy, 14, 0, Math.PI * 2)
        context.stroke()
        context.restore()
      }
    }
    if (isInterviewColumn) {
      context.strokeStyle = 'rgba(245, 158, 11, 0.38)'
      context.lineWidth = 1.5
      context.strokeRect(m.x, m.y, m.width, m.height)
      const skipCamBadge = String(framing.videoArtifactId ?? scene.videoArtifactId ?? '').startsWith('minimax-ess-')
      const isHuangNadella = /黄仁勋|纳德拉|Nadella|Huang/i.test(
        `${output.title ?? ''} ${output.watermark?.text ?? ''}`
      )
      const isYanMinimax = /闫俊杰|MiniMax/i.test(`${output.title ?? ''} ${output.watermark?.text ?? ''}`)
      const camLabel = isYanMinimax
          ? Math.abs(crop.width - 0.99) < 0.004
            ? 'CAM A · 闫俊杰视角'
            : Math.abs(crop.width - 0.98) < 0.004
              ? 'CAM B · 劳伦斯视角'
              : 'LIVE CAM · 跨洋专访实录'
          : isHuangNadella
            ? Math.abs(crop.width - 0.99) < 0.004
              ? 'CAM A · 黄仁勋视角'
              : Math.abs(crop.width - 0.98) < 0.004
                ? 'CAM B · 纳德拉视角'
                : 'LIVE CAM · 炉边对谈同框'
            : crop.width > 0.72
              ? 'DUAL CAM · 双人同框'
              : crop.x < 0.25
                ? 'CAM A · 马斯克单人特写'
                : 'CAM B · 巴伦单人特写',
        camDotColor =
          isYanMinimax || isHuangNadella
            ? Math.abs(crop.width - 0.99) < 0.004
              ? '#10b981'
              : Math.abs(crop.width - 0.98) < 0.004
                ? '#38bdf8'
                : '#f59e0b'
            : crop.width > 0.72
              ? '#f59e0b'
              : crop.x < 0.25
                ? '#10b981'
                : '#38bdf8'
      if (!skipCamBadge) {
        context.font = `600 18px ${COMPACT_NEWS_FONT}`
        const cw = context.measureText(camLabel).width + 34
        context.save()
        context.beginPath()
        context.rect(m.x + 12, m.y + 12, cw, 30)
        context.fillStyle = 'rgba(12, 10, 9, 0.78)'
        context.fill()
        context.strokeStyle = 'rgba(245, 158, 11, 0.35)'
        context.lineWidth = 1
        context.stroke()
        context.beginPath()
        context.arc(m.x + 25, m.y + 27, 4.5, 0, Math.PI * 2)
        context.fillStyle = camDotColor
        context.fill()
        context.restore()
        draw(camLabel, m.x + 36, m.y + 17, 18, '#fafaf9', 600)
      }
    } else if (isWeeklyReview) {
      context.strokeStyle = 'rgba(148, 163, 184, 0.3)'
      context.lineWidth = 1.5
      context.strokeRect?.(m.x, m.y, m.width, m.height)
    } else {
      context.strokeStyle = light ? '#cbd5e1' : 'rgba(148, 163, 184, 0.3)'
      context.lineWidth = 1.5
      context.strokeRect?.(m.x, m.y, m.width, m.height)
    }
    context.restore()
    if (isInterviewColumn) {
      let companionText = scene.bullets[0] ?? (scene.title || meta)
      if (scene.bullets.length > 1) {
        if (scene.bulletRevealSeconds?.length === scene.bullets.length) {
          for (let i = 0; i < scene.bullets.length; i++)
            if (time >= (scene.bulletRevealSeconds[i] ?? 0)) companionText = scene.bullets[i]!
        } else if (scene.visualSegments?.length) {
          let acc = 0,
            segIdx = 0
          for (let i = 0; i < scene.visualSegments.length; i++) {
            const d = scene.visualSegments[i]!.durationSeconds || 0
            if (time >= acc) segIdx = i
            acc += d
          }
          const mappedIdx = Math.min(
            scene.bullets.length - 1,
            Math.floor(((segIdx + 0.35) / scene.visualSegments.length) * scene.bullets.length)
          )
          companionText = scene.bullets[mappedIdx] ?? companionText
        } else {
          const idx = Math.min(
            scene.bullets.length - 1,
            Math.floor((time / Math.max(0.1, scene.durationSeconds)) * scene.bullets.length)
          )
          companionText = scene.bullets[idx] ?? companionText
        }
      }
      context.save()
      context.beginPath()
      context.rect(40, 632, 640, 64)
      context.fillStyle = '#181512'
      context.fill()
      context.strokeStyle = 'rgba(16, 185, 129, 0.42)'
      context.lineWidth = 1.2
      context.stroke()
      context.beginPath()
      context.rect(40, 632, 6, 64)
      context.fillStyle = '#10b981'
      context.fill()
      context.restore()
      context.font = `600 24px ${COMPACT_NEWS_FONT}`
      const compW24 = context.measureText(companionText).width
      const compFontSize = compW24 <= 608 ? 24 : compW24 <= 680 ? 21 : 19
      draw(companionText, 58, compFontSize === 24 ? 651 : 653, compFontSize, '#fef3c7', 600)
      context.save()
      context.beginPath()
      context.rect(32, layout.captionY - 12, 656, 232)
      context.fillStyle = 'rgba(28, 25, 23, 0.72)'
      context.fill()
      context.strokeStyle = 'rgba(168, 162, 158, 0.2)'
      context.lineWidth = 1
      context.stroke()
      context.beginPath()
      context.rect(40, layout.footerY - 12, 640, 1.5)
      context.fillStyle = '#292524'
      context.fill()
      context.restore()
    } else if (isWeeklyReview) {
      context.save()
      context.beginPath()
      context.rect(32, layout.captionY - 12, 656, 224)
      context.fillStyle = 'rgba(30, 41, 59, 0.55)'
      context.fill()
      context.strokeStyle = 'rgba(148, 163, 184, 0.16)'
      context.lineWidth = 1
      context.stroke()
      context.beginPath()
      context.rect(40, layout.footerY - 12, 640, 1.5)
      context.fillStyle = '#1e293b'
      context.fill()
      context.restore()
    }
    const cue = (scene.captions ?? estimatedCaptionCues(scene, output.width, output.height, narrationDuration)).find(
      c => time >= c.startSeconds && time < c.endSeconds
    )
    if (cue) {
      const blocks = compactCue(context, cue, scene.captionDisplay)
      withCanvasPaintRole(context, 'caption', () => {
        blocks.chinese.lines.forEach((line, i) => draw(line, 40, layout.captionY + i * 54, 42, ink))
        blocks.english.lines.forEach((line, i) =>
          draw(
            line,
            40,
            layout.englishY + i * 40,
            30,
            isInterviewColumn ? '#d6d3d1' : isWeeklyReview ? '#cbd5e1' : muted
          )
        )
      })
    }
    if (!isInterviewColumn && !isWeeklyReview && footer) {
      context.fillStyle = light ? '#e2e8f0' : 'rgba(148, 163, 184, 0.22)'
      context.fillRect(40, layout.footerY - 14, 640, 1.5)
    }
    compactText(context, footer, 30, 2).lines.forEach((line, i) =>
      draw(line, 40, layout.footerY + i * 34, isInterviewColumn || isWeeklyReview ? 30 : 28, muted)
    )
  } finally {
    context.restore()
  }
}
