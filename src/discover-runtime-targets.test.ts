import { describe, expect, it } from 'bun:test'
import { mkdir, mkdtemp } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  addSyntheticRequiredClassRejects,
  assertNegativeControls,
  buildDecisionGate,
  dedupeAndRankCandidates,
  extractBundleTextCandidates,
  computeReproducibilityHash,
  findLocalModuleRoot,
  normalizeSnippet,
  parseCliArgs,
  parseRuntimeDump,
  runProbeWorker,
  summarizeEntries
} from '../scripts/discover-runtime-targets'

describe('discover-runtime-targets script helpers', () => {
  it('parses required runtime and out flags', () => {
    const parsed = parseCliArgs(['--runtime', 'stock', '--out', '/tmp/out.json'])
    expect(parsed).toEqual({ runtime: 'stock', out: '/tmp/out.json' })
  })

  it('parses equals-style flags', () => {
    const parsed = parseCliArgs(['--runtime=local', '--out=/tmp/local.json'])
    expect(parsed).toEqual({ runtime: 'local', out: '/tmp/local.json' })
  })

  it('throws when required flags are missing', () => {
    expect(() => parseCliArgs(['--runtime', 'stock'])).toThrow('Missing required --out <path>')
    expect(() => parseCliArgs(['--out', '/tmp/out.json'])).toThrow('Missing required --runtime <stock|local>')
  })

  it('summarizes entry statuses into required aggregate counts', () => {
    const summary = summarizeEntries([
      { id: 'A', kind: 'registry', specifier: 'a', exportPath: 'b', expectedContract: 'fromPlugin', result: { status: 'callable', typeof: 'function', arity: 1, ownerType: 'object', errorClass: null, errorMessage: null } },
      { id: 'B', kind: 'updater', specifier: 'a', exportPath: 'b', expectedContract: 'updateMessage', result: { status: 'invoke_failed', typeof: 'function', arity: 1, ownerType: 'object', errorClass: 'invoke_failed', errorMessage: 'x' } },
      { id: 'C', kind: 'updater', specifier: 'a', exportPath: 'b', expectedContract: 'updateMessageAtomic', result: { status: 'missing', typeof: 'undefined', arity: 0, ownerType: 'undefined', errorClass: 'module_not_found', errorMessage: 'y' } }
    ])

    expect(summary).toEqual({
      resolvedCount: 2,
      callableCount: 1,
      missingCount: 1,
      invokeFailedCount: 1
    })
  })

  it('throws when a negative control unexpectedly resolves', () => {
    expect(() =>
      assertNegativeControls({
        entries: [],
        negativeControls: [],
        unexpectedNegativeControlSuccesses: ['@opencode-ai/opencode/tool/registry:Nope.missing']
      })
    ).toThrow('Negative control unexpectedly resolved')
  })

  it('computes deterministic hash independent from generatedAt', () => {
    const base = {
      schemaVersion: '2' as const,
      inspectionCommands: ['file /tmp/runtime'],
      inspectionEnvironment: {
        cwd: '/tmp',
        runtimeName: 'stock' as const,
        runtimeBinary: '/tmp/runtime'
      },
      inspectionEvidence: [{ source: 'command' as const, ref: 'file /tmp/runtime', snippet: 'ELF', order: 1 }],
      runtime: {
        name: 'stock' as const,
        binary: '/tmp/runtime',
        reportedVersion: '1.0.0'
      },
      probeMatrixVersion: 'v1' as const,
      entries: [
        {
          id: 'REG-001',
          kind: 'registry' as const,
          specifier: 'x',
          exportPath: 'y',
          expectedContract: 'fromPlugin' as const,
          result: {
            status: 'callable' as const,
            typeof: 'function',
            arity: 1,
            ownerType: 'object',
            errorClass: null,
            errorMessage: null
          }
        }
      ],
      negativeControls: [{ specifier: 'bad', exportPath: 'Nope.missing', status: 'module_not_found' as const }],
      candidateFindings: [
        {
          kind: 'registry' as const,
          sourceType: 'import-resolvable' as const,
          compatSource: 'module' as const,
          logicalTargetKey: 'registry:fromPlugin',
          identifier: '@opencode-ai/opencode/tool/registry:PluginToolRegistry.fromPlugin',
          evidence: 'callable_shape_match',
          confidence: 0.85,
          validationState: 'validated' as const,
          validationReason: 'callable_shape_match'
        }
      ],
      decisionGate: {
        status: 'DISCOVERY_INCOMPLETE' as const,
        blockerCodes: ['missing_updater_target' as const]
      },
      summary: {
        resolvedCount: 1,
        callableCount: 1,
        missingCount: 0,
        invokeFailedCount: 0
      },
      diagnostics: [{ level: 'info' as const, code: 'callable_gate_met', message: 'ok' }]
    }

    const hashA = computeReproducibilityHash(base)
    const hashB = computeReproducibilityHash(JSON.parse(JSON.stringify(base)))
    expect(hashA).toBe(hashB)
  })

  it('marks function exports callable without invoking them', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'bonsai-discovery-callable-'))
    await Bun.write(
      path.join(root, 'probe.ts'),
      "export const Probe = { dangerous: () => { throw new Error('should not execute during probe') } }\n"
    )

    const result = await runProbeWorker(
      { contextDir: root, localModuleRoots: [root] },
      [
        {
          id: 'TEST-001',
          kind: 'updater',
          specifier: 'opencode/probe',
          exportPath: 'Probe.dangerous',
          expectedContract: 'updateMessage'
        }
      ],
      []
    )

    expect(result.entries[0]?.result.status).toBe('callable')
    expect(result.entries[0]?.result.errorClass).toBeNull()
  })

  it('maps non-resolution loader failures to invoke_failed', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'bonsai-discovery-errorclass-'))
    await Bun.write(path.join(root, 'broken.ts'), "throw new Error('module evaluation boom')\n")

    const result = await runProbeWorker(
      { contextDir: root, localModuleRoots: [root] },
      [
        {
          id: 'TEST-002',
          kind: 'updater',
          specifier: 'opencode/broken',
          exportPath: 'Broken.fn',
          expectedContract: 'updateMessage'
        }
      ],
      []
    )

    expect(result.entries[0]?.result.status).toBe('invoke_failed')
    expect(result.entries[0]?.result.errorClass).toBe('invoke_failed')
  })

  it('finds local module root without brittle single-file sentinel', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'bonsai-discovery-root-'))
    const srcRoot = path.join(root, 'packages', 'opencode', 'src')
    await mkdir(path.join(srcRoot, 'tool'), { recursive: true })
    await Bun.write(path.join(srcRoot, 'tool', 'registry.ts'), 'export const fromPlugin = () => ({ execute() {} })\n')
    await Bun.write(path.join(srcRoot, 'message-route.ts'), 'export const MessageRoute = {}\n')
    const binaryPath = path.join(root, 'packages', 'opencode', 'dist', 'opencode-linux-x64', 'bin', 'opencode')

    const discovered = await findLocalModuleRoot(binaryPath)
    expect(discovered).toBe(srcRoot)
  })

  it('records contract failure evidence when fromPlugin is malformed', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'bonsai-discovery-registry-contract-'))
    await Bun.write(path.join(root, 'registry.ts'), 'export const Registry = { fromPlugin: () => ({}) }\n')

    const result = await runProbeWorker(
      { contextDir: root, localModuleRoots: [root] },
      [
        {
          id: 'TEST-003',
          kind: 'registry',
          specifier: 'opencode/registry',
          exportPath: 'Registry.fromPlugin',
          expectedContract: 'fromPlugin'
        }
      ],
      []
    )

    expect(result.entries[0]?.result.status).toBe('invoke_failed')
    expect(result.entries[0]?.result.errorClass).toBe('invoke_failed')
    expect(result.entries[0]?.result.evidence).toContain('executeType=undefined')
  })

  it('records attempted paths when module resolution fails', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'bonsai-discovery-missing-paths-'))
    const result = await runProbeWorker(
      { contextDir: root, localModuleRoots: [] },
      [
        {
          id: 'TEST-004',
          kind: 'updater',
          specifier: 'opencode/missing-target',
          exportPath: 'Missing.target',
          expectedContract: 'updateMessage'
        }
      ],
      []
    )

    expect(result.entries[0]?.result.status).toBe('missing')
    expect(result.entries[0]?.result.resolution).toBe('not_resolved')
    expect(result.entries[0]?.result.attemptedPaths?.[0]).toBe('import:opencode/missing-target')
  })

  it('normalizes inspection snippets with stable length bound', () => {
    const normalized = normalizeSnippet('a\n\n b   c '.repeat(40))
    expect(normalized.includes('\n')).toBe(false)
    expect(normalized.length).toBeLessThanOrEqual(240)
  })

  it('dedupes candidates by source precedence and adds corroboration bonus', () => {
    const deduped = dedupeAndRankCandidates([
      {
        kind: 'registry',
        sourceType: 'bundle-symbol',
        logicalTargetKey: 'registry:fromPlugin',
        identifier: 'bundle-token:fromPlugin',
        evidence: 'bundle token',
        exactTokenMatch: true,
        partialPathMatch: false,
        adapterSimulationPassed: false,
        validationState: 'rejected',
        validationReason: 'textual_only'
      },
      {
        kind: 'registry',
        sourceType: 'runtime-object-path',
        logicalTargetKey: 'registry:fromPlugin',
        identifier: 'toolExecuteContext:tool.registry.fromPlugin',
        evidence: 'callable hit',
        exactTokenMatch: true,
        partialPathMatch: false,
        adapterSimulationPassed: true,
        validationState: 'validated',
        validationReason: 'callable_shape_match'
      }
    ])

    expect(deduped).toHaveLength(1)
    expect(deduped[0]?.sourceType).toBe('runtime-object-path')
    expect(deduped[0]?.confidence).toBe(1)
  })

  it('extracts bundle textual candidates from token lines', () => {
    const extracted = extractBundleTextCandidates(['Session updateMessageAtomic ToolRegistry fromPlugin'])
    const keys = extracted.map(entry => entry.logicalTargetKey)
    expect(keys).toContain('registry:fromPlugin')
    expect(keys).toContain('updater:updateMessageAtomic')
  })

  it('parses runtime dump payload and produces gate blockers from synthetic rejects', () => {
    const runtimeDump = parseRuntimeDump(
      JSON.stringify({
        schemaVersion: '1',
        roots: {
          toolExecuteContext: {
            capturedAt: new Date().toISOString(),
            visitedNodes: 3,
            truncated: false,
            hits: [{ path: 'tool.registry.fromPlugin', kind: 'function' }]
          }
        }
      })
    )
    expect(runtimeDump).not.toBeNull()

    const gate = buildDecisionGate(addSyntheticRequiredClassRejects([]))
    expect(gate.status).toBe('DISCOVERY_INCOMPLETE')
    expect(gate.blockerCodes).toEqual(['registry_rejected', 'updater_rejected'])
  })
})
