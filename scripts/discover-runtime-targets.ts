#!/usr/bin/env bun

import { createHash } from 'node:crypto'
import { mkdir, realpath, writeFile } from 'node:fs/promises'
import path from 'node:path'

type RuntimeName = 'stock' | 'local'
type ProbeKind = 'registry' | 'updater'
type ExpectedContract = 'fromPlugin' | 'updateMessageAtomic' | 'updateMessage' | 'patchUpdateMessage'
type ProbeStatus = 'resolved' | 'missing' | 'not_callable' | 'callable' | 'invoke_failed'
type ProbeErrorClass = 'module_not_found' | 'export_path_missing' | 'not_callable' | 'invoke_failed' | null
type CandidateSourceType = 'bundle-symbol' | 'runtime-object-path' | 'import-resolvable'
type ValidationState = 'validated' | 'rejected' | 'inconclusive'
type DecisionGateStatus = 'READY_FOR_INJECTION_IMPL' | 'DISCOVERY_INCOMPLETE'
type BlockerCode =
  | 'missing_registry_target'
  | 'missing_updater_target'
  | 'registry_confidence_below_threshold'
  | 'updater_confidence_below_threshold'
  | 'registry_rejected'
  | 'updater_rejected'

type RequiredClass = 'registry' | 'updater'

type InspectionEvidenceRecord = {
  source: 'command' | 'file' | 'runtime'
  ref: string
  snippet: string
  order: number
}

type CandidateFinding = {
  kind: RequiredClass
  sourceType: CandidateSourceType
  compatSource: 'object-path' | 'module'
  logicalTargetKey: string
  identifier: string
  evidence: string
  confidence: number
  validationState: ValidationState
  validationReason: string
}

type DecisionGate = {
  status: DecisionGateStatus
  blockerCodes: BlockerCode[]
}

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
  evidence?: string
  resolution?: 'direct_import' | 'local_root_fallback' | 'not_resolved'
  attemptedPaths?: string[]
}

type ProbeEntryArtifact = ProbeEntrySpec & {
  result: ProbeEntryResult
}

type DiscoveryArtifact = {
  schemaVersion: '2'
  generatedAt: string
  reproducibilityHash: string
  inspectionCommands: string[]
  inspectionEnvironment: {
    cwd: string
    runtimeName: RuntimeName
    runtimeBinary: string
  }
  inspectionEvidence: InspectionEvidenceRecord[]
  runtime: {
    name: RuntimeName
    binary: string
    reportedVersion: string
  }
  probeMatrixVersion: 'v1'
  entries: ProbeEntryArtifact[]
  candidateFindings: CandidateFinding[]
  decisionGate: DecisionGate
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
  diagnostics: Array<{
    level: 'info' | 'warn'
    code: string
    message: string
  }>
}

type RuntimeProbeContext = {
  contextDir: string
  localModuleRoots: string[]
}

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
  roots: Partial<Record<'pluginInitInput' | 'pluginInitClient' | 'toolExecuteContext', RuntimeDumpSnapshot>>
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

const REQUIRED_CLASS_THRESHOLD = 0.8

const SOURCE_PRECEDENCE: CandidateSourceType[] = ['runtime-object-path', 'import-resolvable', 'bundle-symbol']

const EXACT_TOKEN_REGEX: Record<ExpectedContract, RegExp> = {
  fromPlugin: /\bfromPlugin\b/,
  updateMessageAtomic: /\bupdateMessageAtomic\b/,
  updateMessage: /\bupdateMessage\b/,
  patchUpdateMessage: /\bpatchUpdateMessage\b/
}

const SUPPORTING_TOKEN_REGEX = /\b(ToolRegistry|Session|MessageRoute)\b/

export function normalizeSnippet(input: string): string {
  return input.replace(/\s+/g, ' ').trim().slice(0, 240)
}

function makeEvidenceRecord(
  source: InspectionEvidenceRecord['source'],
  ref: string,
  snippet: string,
  order: number
): InspectionEvidenceRecord {
  return {
    source,
    ref,
    snippet: normalizeSnippet(snippet),
    order
  }
}

async function runInspectionCommand(command: string, cwd: string): Promise<{ command: string; output: string }> {
  const proc = Bun.spawn(['sh', '-lc', command], {
    cwd,
    stdout: 'pipe',
    stderr: 'pipe'
  })
  const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()])
  const output = `${stdout}\n${stderr}`.trim()
  return { command, output }
}

function mapExportPathToLogicalTarget(pathName: string): string | null {
  if (pathName.endsWith('fromPlugin')) return 'registry:fromPlugin'
  if (pathName.endsWith('updateMessageAtomic')) return 'updater:updateMessageAtomic'
  if (pathName.endsWith('patchUpdateMessage')) return 'updater:patchUpdateMessage'
  if (pathName.endsWith('updateMessage')) return 'updater:updateMessage'
  return null
}

function sourceCompatSource(source: CandidateSourceType): 'object-path' | 'module' {
  return source === 'import-resolvable' ? 'module' : 'object-path'
}

function baseConfidence(sourceType: CandidateSourceType): number {
  if (sourceType === 'runtime-object-path') return 0.9
  if (sourceType === 'import-resolvable') return 0.8
  return 0.5
}

function clampConfidence(value: number): number {
  return Math.max(0, Math.min(1, Number(value.toFixed(2))))
}

function compareSourcePrecedence(a: CandidateSourceType, b: CandidateSourceType): number {
  return SOURCE_PRECEDENCE.indexOf(a) - SOURCE_PRECEDENCE.indexOf(b)
}

type RawCandidate = {
  kind: RequiredClass
  sourceType: CandidateSourceType
  logicalTargetKey: string
  identifier: string
  evidence: string
  exactTokenMatch: boolean
  partialPathMatch: boolean
  adapterSimulationRan: boolean
  adapterSimulationPassed: boolean
  validationState: ValidationState
  validationReason: string
}

function scoreCandidate(candidate: RawCandidate, corroborated: boolean): number {
  let score = baseConfidence(candidate.sourceType)
  if (candidate.adapterSimulationRan && candidate.adapterSimulationPassed) {
    score += 0.05
  }
  if (!candidate.exactTokenMatch) {
    score -= 0.2
  }
  if (candidate.partialPathMatch) {
    score -= 0.1
  }
  if (corroborated) {
    score += 0.05
  }
  return clampConfidence(score)
}

export function dedupeAndRankCandidates(raw: RawCandidate[]): CandidateFinding[] {
  const grouped = new Map<string, RawCandidate[]>()
  for (const candidate of raw) {
    const list = grouped.get(candidate.logicalTargetKey) ?? []
    list.push(candidate)
    grouped.set(candidate.logicalTargetKey, list)
  }

  const findings: CandidateFinding[] = []
  for (const [logicalTargetKey, candidates] of grouped.entries()) {
    const sorted = [...candidates].sort((left, right) => {
      const precedence = compareSourcePrecedence(left.sourceType, right.sourceType)
      if (precedence !== 0) return precedence
      return right.identifier.localeCompare(left.identifier)
    })
    const strongest = sorted[0]
    const corroborated = sorted.some(candidate => compareSourcePrecedence(candidate.sourceType, strongest.sourceType) > 0)
    findings.push({
      kind: strongest.kind,
      sourceType: strongest.sourceType,
      compatSource: sourceCompatSource(strongest.sourceType),
      logicalTargetKey,
      identifier: strongest.identifier,
      evidence: strongest.evidence,
      confidence: scoreCandidate(strongest, corroborated),
      validationState: strongest.validationState,
      validationReason: strongest.validationReason
    })
  }

  findings.sort((left, right) => {
    if (left.kind !== right.kind) return left.kind.localeCompare(right.kind)
    const precedence = compareSourcePrecedence(left.sourceType, right.sourceType)
    if (precedence !== 0) return precedence
    return right.confidence - left.confidence
  })

  return findings
}

export function buildImportResolvableCandidates(entries: ProbeEntryArtifact[]): RawCandidate[] {
  const candidates: RawCandidate[] = []
  for (const entry of entries) {
    const logicalTargetKey = mapExportPathToLogicalTarget(entry.exportPath)
    if (!logicalTargetKey) continue

    const isCallable = entry.result.status === 'callable'
    const isTerminalRejected = entry.result.status === 'not_callable' || entry.result.status === 'invoke_failed'
    if (!isCallable && !isTerminalRejected) {
      continue
    }

    const adapterSimulationRan = entry.expectedContract === 'fromPlugin' && (isCallable || entry.result.status === 'invoke_failed')
    const adapterSimulationPassed = entry.expectedContract === 'fromPlugin' && isCallable

    const exactMatch = EXACT_TOKEN_REGEX[entry.expectedContract].test(entry.exportPath)
    candidates.push({
      kind: entry.kind,
      sourceType: 'import-resolvable',
      logicalTargetKey,
      identifier: `${entry.specifier}:${entry.exportPath}`,
      evidence: entry.result.evidence ?? `${entry.result.status}:${entry.result.errorClass ?? 'none'}`,
      exactTokenMatch: exactMatch,
      partialPathMatch: false,
      adapterSimulationRan,
      adapterSimulationPassed,
      validationState: isCallable ? 'validated' : 'rejected',
      validationReason: isCallable ? 'callable_shape_match' : entry.result.errorClass ?? 'probe_failed'
    })
  }
  return candidates
}

export function extractBundleTextCandidates(lines: string[]): RawCandidate[] {
  const joined = lines.join('\n')
  const hasSupportTokens = SUPPORTING_TOKEN_REGEX.test(joined)
  const candidates: RawCandidate[] = []

  const bundleMatches: Array<{ key: string; token: ExpectedContract; kind: RequiredClass }> = [
    { key: 'registry:fromPlugin', token: 'fromPlugin', kind: 'registry' },
    { key: 'updater:updateMessageAtomic', token: 'updateMessageAtomic', kind: 'updater' },
    { key: 'updater:updateMessage', token: 'updateMessage', kind: 'updater' },
    { key: 'updater:patchUpdateMessage', token: 'patchUpdateMessage', kind: 'updater' }
  ]

  for (const match of bundleMatches) {
    const exact = EXACT_TOKEN_REGEX[match.token].test(joined)
    if (!exact && !hasSupportTokens) {
      continue
    }

    candidates.push({
      kind: match.kind,
      sourceType: 'bundle-symbol',
      logicalTargetKey: match.key,
      identifier: `bundle-token:${match.token}`,
      evidence: exact ? `exact token found: ${match.token}` : `supporting token found near expected symbol: ${match.token}`,
      exactTokenMatch: exact,
      partialPathMatch: !exact,
      adapterSimulationRan: false,
      adapterSimulationPassed: false,
      validationState: exact ? 'rejected' : 'inconclusive',
      validationReason: exact ? 'textual_match_only_not_callable' : 'fuzzy_symbol_inference'
    })
  }

  return candidates
}

function classifyRuntimePath(pathName: string): { key: string; kind: RequiredClass; exact: boolean; partial: boolean } | null {
  const normalized = pathName.toLowerCase()
  if (normalized.includes('fromplugin')) {
    return {
      key: 'registry:fromPlugin',
      kind: 'registry',
      exact: /(^|\.)fromPlugin$/.test(pathName),
      partial: !/(^|\.)fromPlugin$/.test(pathName)
    }
  }
  if (normalized.includes('updatemessageatomic')) {
    return {
      key: 'updater:updateMessageAtomic',
      kind: 'updater',
      exact: /(^|\.)updateMessageAtomic$/.test(pathName),
      partial: !/(^|\.)updateMessageAtomic$/.test(pathName)
    }
  }
  if (normalized.includes('patchupdatemessage')) {
    return {
      key: 'updater:patchUpdateMessage',
      kind: 'updater',
      exact: /(^|\.)patchUpdateMessage$/.test(pathName),
      partial: !/(^|\.)patchUpdateMessage$/.test(pathName)
    }
  }
  if (normalized.includes('updatemessage')) {
    return {
      key: 'updater:updateMessage',
      kind: 'updater',
      exact: /(^|\.)updateMessage$/.test(pathName),
      partial: !/(^|\.)updateMessage$/.test(pathName)
    }
  }
  return null
}

export function extractRuntimeObjectCandidates(runtimeDump: RuntimeDumpDocument | null): RawCandidate[] {
  if (!runtimeDump) return []
  const candidates: RawCandidate[] = []
  const emittedPerClass: Record<RequiredClass, number> = { registry: 0, updater: 0 }
  const roots = Object.entries(runtimeDump.roots)
  for (const [rootName, root] of roots) {
    if (!root) continue
    for (const hit of root.hits) {
      if (hit.kind !== 'function') continue
      const classified = classifyRuntimePath(hit.path)
      if (!classified) continue
      if (emittedPerClass[classified.kind] >= 100) continue
      candidates.push({
        kind: classified.kind,
        sourceType: 'runtime-object-path',
        logicalTargetKey: classified.key,
        identifier: `${rootName}:${hit.path}`,
        evidence: `callable hit from ${rootName}: ${hit.path}`,
        exactTokenMatch: classified.exact,
        partialPathMatch: classified.partial,
        adapterSimulationRan: false,
        adapterSimulationPassed: false,
        validationState: classified.exact ? 'validated' : 'rejected',
        validationReason: classified.exact ? 'callable_shape_match' : 'partial_path_match'
      })
      emittedPerClass[classified.kind] += 1
    }
  }
  return candidates
}

export function addSyntheticRequiredClassRejects(findings: CandidateFinding[]): CandidateFinding[] {
  const withSynthetic = findings.map(finding => {
    if (finding.validationState !== 'inconclusive') {
      return finding
    }
    return {
      ...finding,
      validationState: 'rejected' as const,
      validationReason: 'insufficient_evidence_for_required_class'
    }
  })
  for (const kind of ['registry', 'updater'] as const) {
    const exists = withSynthetic.some(candidate => candidate.kind === kind)
    if (exists) continue
    withSynthetic.push({
      kind,
      sourceType: 'bundle-symbol',
      compatSource: 'object-path',
      logicalTargetKey: `${kind}:none-found`,
      identifier: `${kind}:none-found`,
      evidence: 'synthetic rejection because no candidates were discovered',
      confidence: 0,
      validationState: 'rejected',
      validationReason: 'no_candidates_discovered'
    })
  }
  return withSynthetic
}

export function buildDecisionGate(findings: CandidateFinding[]): DecisionGate {
  const blockers = new Set<BlockerCode>()

  for (const kind of ['registry', 'updater'] as const) {
    const classFindings = findings.filter(finding => finding.kind === kind)
    if (classFindings.length === 0) {
      blockers.add(kind === 'registry' ? 'missing_registry_target' : 'missing_updater_target')
      continue
    }

    const validated = classFindings.filter(finding => finding.validationState === 'validated')
    const rejected = classFindings.filter(finding => finding.validationState === 'rejected')

    if (validated.length === 0 && rejected.length > 0) {
      blockers.add(kind === 'registry' ? 'registry_rejected' : 'updater_rejected')
      continue
    }

    if (validated.length > 0) {
      const bestConfidence = Math.max(...validated.map(candidate => candidate.confidence))
      if (bestConfidence < REQUIRED_CLASS_THRESHOLD) {
        blockers.add(kind === 'registry' ? 'registry_confidence_below_threshold' : 'updater_confidence_below_threshold')
      }
    }
  }

  const blockerCodes = [...blockers].sort((left, right) => left.localeCompare(right))
  return {
    status: blockerCodes.length === 0 ? 'READY_FOR_INJECTION_IMPL' : 'DISCOVERY_INCOMPLETE',
    blockerCodes
  }
}

export function parseRuntimeDump(raw: string): RuntimeDumpDocument | null {
  try {
    const parsed = JSON.parse(raw) as RuntimeDumpDocument
    if (!parsed || parsed.schemaVersion !== '1' || typeof parsed.roots !== 'object') {
      return null
    }
    return parsed
  } catch {
    return null
  }
}

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
  const attemptedPaths = ['import:' + specifier]
  try {
    const namespace = await import(specifier)
    return { namespace, resolution: 'direct_import', attemptedPaths }
  } catch (directError) {
    if (!isModuleNotFound(directError)) {
      throw directError
    }
    const subpath = mapSpecifierSubpath(specifier)
    if (!subpath || localModuleRoots.length === 0) {
      directError.__probeAttemptedPaths = attemptedPaths
      throw directError
    }

    const paths = []
    for (const root of localModuleRoots) {
      paths.push(path.join(root, subpath + '.ts'))
      paths.push(path.join(root, subpath + '.js'))
      paths.push(path.join(root, subpath, 'index.ts'))
      paths.push(path.join(root, subpath, 'index.js'))
    }
    attemptedPaths.push(...paths.map(candidate => 'file:' + candidate))

    let fallbackError = directError
    for (const candidate of paths) {
      try {
        const namespace = await import(pathToFileURL(candidate).href)
        return { namespace, resolution: 'local_root_fallback', attemptedPaths }
      } catch (error) {
        if (!isModuleNotFound(error)) {
          throw error
        }
        fallbackError = error
      }
    }
    fallbackError.__probeAttemptedPaths = attemptedPaths
    throw fallbackError
  }
}

function classifyFound(spec, located, resolution, attemptedPaths) {
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
        errorMessage: 'Resolved export is not callable: ' + spec.specifier + ':' + spec.exportPath,
        evidence: 'resolved symbol type=' + foundType,
        resolution,
        attemptedPaths
      }
    }
  }

  if (spec.expectedContract === 'fromPlugin') {
    try {
      const fakePlugin = { execute: async () => {} }
      const wrapped = located.value.call(located.owner, fakePlugin)
      if (typeof wrapped?.execute !== 'function') {
        return {
          ...spec,
          result: {
            status: 'invoke_failed',
            typeof: 'function',
            arity: located.value.length,
            ownerType,
            errorClass: 'invoke_failed',
            errorMessage: 'fromPlugin contract check failed: returned value missing execute() function',
            evidence: 'fromPlugin returned type=' + typeof wrapped + ' executeType=' + typeof wrapped?.execute,
            resolution,
            attemptedPaths
          }
        }
      }
    } catch (error) {
      return {
        ...spec,
        result: {
          status: 'invoke_failed',
          typeof: 'function',
          arity: located.value.length,
          ownerType,
          errorClass: 'invoke_failed',
          errorMessage: error instanceof Error ? error.message : String(error),
          evidence: 'fromPlugin threw during contract check',
          resolution,
          attemptedPaths
        }
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
      errorMessage: null,
      evidence:
        spec.expectedContract === 'fromPlugin'
          ? 'fromPlugin returned wrapper with execute() function'
          : 'resolved function symbol; invocation skipped to avoid side effects',
      resolution,
      attemptedPaths
    }
  }
}

async function probeEntry(spec, localModuleRoots) {
  let resolved
  try {
    resolved = await resolveSpecifier(spec.specifier, localModuleRoots)
  } catch (error) {
    const moduleNotFound = isModuleNotFound(error)
    const attemptedPaths = Array.isArray(error?.__probeAttemptedPaths) ? error.__probeAttemptedPaths : ['import:' + spec.specifier]
    return {
      ...spec,
      result: {
        status: moduleNotFound ? 'missing' : 'invoke_failed',
        typeof: 'undefined',
        arity: 0,
        ownerType: 'undefined',
        errorClass: moduleNotFound ? 'module_not_found' : 'invoke_failed',
        errorMessage: error instanceof Error ? error.message : String(error),
        evidence: moduleNotFound ? 'module resolver could not locate candidate specifier' : 'module import threw non-resolution error',
        resolution: 'not_resolved',
        attemptedPaths
      }
    }
  }

  const moduleNamespace = resolved.namespace
  const resolution = resolved.resolution
  const attemptedPaths = resolved.attemptedPaths
  const roots = [moduleNamespace, moduleNamespace?.default].filter(root => root !== undefined)
  for (const root of roots) {
    const located = readNestedValue(root, spec.exportPath)
    if (located.value === undefined) continue
    return classifyFound(spec, located, resolution, attemptedPaths)
  }

  return {
    ...spec,
    result: {
      status: 'missing',
      typeof: 'undefined',
      arity: 0,
      ownerType: 'undefined',
      errorClass: 'export_path_missing',
      errorMessage: 'Missing export path: ' + spec.specifier + ':' + spec.exportPath,
      evidence: 'module resolved but export path was undefined',
      resolution,
      attemptedPaths
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
      const resolved = await resolveSpecifier(control.specifier, payload.localModuleRoots)
      const namespace = resolved.namespace
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

type ModuleRootCandidate = {
  path: string
  score: number
}

const MODULE_ROOT_MARKERS: string[][] = [
  ['session.ts', 'session.js', 'session/index.ts', 'session/index.js'],
  ['tool/registry.ts', 'tool/registry.js', 'tool/registry/index.ts', 'tool/registry/index.js'],
  ['message-route.ts', 'message-route.js', 'message-route/index.ts', 'message-route/index.js']
]

async function markerGroupExists(rootPath: string, markers: string[]): Promise<boolean> {
  for (const marker of markers) {
    if (await Bun.file(path.join(rootPath, marker)).exists()) {
      return true
    }
  }
  return false
}

async function scoreModuleRootCandidate(candidatePath: string): Promise<ModuleRootCandidate> {
  let score = 0
  for (const markerGroup of MODULE_ROOT_MARKERS) {
    if (await markerGroupExists(candidatePath, markerGroup)) {
      score += 1
    }
  }
  return { path: candidatePath, score }
}

export async function findLocalModuleRoot(binaryPath: string): Promise<string | null> {
  const startDirs = [path.dirname(binaryPath)]
  try {
    const resolvedDir = path.dirname(await realpath(binaryPath))
    if (!startDirs.includes(resolvedDir)) {
      startDirs.push(resolvedDir)
    }
  } catch {
    // Keep scanning from unresolved binary path when realpath fails.
  }
  const seen = new Set<string>()
  const candidates: string[] = []

  for (const start of startDirs) {
    let current = start
    const root = path.parse(current).root
    while (true) {
      const candidate = path.join(current, 'packages', 'opencode', 'src')
      if (!seen.has(candidate)) {
        seen.add(candidate)
        candidates.push(candidate)
      }
      if (current === root) {
        break
      }
      current = path.dirname(current)
    }
  }

  let best: ModuleRootCandidate | undefined
  for (const candidate of candidates) {
    const scored = await scoreModuleRootCandidate(candidate)
    if (scored.score < 2) {
      continue
    }
    if (!best || scored.score > best.score) {
      best = scored
    }
  }

  return best?.path ?? null
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

export async function collectInspectionData(runtime: RuntimeName, binary: string, cwd: string): Promise<{
  inspectionCommands: string[]
  inspectionEvidence: InspectionEvidenceRecord[]
  runtimeDump: RuntimeDumpDocument | null
}> {
  const inspectionCommands = [
    `file ${binary}`,
    `strings -n 8 ${binary} | rg "fromPlugin|updateMessageAtomic|updateMessage|patchUpdateMessage|ToolRegistry|Session|MessageRoute"`
  ]
  const inspectionEvidence: InspectionEvidenceRecord[] = []
  let order = 1

  const fileInfo = await runInspectionCommand(inspectionCommands[0], cwd)
  inspectionEvidence.push(makeEvidenceRecord('command', fileInfo.command, fileInfo.output || 'no output', order))
  order += 1

  const symbolInfo = await runInspectionCommand(inspectionCommands[1], cwd)
  inspectionEvidence.push(makeEvidenceRecord('command', symbolInfo.command, symbolInfo.output || 'no output', order))
  order += 1

  const runtimeDumpPath = process.env.CONTEXT_BONSAI_DISCOVERY_OUT
  let runtimeDump: RuntimeDumpDocument | null = null
  if (runtimeDumpPath && runtimeDumpPath.trim() !== '') {
    const absoluteRuntimeDumpPath = path.resolve(runtimeDumpPath)
    const dumpFile = Bun.file(absoluteRuntimeDumpPath)
    if (await dumpFile.exists()) {
      const runtimeRaw = await dumpFile.text()
      runtimeDump = parseRuntimeDump(runtimeRaw)
    }
    if (runtimeDump) {
      inspectionEvidence.push(
        makeEvidenceRecord(
          'runtime',
          absoluteRuntimeDumpPath,
          `runtime dump loaded for ${runtime}; roots=${Object.keys(runtimeDump.roots).join(',')}`,
          order
        )
      )
    } else {
      inspectionEvidence.push(
        makeEvidenceRecord('runtime', absoluteRuntimeDumpPath, `runtime dump unavailable or parse failed for ${runtime}`, order)
      )
    }
    order += 1
  }

  return {
    inspectionCommands,
    inspectionEvidence,
    runtimeDump
  }
}

function buildCandidateFindings(entries: ProbeEntryArtifact[], inspectionEvidence: InspectionEvidenceRecord[], runtimeDump: RuntimeDumpDocument | null): CandidateFinding[] {
  const bundleEvidenceLines = inspectionEvidence
    .filter(record => record.source === 'command' && record.ref.includes('strings -n 8'))
    .map(record => record.snippet)
  const rawCandidates = [
    ...buildImportResolvableCandidates(entries),
    ...extractBundleTextCandidates(bundleEvidenceLines),
    ...extractRuntimeObjectCandidates(runtimeDump)
  ]
  return addSyntheticRequiredClassRejects(dedupeAndRankCandidates(rawCandidates))
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
  const inspection = await collectInspectionData(runtime, binary, context.contextDir)
  const candidateFindings = buildCandidateFindings(entries, inspection.inspectionEvidence, inspection.runtimeDump)
  const decisionGate = buildDecisionGate(candidateFindings)
  const diagnostics: DiscoveryArtifact['diagnostics'] = []

  if (context.localModuleRoots.length === 0) {
    diagnostics.push({
      level: 'warn',
      code: 'local_root_not_found',
      message: `No local module root discovered from binary path ${binary}; module fallback probing disabled.`
    })
  } else {
    diagnostics.push({
      level: 'info',
      code: 'local_root_discovered',
      message: `Discovered local module root(s): ${context.localModuleRoots.join(', ')}`
    })
  }

  if (decisionGate.status === 'DISCOVERY_INCOMPLETE') {
    diagnostics.push({
      level: 'warn',
      code: 'decision_gate_unmet',
      message: `Discovery gate unmet; blocker codes: ${decisionGate.blockerCodes.join(', ') || 'none'}.`
    })
  } else {
    diagnostics.push({
      level: 'info',
      code: 'decision_gate_met',
      message: 'Discovery gate met; runtime is ready for injection implementation.'
    })
  }

  const reproducibilityHash = computeReproducibilityHash({
    schemaVersion: '2',
    inspectionCommands: inspection.inspectionCommands,
    inspectionEnvironment: {
      cwd: context.contextDir,
      runtimeName: runtime,
      runtimeBinary: binary
    },
    inspectionEvidence: inspection.inspectionEvidence,
    runtime: { name: runtime, binary, reportedVersion },
    probeMatrixVersion: 'v1',
    entries,
    candidateFindings,
    decisionGate,
    negativeControls,
    summary,
    diagnostics
  })

  return {
    schemaVersion: '2',
    generatedAt: new Date().toISOString(),
    reproducibilityHash,
    inspectionCommands: inspection.inspectionCommands,
    inspectionEnvironment: {
      cwd: context.contextDir,
      runtimeName: runtime,
      runtimeBinary: binary
    },
    inspectionEvidence: inspection.inspectionEvidence,
    runtime: { name: runtime, binary, reportedVersion },
    probeMatrixVersion: 'v1',
    entries,
    candidateFindings,
    decisionGate,
    negativeControls,
    summary,
    diagnostics
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
  console.log(`decisionGate status=${artifact.decisionGate.status} blockers=${artifact.decisionGate.blockerCodes.join(',') || 'none'}`)
  console.log(`reproducibilityHash=${artifact.reproducibilityHash}`)
}

if (import.meta.main) {
  main().catch(error => {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`discover-runtime-targets failed: ${message}`)
    process.exit(1)
  })
}
