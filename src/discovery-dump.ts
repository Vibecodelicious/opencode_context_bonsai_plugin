import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const KEY_FAMILY_RE = /(tool|registry|session|message|update|plugin)/i
const MAX_DEPTH = 5
const MAX_VISITED = 2000

type RootLabel = 'pluginInitInput' | 'pluginInitClient' | 'toolExecuteContext'

type RuntimeDumpHit = {
  path: string
  kind: string
}

type RuntimeDumpSnapshot = {
  capturedAt: string
  visitedNodes: number
  truncated: boolean
  hits: RuntimeDumpHit[]
}

type RuntimeDumpDocument = {
  schemaVersion: '1'
  roots: Partial<Record<RootLabel, RuntimeDumpSnapshot>>
}

function isDiscoveryEnabled(): boolean {
  const raw = process.env.CONTEXT_BONSAI_DISCOVERY_DUMP
  if (!raw) return false
  const normalized = raw.trim().toLowerCase()
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on'
}

function getOutputPath(): string | null {
  const outputPath = process.env.CONTEXT_BONSAI_DISCOVERY_OUT
  if (!outputPath || outputPath.trim() === '') {
    return null
  }
  return path.resolve(outputPath)
}

function summarizeRoot(value: unknown): RuntimeDumpSnapshot {
  const visited = new Set<unknown>()
  const queue: Array<{ value: unknown; path: string; depth: number }> = [{ value, path: '', depth: 0 }]
  const hits: RuntimeDumpHit[] = []
  let visitedNodes = 0
  let truncated = false

  while (queue.length > 0) {
    const current = queue.shift()!
    visitedNodes += 1
    if (visitedNodes > MAX_VISITED) {
      truncated = true
      break
    }

    const node = current.value
    if (!node || typeof node !== 'object') {
      continue
    }
    if (visited.has(node)) {
      continue
    }
    visited.add(node)

    const keys = Object.keys(node as Record<string, unknown>).sort((a, b) => a.localeCompare(b))
    for (const key of keys) {
      const child = (node as Record<string, unknown>)[key]
      const childPath = current.path ? `${current.path}.${key}` : key
      const isFamilyHit = KEY_FAMILY_RE.test(key) || KEY_FAMILY_RE.test(childPath)
      if (isFamilyHit) {
        hits.push({ path: childPath, kind: typeof child })
      }
      if (current.depth < MAX_DEPTH && child && (typeof child === 'object' || typeof child === 'function')) {
        queue.push({ value: child, path: childPath, depth: current.depth + 1 })
      }
    }
  }

  return {
    capturedAt: new Date().toISOString(),
    visitedNodes,
    truncated,
    hits: hits.slice(0, MAX_VISITED)
  }
}

async function readExistingDocument(filePath: string): Promise<RuntimeDumpDocument> {
  try {
    const parsed = JSON.parse(await readFile(filePath, 'utf8')) as RuntimeDumpDocument
    if (parsed && parsed.schemaVersion === '1' && typeof parsed.roots === 'object') {
      return parsed
    }
  } catch {
    // Ignore read/parse failures and rebuild document.
  }

  return {
    schemaVersion: '1',
    roots: {}
  }
}

export async function captureDiscoveryRoot(label: RootLabel, value: unknown): Promise<void> {
  if (!isDiscoveryEnabled()) {
    return
  }
  const outPath = getOutputPath()
  if (!outPath) {
    return
  }

  const snapshot = summarizeRoot(value)
  const doc = await readExistingDocument(outPath)
  doc.roots[label] = snapshot

  await mkdir(path.dirname(outPath), { recursive: true })
  await writeFile(outPath, `${JSON.stringify(doc, null, 2)}\n`, 'utf8')
}
