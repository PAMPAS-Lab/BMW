import fs from 'node:fs'
import path from 'node:path'

const ARTIFACT_TOKEN_RE =
  /\b(?:media|preserved|segment|narration|video|speech|source|[0-9a-f]{8}|1[0-9]{12})-[a-zA-Z0-9._-]+\.(?:mp4|webm|wav|mp3|png|jpg|jpeg|webp|vtt|json|txt|bin|ts|m3u8)\b/g

const REDUNDANT_HLS_INTERMEDIATE_RE =
  /^(preserved-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})-(?:\d+-(?:segment|init)\.bin|(?:video|audio(?:-\d+)?)\.ts|original-(?:video|audio)\.mp4)$/

const GC_ELIGIBLE_ORPHAN_RE =
  /^(?:media-[a-f0-9-]+-(?:frame-\d+|drawing)\.png|.*\.source-\d+\.png|media-[a-f0-9-]+-converted\.mp4(?:\.derivation\.json)?|video-[a-f0-9-]+\.json|segment-[a-f0-9-]+\.mp4(?:\.json|\.derivation\.json)?|media-[a-f0-9-]+-(?:speech|audition)\.wav(?:\.derivation\.json)?|narration-[a-f0-9-]+\.wav|speech-[a-f0-9-]+\.json|preserved-[a-f0-9-]+-.*)$/

function collectTokensFromText(text: string, target: Set<string>): void {
  for (const match of text.matchAll(ARTIFACT_TOKEN_RE)) {
    target.add(match[0])
  }
}

function walkMetadataDir(dir: string, onJsonFile: (filePath: string, text: string) => void): void {
  if (!fs.existsSync(dir)) return
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'deleted') continue
      walkMetadataDir(fullPath, onJsonFile)
    } else if (entry.isFile() && (entry.name.endsWith('.json') || entry.name.endsWith('.md'))) {
      try {
        const text = fs.readFileSync(fullPath, 'utf8')
        onJsonFile(fullPath, text)
      } catch {}
    }
  }
}

export interface ArtifactGcSummary {
  removedFiles: number
  freedBytes: number
}

/**
 * Automatically reclaims redundant HLS intermediate segments/tracks and
 * unreferenced orphan intermediate files (frames, segments, WAVs) without
 * mutating draft or export-ledger history.
 */
export function gcProjectArtifacts(
  projectDirectory: string,
  options: { graceWindowMs?: number } = {}
): ArtifactGcSummary {
  const graceWindowMs = options.graceWindowMs ?? 15 * 60 * 1000
  const artifactsDir = path.join(projectDirectory, 'artifacts')
  if (!fs.existsSync(artifactsDir)) return { removedFiles: 0, freedBytes: 0 }
  try {
    if (fs.lstatSync(artifactsDir).isSymbolicLink()) return { removedFiles: 0, freedBytes: 0 }
  } catch {
    return { removedFiles: 0, freedBytes: 0 }
  }

  let removedFiles = 0
  let freedBytes = 0
  const now = Date.now()

  // 1. Collect all referenced artifact tokens across active project metadata
  const referenced = new Set<string>()
  for (const sub of ['video-studio', 'sources', 'library', 'material-index']) {
    walkMetadataDir(path.join(projectDirectory, sub), (_fp, text) => {
      collectTokensFromText(text, referenced)
    })
  }

  // 2. Expand transitive references via sidecars in artifacts/ (.json, .origin.json, .derivation.json)
  const queue = [...referenced]
  const visitedSidecars = new Set<string>()
  while (queue.length > 0) {
    const id = queue.pop()!
    for (const suffix of ['', '.json', '.origin.json', '.derivation.json', '.source-index.json']) {
      const candidate = suffix ? id + suffix : id
      if (!candidate.endsWith('.json') || visitedSidecars.has(candidate)) continue
      visitedSidecars.add(candidate)
      const sidecarPath = path.join(artifactsDir, candidate)
      if (!fs.existsSync(sidecarPath)) continue
      referenced.add(candidate)
      try {
        const text = fs.readFileSync(sidecarPath, 'utf8')
        const before = new Set(referenced)
        collectTokensFromText(text, referenced)
        for (const added of referenced) {
          if (!before.has(added)) queue.push(added)
        }
      } catch {}
    }
  }

  // Also protect direct sidecars of any referenced media file
  for (const id of [...referenced]) {
    for (const suffix of ['.json', '.origin.json', '.derivation.json', '.source-index.json']) {
      referenced.add(id + suffix)
    }
  }

  // 3. Scan artifacts/ and remove redundant HLS intermediates + unreferenced GC-eligible files
  let entries: string[] = []
  try {
    entries = fs.readdirSync(artifactsDir)
  } catch {
    return { removedFiles, freedBytes }
  }
  const entrySet = new Set(entries)

  for (const name of entries) {
    const filePath = path.join(artifactsDir, name)
    let st: fs.Stats
    try {
      st = fs.lstatSync(filePath)
    } catch {
      continue
    }
    if (!st.isFile() || st.isSymbolicLink()) continue

    // Always reclaim redundant HLS intermediate segment.bin / video.ts when delivery.mp4 and preservation proof exist
    const hlsMatch = REDUNDANT_HLS_INTERMEDIATE_RE.exec(name)
    if (hlsMatch && entrySet.has(hlsMatch[1] + '-delivery.mp4') && entrySet.has(hlsMatch[1] + '-0-preservation.json')) {
      try {
        fs.rmSync(filePath, { force: true })
        removedFiles++
        freedBytes += st.size
      } catch {}
      continue
    }

    if (now - st.mtimeMs < graceWindowMs) continue
    if (referenced.has(name)) continue
    if (!GC_ELIGIBLE_ORPHAN_RE.test(name)) continue

    try {
      fs.rmSync(filePath, { force: true })
      removedFiles++
      freedBytes += st.size
    } catch {}
  }

  // 4. Prune stale entries from material-index/catalog.json if any indexed artifact was GC'd
  const materialCatalogPath = path.join(projectDirectory, 'material-index', 'catalog.json')
  if (fs.existsSync(materialCatalogPath)) {
    try {
      const cat = JSON.parse(fs.readFileSync(materialCatalogPath, 'utf8'))
      if (Array.isArray(cat?.records)) {
        const remaining = new Set(fs.readdirSync(artifactsDir))
        const filtered = cat.records.filter(
          (r: { artifactId?: string }) => !r?.artifactId || remaining.has(r.artifactId)
        )
        if (filtered.length !== cat.records.length) {
          cat.records = filtered
          fs.writeFileSync(materialCatalogPath, JSON.stringify(cat, null, 2) + '\n')
        }
      }
    } catch {}
  }

  return { removedFiles, freedBytes }
}
