#!/usr/bin/env bun

import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

type RuntimeName = 'stock' | 'local'
type ProbeKind = 'registry' | 'updater'
type ExpectedContract = 'fromPlugin' | 'updateMessageAtomic' | 'updateMessage' | 'patchUpdateMessage'
type ProbeStatus = 'resolved' | 'missing' | 'not_callable' | 'callable' | 'invoke_failed'
type ProbeErrorClass = 'module_not_found' | 'export_path_missing' | 'not_callable' | 'invoke_failed' | null

type ProbeEntrySpec = {
  id: string
  kind: ProbeKind
  specifier: string
  exportPath: string
  expectedContract: ExpectedContract
}

type ProbeEntryResult = {
  status: ProbeStatus
  typeof: string
  arity: number
  ownerType: string
  errorClass: ProbeErrorClass
  errorMessage: string | null
}

type ProbeEntryArtifact = ProbeEntrySpec & {
  result: ProbeEntryResult
}

type DiscoveryArtifact = {
  schemaVersion: '1'
  generatedAt: string
  reproducibilityHash: string
  runtime: {
    name: RuntimeName
    binary: string
    reportedVersion: string
  }
  probeMatrixVersion: 'v1'
  entries: ProbeEntryArtifact[]
  negativeControls: Array<{
    specifier: string
    exportPath: string
    status: 'missing' | 'module_not_found'
  }>
  summary: {
    resolvedCount: number
    callableCount: number
    missingCount: number
    invokeFailedCount: number
  }
}

type RuntimeProbeContext = {
  contextDir: string
  localModuleRoots: string[]
}

type WorkerProbeResult = {
  entries: ProbeEntryArtifact[]
  negativeControls: DiscoveryArtifact['negativeControls']
  unexpectedNegativeControlSuccesses: string[]
}

const RUNTIME_BINARIES: Record<RuntimeName, string> = {
  stock: '/home/basil/.opencode/bin/opencode',
  local: '/home/basil/projects/opencode_context_management/opencode/packages/opencode/dist/opencode-linux-x64/bin/opencode'
}

const NEGATIVE_CONTROLS = [
  { specifier: '@opencode-ai/opencode/definitely-not-real', exportPath: 'Nope.missing' },
  { specifier: '@opencode-ai/opencode/tool/registry', exportPath: 'Nope.missing' }
] as const

const PROBE_MATRIX: ProbeEntrySpec[] = [
  { id: 'REG-001', kind: 'registry', specifier: '@opencode-ai/opencode/tool/registry', exportPath: 'PluginToolRegistry.fromPlugin', expectedContract: 'fromPlugin' },
  { id: 'REG-002', kind: 'registry', specifier: '@opencode-ai/opencode/tool/registry', exportPath: 'fromPlugin', expectedContract: 'fromPlugin' },
  { id: 'REG-003', kind: 'registry', specifier: 'opencode/tool/registry', exportPath: 'PluginToolRegistry.fromPlugin', expectedContract: 'fromPlugin' },
  { id: 'REG-004', kind: 'registry', specifier: 'opencode/tool/registry', exportPath: 'fromPlugin', expectedContract: 'fromPlugin' },
  { id: 'UPD-001', kind: 'updater', specifier: '@opencode-ai/opencode/session', exportPath: 'Session.updateMessageAtomic', expectedContract: 'updateMessageAtomic' },
  { id: 'UPD-002', kind: 'updater', specifier: '@opencode-ai/opencode/session/index', exportPath: 'Session.updateMessageAtomic', expectedContract: 'updateMessageAtomic' },
  { id: 'UPD-003', kind: 'updater', specifier: 'opencode/session', exportPath: 'Session.updateMessageAtomic', expectedContract: 'updateMessageAtomic' },
  { id: 'UPD-004', kind: 'updater', specifier: 'opencode/session/index', exportPath: 'Session.updateMessageAtomic', expectedContract: 'updateMessageAtomic' },
  { id: 'UPD-005', kind: 'updater', specifier: '@opencode-ai/opencode/session', exportPath: 'Session.updateMessage', expectedContract: 'updateMessage' },
  { id: 'UPD-006', kind: 'updater', specifier: '@opencode-ai/opencode/session/index', exportPath: 'Session.updateMessage', expectedContract: 'updateMessage' },
  { id: 'UPD-007', kind: 'updater', specifier: 'opencode/session', exportPath: 'Session.updateMessage', expectedContract: 'updateMessage' },
  { id: 'UPD-008', kind: 'updater', specifier: 'opencode/session/index', exportPath: 'Session.updateMessage', expectedContract: 'updateMessage' },
  { id: 'UPD-009', kind: 'updater', specifier: '@opencode-ai/opencode/message-route', exportPath: 'MessageRoute.patchUpdateMessage', expectedContract: 'patchUpdateMessage' },
  { id: 'UPD-010', kind: 'updater', specifier: 'opencode/message-route', exportPath: 'MessageRoute.patchUpdateMessage', expectedContract: 'patchUpdateMessage' }
]

const WORKER_SCRIPT = String.raw`
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const payload = JSON.parse(process.argv[1])

function readNestedValue(target, exportPath) {
  const parts = exportPath.split('.').filter(Boolean)
  if (parts.length === 0) {
    return { owner: undefined, value: undefined }
  }
  let owner = target
  for (let index = 0; index < parts.length - 1; index += 1) {
    owner = owner?.[parts[index]]
  }
  return { owner, value: owner?.[parts[parts.length - 1]] }
}

function isModuleNotFound(error) {
  const code = error && typeof error === 'object' ? error.code : undefined
  if (code === 'ERR_MODULE_NOT_FOUND' || code === 'MODULE_NOT_FOUND') {
    return true
  }
  const message = error instanceof Error ? error.message : String(error)
  return /Cannot find module|Module not found|ResolveMessage: Cannot find module/.test(message)
}

function mapSpecifierSubpath(specifier) {
  const namespacedPrefix = '@opencode-ai/opencode/'
  const unscopedPrefix = 'opencode/'
  if (specifier.startsWith(namespacedPrefix)) return specifier.slice(namespacedPrefix.length)
  if (specifier.startsWith(unscopedPrefix)) return specifier.slice(unscopedPrefix.length)
  return null
}

async function resolveSpecifier(specifier, localModuleRoots) {
  try {
    return await import(specifier)
  } catch (directError) {
    const subpath = mapSpecifierSubpath(specifier)
    if (!subpath || localModuleRoots.length === 0) {
      throw directError
    }

    const paths = []
    for (const root of localModuleRoots) {
      paths.push(path.join(root, subpath + '.ts'))
      paths.push(path.join(root, subpath + '.js'))
      paths.push(path.join(root, subpath, 'index.ts'))
      paths.push(path.join(root, subpath, 'index.js'))
    }

    let fallbackError = directError
    for (const candidate of paths) {
      try {
        return await import(pathToFileURL(candidate).href)
      } catch (error) {
        fallbackError = error
      }
    }
    throw fallbackError
  }
}

function classifyFound(spec, located) {
  const foundType = typeof located.value
  const ownerType = typeof located.owner
  if (foundType !== 'function') {
    return {
      ...spec,
      result: {
        status: 'not_callable',
        typeof: foundType,
        arity: 0,
        ownerType,
        errorClass: 'not_callable',
        errorMessage: 'Resolved export is not callable: ' + spec.specifier + ':' + spec.exportPath
      }
    }
  }

  return {
    ...spec,
    result: {
      status: 'callable',
      typeof: 'function',
      arity: located.value.length,
      ownerType,
      errorClass: null,
      errorMessage: null
    }
  }
}

async function probeEntry(spec, localModuleRoots) {
  let moduleNamespace
  try {
    moduleNamespace = await resolveSpecifier(spec.specifier, localModuleRoots)
  } catch (error) {
    const moduleNotFound = isModuleNotFound(error)
    return {
      ...spec,
      result: {
        status: moduleNotFound ? 'missing' : 'invoke_failed',
        typeof: 'undefined',
        arity: 0,
        ownerType: 'undefined',
        errorClass: moduleNotFound ? 'module_not_found' : 'invoke_failed',
        errorMessage: error instanceof Error ? error.message : String(error)
      }
    }
  }

  const roots = [moduleNamespace, moduleNamespace?.default].filter(root => root !== undefined)
  for (const root of roots) {
    const located = readNestedValue(root, spec.exportPath)
    if (located.value === undefined) continue
    return classifyFound(spec, located)
  }

  return {
    ...spec,
    result: {
      status: 'missing',
      typeof: 'undefined',
      arity: 0,
      ownerType: 'undefined',
      errorClass: 'export_path_missing',
      errorMessage: 'Missing export path: ' + spec.specifier + ':' + spec.exportPath
    }
  }
}

async function run() {
  const entries = []
  for (const spec of payload.probes) {
    entries.push(await probeEntry(spec, payload.localModuleRoots))
  }

  const negativeControls = []
  const unexpectedNegativeControlSuccesses = []
  for (const control of payload.negativeControls) {
    try {
      const namespace = await resolveSpecifier(control.specifier, payload.localModuleRoots)
      const roots = [namespace, namespace?.default].filter(root => root !== undefined)
      const hasPath = roots.some(root => readNestedValue(root, control.exportPath).value !== undefined)
      if (hasPath) {
        unexpectedNegativeControlSuccesses.push(control.specifier + ':' + control.exportPath)
      }
      negativeControls.push({ ...control, status: 'missing' })
    } catch (error) {
      negativeControls.push({
        ...control,
        status: isModuleNotFound(error) ? 'module_not_found' : 'missing'
      })
    }
  }

  process.stdout.write(JSON.stringify({ entries, negativeControls, unexpectedNegativeControlSuccesses }))
}

run().catch(error => {
  process.stderr.write(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
`

export function parseCliArgs(argv: string[]): { runtime: RuntimeName; out: string } {
  let runtime: RuntimeName | undefined
  let out: string | undefined

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--runtime') {
      const value = argv[index + 1]
      if (value === 'stock' || value === 'local') {
        runtime = value
        index += 1
      }
      continue
    }
    if (arg.startsWith('--runtime=')) {
      const value = arg.slice('--runtime='.length)
      if (value === 'stock' || value === 'local') {
        runtime = value
      }
      continue
    }
    if (arg === '--out') {
      const value = argv[index + 1]
      if (value && value.trim().length > 0) {
        out = value
        index += 1
      }
      continue
    }
    if (arg.startsWith('--out=')) {
      const value = arg.slice('--out='.length)
      if (value.trim().length > 0) {
        out = value
      }
    }
  }

  if (!runtime) {
    throw new Error('Missing required --runtime <stock|local>')
  }
  if (!out) {
    throw new Error('Missing required --out <path>')
  }

  return { runtime, out }
}

async function findLocalModuleRoot(binaryPath: string): Promise<string | null> {
  let current = path.dirname(binaryPath)
  const root = path.parse(current).root

  while (current !== root) {
    const candidate = path.join(current, 'packages', 'opencode', 'src')
    if (await Bun.file(path.join(candidate, 'session.ts')).exists()) {
      return candidate
    }
    current = path.dirname(current)
  }

  return null
}

export async function discoverRuntimeProbeContext(runtime: RuntimeName): Promise<RuntimeProbeContext> {
  const binaryPath = RUNTIME_BINARIES[runtime]
  const binDir = path.dirname(binaryPath)
  const installRoot = path.dirname(binDir)
  const discoveredLocalRoot = await findLocalModuleRoot(binaryPath)

  return {
    contextDir: installRoot,
    localModuleRoots: discoveredLocalRoot ? [discoveredLocalRoot] : []
  }
}

export async function runProbeWorker(
  context: RuntimeProbeContext,
  probes: ProbeEntrySpec[],
  negativeControls: Array<{ specifier: string; exportPath: string }>
): Promise<WorkerProbeResult> {
  const payload = JSON.stringify({ probes, negativeControls, localModuleRoots: context.localModuleRoots })
  const proc = Bun.spawn([process.execPath, '-e', WORKER_SCRIPT, payload], {
    cwd: context.contextDir,
    stdout: 'pipe',
    stderr: 'pipe'
  })

  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited
  ])

  if (code !== 0) {
    throw new Error(`runtime probe worker failed: ${(stderr || stdout).trim()}`)
  }

  return JSON.parse(stdout) as WorkerProbeResult
}

export function assertNegativeControls(results: WorkerProbeResult): void {
  if (results.unexpectedNegativeControlSuccesses.length === 0) {
    return
  }
  throw new Error(`Negative control unexpectedly resolved: ${results.unexpectedNegativeControlSuccesses.join(', ')}`)
}

export function summarizeEntries(entries: ProbeEntryArtifact[]): DiscoveryArtifact['summary'] {
  let resolvedCount = 0
  let callableCount = 0
  let missingCount = 0
  let invokeFailedCount = 0

  for (const entry of entries) {
    const status = entry.result.status
    if (status === 'callable') {
      resolvedCount += 1
      callableCount += 1
      continue
    }
    if (status === 'invoke_failed') {
      resolvedCount += 1
      invokeFailedCount += 1
      continue
    }
    if (status === 'not_callable' || status === 'resolved') {
      resolvedCount += 1
      continue
    }
    if (status === 'missing') {
      missingCount += 1
    }
  }

  return { resolvedCount, callableCount, missingCount, invokeFailedCount }
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(item => sortKeysDeep(item))
  }
  if (value && typeof value === 'object') {
    const sorted: Record<string, unknown> = {}
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[key] = sortKeysDeep((value as Record<string, unknown>)[key])
    }
    return sorted
  }
  return value
}

export function computeReproducibilityHash(input: Omit<DiscoveryArtifact, 'generatedAt' | 'reproducibilityHash'>): string {
  const canonical = JSON.stringify(sortKeysDeep(input))
  return createHash('sha256').update(canonical).digest('hex')
}

async function readRuntimeVersion(binaryPath: string): Promise<string> {
  const proc = Bun.spawn([binaryPath, '--version'], { stdout: 'pipe', stderr: 'pipe' })
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited
  ])

  if (code !== 0) {
    const tail = `${stdout}\n${stderr}`.trim()
    throw new Error(`Failed to read runtime version (${binaryPath}): ${tail}`)
  }
  return stdout.trim() || stderr.trim() || 'unknown'
}

export async function discoverRuntimeTargets(runtime: RuntimeName): Promise<DiscoveryArtifact> {
  const context = await discoverRuntimeProbeContext(runtime)
  const binary = RUNTIME_BINARIES[runtime]
  const reportedVersion = await readRuntimeVersion(binary)
  const workerResults = await runProbeWorker(context, PROBE_MATRIX, NEGATIVE_CONTROLS as any)
  assertNegativeControls(workerResults)

  const entries = workerResults.entries
  const negativeControls = workerResults.negativeControls
  const summary = summarizeEntries(entries)
  const reproducibilityHash = computeReproducibilityHash({
    schemaVersion: '1',
    runtime: { name: runtime, binary, reportedVersion },
    probeMatrixVersion: 'v1',
    entries,
    negativeControls,
    summary
  })

  return {
    schemaVersion: '1',
    generatedAt: new Date().toISOString(),
    reproducibilityHash,
    runtime: { name: runtime, binary, reportedVersion },
    probeMatrixVersion: 'v1',
    entries,
    negativeControls,
    summary
  }
}

async function main(): Promise<void> {
  const args = parseCliArgs(process.argv.slice(2))
  const artifact = await discoverRuntimeTargets(args.runtime)

  const outPath = path.resolve(args.out)
  await mkdir(path.dirname(outPath), { recursive: true })
  await writeFile(outPath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8')

  const { resolvedCount, callableCount, missingCount, invokeFailedCount } = artifact.summary
  console.log(`runtime=${artifact.runtime.name} version=${artifact.runtime.reportedVersion} out=${outPath}`)
  console.log(`summary resolved=${resolvedCount} callable=${callableCount} missing=${missingCount} invoke_failed=${invokeFailedCount}`)
  console.log(`reproducibilityHash=${artifact.reproducibilityHash}`)
}

if (import.meta.main) {
  main().catch(error => {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`discover-runtime-targets failed: ${message}`)
    process.exit(1)
  })
}
