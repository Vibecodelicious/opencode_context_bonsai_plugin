import { describe, expect, it } from 'bun:test'
import { parseCliArgs, summarizeEntries } from '../scripts/discover-runtime-targets'

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
})
