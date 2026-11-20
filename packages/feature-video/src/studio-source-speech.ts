import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { ArtifactJobIO } from '../../media-native/src/artifact-job-io.js'
import { captionAcousticWeight } from '../../media-native/src/composition-contract.js'
import type { CaptionCue } from '../../media-native/src/composition-contract.js'
import { assertSpeechEvidence, speechSourceSegments } from '../../media-native/src/speech-contract.js'
import { exportProjectText } from '../../media-native/src/text-export.js'
import { sceneVisuals, visualPlaybackGroup } from '../../media-native/src/visual-segments.js'
import {
  assertSourceCues,
  projectSourceCues,
  sourceCaptionClock,
  sourceCaptionsStale
} from './studio-source-speech-contract.js'
import { studioAudioHash } from './studio-speech.js'
import type { StudioKernel } from './studio-service.js'
import type { VideoStudioStore } from './studio-store.js'
import type { VideoDraft, StudioScene, StudioRequest } from './studio-contract.js'

export function preserveCaptionTranslations(previous: CaptionCue[] | undefined, projected: CaptionCue[]): CaptionCue[] {
  if (!previous?.length || !previous.some(c => c.translationText !== undefined)) return projected
  return projected.map((cue, idx) => {
    const match =
      previous.find(p => p.text.trim() === cue.text.trim() && p.translationText !== undefined) ??
      (previous.length === projected.length && previous[idx]?.translationText !== undefined ? previous[idx] : undefined)
    if (!match || match.translationText === undefined) return cue
    return {
      ...cue,
      translationText: match.translationText,
      ...(match.translationOrigin ? { translationOrigin: match.translationOrigin } : {})
    }
  })
}

export function alignCaptionsToSourceSpeech(
  scene: StudioScene,
  segmentIndex: number,
  segments: ReturnType<typeof speechSourceSegments>,
  range: { startSeconds: number; endSeconds: number }
): { sourceCues: CaptionCue[]; sceneCaptions: CaptionCue[] } | undefined {
  const group = visualPlaybackGroup(scene, segmentIndex)
  const groupSourceEnd = group.sourceStartSeconds + group.durationSeconds * group.playbackRate
  const winStart = Math.max(range.startSeconds, group.sourceStartSeconds)
  const winEnd = Math.min(range.endSeconds, groupSourceEnd)
  if (winEnd <= winStart + 0.1) return undefined
  const active = segments.filter(
    seg => seg.endSeconds > winStart + 0.04 && seg.startSeconds < winEnd - 0.04 && seg.text.trim().length > 0
  )
  const existing = scene.captions ?? []
  if (!existing.length) {
    if (!active.length) return undefined
    const rawCues: CaptionCue[] = []
    let prevEnd = winStart
    for (const seg of active) {
      const s = Math.max(prevEnd, Math.max(winStart, Math.round(seg.startSeconds * 1000) / 1000))
      const e = Math.min(winEnd, Math.round(seg.endSeconds * 1000) / 1000)
      if (e > s + 0.05) {
        rawCues.push({ startSeconds: s, endSeconds: e, text: seg.text.trim() })
        prevEnd = e
      }
    }
    if (!rawCues.length) return undefined
    return { sourceCues: rawCues, sceneCaptions: projectSourceCues(scene, group.index, rawCues) }
  }
  const speechStart = active.length
    ? Math.max(winStart, Math.min(winStart + 1.2, Math.round(active[0].startSeconds * 1000) / 1000))
    : winStart
  const speechEnd = active.length
    ? Math.min(winEnd, Math.max(winEnd - 1.2, Math.round(active[active.length - 1].endSeconds * 1000) / 1000))
    : winEnd
  const span = Math.max(0.2, speechEnd - speechStart)
  const weights = existing.map((c, idx) => captionAcousticWeight(c.text, idx === existing.length - 1))
  const totalWeight = weights.reduce((sum, w) => sum + w, 0)
  const segBoundaries = active
    .flatMap(seg => [seg.startSeconds, seg.endSeconds])
    .filter(t => t > speechStart + 0.25 && t < speechEnd - 0.25)
  const sourceCues: CaptionCue[] = []
  let cursor = speechStart
  for (let i = 0; i < existing.length; i++) {
    const cue = existing[i]
    const startSeconds = cursor
    let targetEnd =
      i === existing.length - 1
        ? speechEnd
        : Math.round((cursor + (span * weights[i]) / Math.max(1, totalWeight)) * 1000) / 1000
    if (i < existing.length - 1 && segBoundaries.length) {
      let nearest = targetEnd
      let bestDist = 0.65
      for (const b of segBoundaries) {
        const dist = Math.abs(b - targetEnd)
        if (dist < bestDist && b > startSeconds + 0.35 && b < speechEnd - 0.35 * (existing.length - 1 - i)) {
          bestDist = dist
          nearest = Math.round(b * 1000) / 1000
        }
      }
      targetEnd = nearest
    }
    const minRemaining = 0.25 * (existing.length - 1 - i)
    const endSeconds =
      i === existing.length - 1
        ? Math.max(startSeconds + 0.08, speechEnd)
        : Math.max(startSeconds + 0.15, Math.min(speechEnd - minRemaining, targetEnd))
    cursor = endSeconds
    sourceCues.push({
      startSeconds,
      endSeconds,
      text: cue.text,
      ...(cue.translationText !== undefined ? { translationText: cue.translationText } : {}),
      ...(cue.translationOrigin !== undefined ? { translationOrigin: cue.translationOrigin } : {})
    })
  }
  const projected = preserveCaptionTranslations(existing, projectSourceCues(scene, group.index, sourceCues)).map(
    cue => ({
      ...cue,
      startSeconds: Math.round(cue.startSeconds * 1000) / 1000,
      endSeconds: Math.round(cue.endSeconds * 1000) / 1000
    })
  )
  return { sourceCues, sceneCaptions: projected }
}
export async function sourceSpeechOperation(
  kernel: StudioKernel,
  store: VideoStudioStore,
  draft: VideoDraft,
  scene: StudioScene,
  request: StudioRequest,
  directory: string,
  guard: () => void,
  actor: 'user' | 'agent',
  signal?: AbortSignal
): Promise<unknown> {
  const check = () => {
    signal?.throwIfAborted()
    guard()
  }
  if (request.operation === 'set-caption-translations') {
    const cues = scene.captions
    if (!cues?.length) throw new Error('请先生成或编辑独立字幕。')
    const skippedCueIndices: number[] = []
    for (const t of request.translations!) {
      const cue = cues[t.cueIndex]
      if (!cue || cue.text !== t.originalText) throw new Error('STUDIO_CONFLICT: 字幕原文已变化，请重新读取。')
      if (cue.translationOrigin === 'user-edited') {
        skippedCueIndices.push(t.cueIndex)
        continue
      }
      cue.translationText = t.translationText
      cue.translationOrigin = actor === 'user' ? 'user-edited' : 'agent-edited'
    }
    check()
    return {
      draft: store.setSourceSpeech(draft.id, draft.revision, scene.id, s => {
        s.captions = cues
      }),
      skippedCueIndices
    }
  }
  if (request.operation === 'detach-source-captions') {
    check()
    return {
      draft: store.setSourceSpeech(draft.id, draft.revision, scene.id, s => {
        delete s.sourceCaptionBinding
      })
    }
  }
  if (request.operation === 'recognize-source') {
    const segmentIndex = request.segmentIndex ?? 0,
      visual = sceneVisuals(scene)[segmentIndex]
    if (!visual?.videoArtifactId) throw new Error('请选择有原声的视频片段。')
    const id = visual.videoArtifactId,
      sha = await studioAudioHash(directory, id, signal),
      owned = new Map<string, { dev: number; ino: number }>(),
      root = await fs.realpath(directory),
      identity = await fs.lstat(directory),
      before = new Set(await fs.readdir(directory))
    let committed = false
    try {
      check()
      const evidence = assertSpeechEvidence(
        await kernel.recordingController.processArtifact(
          {
            action: 'media.speech.align',
            artifactId: id,
            model: request.speechModel ?? 'base',
            language: request.speechLanguage ?? 'auto',
            ...(request.sourceRange ? { sourceRange: request.sourceRange } : {})
          },
          signal
        )
      )
      for (const [artifactId] of [
        [evidence.normalizedArtifactId, evidence.normalizedSha256],
        [evidence.rawArtifactId, evidence.rawSha256],
        [evidence.logArtifactId, evidence.logSha256]
      ]) {
        const stat = await fs.lstat(path.join(directory, artifactId))
        if (before.has(artifactId) || !stat.isFile() || stat.isSymbolicLink())
          throw new Error('Speech output is not newly owned.')
        owned.set(artifactId, { dev: stat.dev, ino: stat.ino })
      }
      for (const [artifactId, hash] of [
        [evidence.normalizedArtifactId, evidence.normalizedSha256],
        [evidence.rawArtifactId, evidence.rawSha256],
        [evidence.logArtifactId, evidence.logSha256]
      ]) {
        if ((await studioAudioHash(directory, artifactId, signal)) !== hash)
          throw new Error('Source speech evidence changed.')
      }
      if (
        evidence.sourceArtifactId !== id ||
        evidence.sourceSha256 !== sha ||
        (await studioAudioHash(directory, id, signal)) !== sha
      )
        throw new Error('Original source changed during recognition.')
      check()
      const text = JSON.stringify(evidence, null, 2) + '\n',
        output = await exportProjectText(directory, 'json', text, signal, guard),
        stat = await fs.lstat(path.join(directory, output.artifactId))
      owned.set(output.artifactId, { dev: stat.dev, ino: stat.ino })
      check()
      const candidate = {
        sourceArtifactId: id,
        sourceSha256: sha,
        evidenceArtifactId: output.artifactId,
        evidenceSha256: crypto.createHash('sha256').update(text).digest('hex'),
        durationSeconds: evidence.normalization.sourceDurationSeconds ?? evidence.durationSeconds,
        ...(evidence.normalization.sourceRange ? { sourceRange: evidence.normalization.sourceRange } : {}),
        segmentIndex,
        createdAt: new Date().toISOString()
      }
      const updated = store.setSourceSpeech(draft.id, draft.revision, scene.id, s => {
        s.sourceSpeech = candidate
      })
      committed = true
      return {
        draft: updated,
        candidate,
        evidence,
        segments: speechSourceSegments(evidence),
        timeDomain: 'source-file-seconds',
        manualCaptionsPreserved: true,
        automaticTimingApproved: false
      }
    } finally {
      if (!committed) {
        const current = await fs.lstat(directory)
        if (current.dev !== identity.dev || current.ino !== identity.ino || (await fs.realpath(directory)) !== root)
          throw new Error('Source speech cleanup Project changed.')
        for (const [id, stat] of owned) {
          const current = await fs.lstat(path.join(directory, id)).catch(error => {
            if (error.code === 'ENOENT') return undefined
            throw error
          })
          if (current?.dev === stat.dev && current.ino === stat.ino && !current.isSymbolicLink())
            await fs.unlink(path.join(directory, id))
        }
      }
    }
  }
  const candidate = scene.sourceSpeech
  if (!candidate) throw new Error('请先识别当前视频原声。')
  const visual = sceneVisuals(scene)[candidate.segmentIndex],
    stale =
      visual?.videoArtifactId !== candidate.sourceArtifactId ||
      (await studioAudioHash(directory, candidate.sourceArtifactId, signal)) !== candidate.sourceSha256
  const input = await ArtifactJobIO.open(directory, {
    action: 'media.inspect',
    artifactId: candidate.evidenceArtifactId
  })
  let evidence
  try {
    if (input.bytes > 4 * 1024 * 1024 || (await input.fingerprint(signal)) !== candidate.evidenceSha256)
      throw new Error('Original speech evidence changed.')
    const data = new Uint8Array(input.bytes)
    for (let offset = 0; offset < data.length; offset += 1024 * 1024) {
      check()
      data.set(await input.read(offset, Math.min(1024 * 1024, data.length - offset)), offset)
    }
    if (crypto.createHash('sha256').update(data).digest('hex') !== candidate.evidenceSha256)
      throw new Error('Original speech evidence changed during read.')
    evidence = assertSpeechEvidence(JSON.parse(new TextDecoder('utf8', { fatal: true }).decode(data)))
  } finally {
    await input.close()
  }
  if (
    evidence.sourceArtifactId !== candidate.sourceArtifactId ||
    evidence.sourceSha256 !== candidate.sourceSha256 ||
    (evidence.normalization.sourceDurationSeconds ?? evidence.durationSeconds) !== candidate.durationSeconds ||
    JSON.stringify(evidence.normalization.sourceRange) !== JSON.stringify(candidate.sourceRange)
  )
    throw new Error('Original speech evidence does not match its source.')
  check()
  if (request.operation === 'read-source-speech')
    return {
      candidate,
      evidence,
      segments: speechSourceSegments(evidence),
      timeDomain: 'source-file-seconds',
      stale,
      automaticTimingApproved: false
    }
  if (stale) throw new Error('STUDIO_SOURCE_SPEECH_STALE: 原视频已变化，请重新识别。')
  const range = candidate.sourceRange ?? { startSeconds: 0, endSeconds: candidate.durationSeconds },
    reviewed = assertSourceCues(request.sourceCues, candidate.durationSeconds)
  if (reviewed.some(c => c.startSeconds < range.startSeconds || c.endSeconds > range.endSeconds))
    throw new Error('原声字幕超出实际识别区间，请先识别所需区间。')
  const cues = projectSourceCues(scene, candidate.segmentIndex, reviewed)
  if (!cues.length) throw new Error('没有字幕落在当前视频区间。')
  const clock = sourceCaptionClock(scene, candidate.segmentIndex),
    boundIndex = visualPlaybackGroup(scene, candidate.segmentIndex).index,
    boundVisual = scene.visualSegments?.[boundIndex]
  check()
  return {
    draft: store.setSourceSpeech(draft.id, draft.revision, scene.id, s => {
      const mergedCues = preserveCaptionTranslations(s.captions, cues)
      const mergedReviewed = preserveCaptionTranslations(s.captions, reviewed)
      s.captions = mergedCues
      s.captionDisplay = 'bilingual'
      s.sourceCaptionBinding = {
        sourceArtifactId: candidate.sourceArtifactId,
        sourceSha256: candidate.sourceSha256,
        segmentIndex: boundIndex,
        ...(boundVisual?.id ? { visualSegmentId: boundVisual.id } : {}),
        clock,
        origin: actor === 'user' ? 'user-edited' : 'agent-edited',
        sourceCues: mergedReviewed,
        sourceRange: range
      }
    }),
    cueCount: cues.length,
    automaticTimingApproved: false
  }
}

export async function autoAlignSourceSceneCaptions(
  kernel: StudioKernel,
  store: VideoStudioStore,
  draft: VideoDraft,
  scene: StudioScene,
  directory: string,
  guard: () => void,
  actor: 'user' | 'agent',
  signal?: AbortSignal
): Promise<VideoDraft | undefined> {
  if (scene.narration.trim() || !scene.captions?.length) return undefined
  if (scene.sourceCaptionBinding && !sourceCaptionsStale(scene)) return undefined
  const visuals = sceneVisuals(scene)
  const segmentIndex = visuals.findIndex(v => v.keepSourceAudio && v.videoArtifactId)
  if (segmentIndex < 0) return undefined
  const group = visualPlaybackGroup(scene, segmentIndex)
  const groupSourceEnd = group.sourceStartSeconds + group.durationSeconds * group.playbackRate
  const rangeDuration = groupSourceEnd - group.sourceStartSeconds
  if (rangeDuration <= 0.1 || rangeDuration > 180) return undefined
  const sourceRange = {
    startSeconds: Math.max(0, Math.round(group.sourceStartSeconds * 1000) / 1000),
    endSeconds: Math.round(groupSourceEnd * 1000) / 1000
  }
  const recognized = (await sourceSpeechOperation(
    kernel,
    store,
    draft,
    scene,
    {
      operation: 'recognize-source',
      draftId: draft.id,
      expectedRevision: draft.revision,
      sceneId: scene.id,
      segmentIndex: group.index,
      speechModel: 'base',
      speechLanguage: 'auto',
      sourceRange
    },
    directory,
    guard,
    actor,
    signal
  )) as {
    draft: VideoDraft
    candidate: NonNullable<StudioScene['sourceSpeech']>
    segments: ReturnType<typeof speechSourceSegments>
  }
  const updatedScene = recognized.draft.scenes.find(s => s.id === scene.id)
  if (!updatedScene) return recognized.draft
  const aligned = alignCaptionsToSourceSpeech(updatedScene, group.index, recognized.segments, sourceRange)
  if (!aligned || !aligned.sceneCaptions.length) return recognized.draft
  const clock = sourceCaptionClock(updatedScene, group.index)
  const boundVisual = updatedScene.visualSegments?.[group.index]
  return store.setSourceSpeech(recognized.draft.id, recognized.draft.revision, scene.id, s => {
    s.captions = aligned.sceneCaptions
    if (aligned.sceneCaptions.some(c => c.translationText)) s.captionDisplay = 'bilingual'
    s.sourceCaptionBinding = {
      sourceArtifactId: recognized.candidate.sourceArtifactId,
      sourceSha256: recognized.candidate.sourceSha256,
      segmentIndex: group.index,
      ...(boundVisual?.id ? { visualSegmentId: boundVisual.id } : {}),
      clock,
      origin: actor === 'user' ? 'user-edited' : 'agent-edited',
      sourceCues: aligned.sourceCues,
      sourceRange
    }
  })
}
