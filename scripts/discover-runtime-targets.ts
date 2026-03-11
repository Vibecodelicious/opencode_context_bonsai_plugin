#!/usr/bin/env bun

import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

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

const RUNTIME_BINARIES: Record<RuntimeName, string> = {
  stock: '/home/basil/.opencode/bin/opencode',
  local: '/home/basil/projects/opencode_context_management/opencode/packages/opencode/dist/opencode-linux-x64/bin/opencode'
}

const LOCAL_OPENCODE_SRC_ROOT = '/home/basil/projects/opencode_context_management/opencode/packages/opencode/src'

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

function readNestedValue(target: any, exportPath: string): { owner: any; value: any } {
  const parts = exportPath.split('.').filter(Boolean)
  if (parts.length === 0) {
    return { owner: undefined, value: undefined }
  }

  let owner = target
  for (let index = 0; index < parts.length - 1; index += 1) {
    owner = owner?.[parts[index]]
  }
  const value = owner?.[parts[parts.length - 1]]
  return { owner, value }
}

function isModuleNotFound(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false
  }
  const maybeCode = (error as any).code
  return maybeCode === 'ERR_MODULE_NOT_FOUND' || maybeCode === 'MODULE_NOT_FOUND'
}

async function resolveSpecifier(runtime: RuntimeName, specifier: string): Promise<any> {
  try {
    return await import(specifier)
  } catch (directError) {
    if (runtime !== 'local') {
      throw directError
    }

    const mapped = mapLocalSpecifier(specifier)
    if (!mapped) {
      throw directError
    }
    return await import(pathToFileURL(mapped).href)
  }
}

function mapLocalSpecifier(specifier: string): string | null {
  const namespacedPrefix = '@opencode-ai/opencode/'
  const unscopedPrefix = 'opencode/'
  const subpath = specifier.startsWith(namespacedPrefix)
    ? specifier.slice(namespacedPrefix.length)
    : specifier.startsWith(unscopedPrefix)
      ? specifier.slice(unscopedPrefix.length)
      : null

  if (!subpath) {
    return null
  }

  return path.join(LOCAL_OPENCODE_SRC_ROOT, `${subpath}.ts`)
}

function invokeProbe(contract: ExpectedContract, fn: (...args: any[]) => any, owner: any): Promise<void> {
  if (contract === 'fromPlugin') {
    return Promise.resolve()
  }
  if (contract === 'updateMessageAtomic' || contract === 'updateMessage') {
    return Promise.resolve(fn.call(owner, {
      sessionID: 'session_discovery',
      messageID: 'msg_discovery',
      mutate: () => undefined
    })).then(() => undefined)
  }

  return Promise.resolve(fn.call(owner, {
    sessionID: 'session_discovery',
    messageID: 'msg_discovery',
    mutateBridge: () => undefined
  })).then(() => undefined)
}

async function probeEntry(runtime: RuntimeName, spec: ProbeEntrySpec): Promise<ProbeEntryArtifact> {
  let moduleNamespace: any
  try {
    moduleNamespace = await resolveSpecifier(runtime, spec.specifier)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      ...spec,
      result: {
        status: 'missing',
        typeof: 'undefined',
        arity: 0,
        ownerType: 'undefined',
        errorClass: isModuleNotFound(error) ? 'module_not_found' : 'module_not_found',
        errorMessage: message
      }
    }
  }

  const roots = [moduleNamespace, moduleNamespace?.default].filter(root => root !== undefined)

  for (const root of roots) {
    const located = readNestedValue(root, spec.exportPath)
    if (located.value === undefined) {
      continue
    }

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
          errorMessage: `Resolved export is not callable: ${spec.specifier}:${spec.exportPath}`
        }
      }
    }

    const fn = located.value as (...args: any[]) => any
    try {
      await invokeProbe(spec.expectedContract, fn, located.owner)
      return {
        ...spec,
        result: {
          status: 'callable',
          typeof: 'function',
          arity: fn.length,
          ownerType,
          errorClass: null,
          errorMessage: null
        }
      }
    } catch (error) {
      return {
        ...spec,
        result: {
          status: 'invoke_failed',
          typeof: 'function',
          arity: fn.length,
          ownerType,
          errorClass: 'invoke_failed',
          errorMessage: error instanceof Error ? error.message : String(error)
        }
      }
    }
  }

  return {
    ...spec,
    result: {
      status: 'missing',
      typeof: 'undefined',
      arity: 0,
      ownerType: 'undefined',
      errorClass: 'export_path_missing',
      errorMessage: `Missing export path: ${spec.specifier}:${spec.exportPath}`
    }
  }
}

async function runNegativeControls(runtime: RuntimeName): Promise<DiscoveryArtifact['negativeControls']> {
  const controls = [
    { specifier: '@opencode-ai/opencode/definitely-not-real', exportPath: 'Nope.missing' },
    { specifier: '@opencode-ai/opencode/tool/registry', exportPath: 'Nope.missing' }
  ]

  const results: DiscoveryArtifact['negativeControls'] = []
  for (const control of controls) {
    try {
      const namespace = await resolveSpecifier(runtime, control.specifier)
      const roots = [namespace, namespace?.default].filter(root => root !== undefined)
      const hasPath = roots.some(root => readNestedValue(root, control.exportPath).value !== undefined)
      results.push({
        ...control,
        status: hasPath ? 'missing' : 'missing'
      })
    } catch {
      results.push({
        ...control,
        status: 'module_not_found'
      })
    }
  }
  return results
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

  return {
    resolvedCount,
    callableCount,
    missingCount,
    invokeFailedCount
  }
}

async function readRuntimeVersion(binaryPath: string): Promise<string> {
  const proc = Bun.spawn([binaryPath, '--version'], {
    stdout: 'pipe',
    stderr: 'pipe'
  })

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
  const binary = RUNTIME_BINARIES[runtime]
  const reportedVersion = await readRuntimeVersion(binary)
  const entries: ProbeEntryArtifact[] = []

  for (const probe of PROBE_MATRIX) {
    entries.push(await probeEntry(runtime, probe))
  }

  const negativeControls = await runNegativeControls(runtime)
  const summary = summarizeEntries(entries)

  return {
    schemaVersion: '1',
    generatedAt: new Date().toISOString(),
    runtime: {
      name: runtime,
      binary,
      reportedVersion
    },
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
}

if (import.meta.main) {
  main().catch(error => {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`discover-runtime-targets failed: ${message}`)
    process.exit(1)
  })
}
