import { describe, expect, it } from 'bun:test'
import { mkdtemp } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  assertNegativeControls,
  computeReproducibilityHash,
  parseCliArgs,
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
      schemaVersion: '1' as const,
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
      summary: {
        resolvedCount: 1,
        callableCount: 1,
        missingCount: 0,
        invokeFailedCount: 0
      }
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
})
