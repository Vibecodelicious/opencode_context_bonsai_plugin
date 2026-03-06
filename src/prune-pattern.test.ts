import { describe, expect, test } from 'bun:test'
import { makeAssistantMessage, makeUserMessage } from './test/fixtures'
import { messageMatchesPattern } from './prune-pattern-matcher'
import { buildMessageSearchCorpus, resolvePatternBoundary, stableSerialize } from './prune-pattern'

describe('prune pattern utilities', () => {
  test('stableSerialize sorts object keys and handles non-JSON values deterministically', () => {
    const fn = () => 'noop'
    const symbol = Symbol('s')

    const value = {
      z: 3,
      a: {
        keep: 1,
        dropUndefined: undefined,
        dropFn: fn,
        dropSymbol: symbol,
        nested: { b: 2, a: 1 }
      },
      arr: [1, undefined, fn, symbol, 7n, { y: 2, x: 1 }]
    }

    expect(stableSerialize(value)).toBe('{"a":{"keep":1,"nested":{"a":1,"b":2}},"arr":[1,null,null,null,"7",{"x":1,"y":2}],"z":3}')
  })

  test('stableSerialize uses strict lexicographic key ordering', () => {
    const value = { a: 1, A: 2, _: 3 }

    expect(stableSerialize(value)).toBe('{"A":2,"_":3,"a":1}')
  })

  test('buildMessageSearchCorpus includes completed tool content and excludes synthetic and ignored text', () => {
    const message = makeAssistantMessage('msg1', 's1', 'visible text')
    message.parts.unshift({
      id: 'msg1-synth',
      sessionID: 's1',
      messageID: 'msg1',
      type: 'text',
      text: '[msg:msg1]',
      synthetic: true
    } as any)
    message.parts.push({
      id: 'msg1-ignored',
      sessionID: 's1',
      messageID: 'msg1',
      type: 'text',
      text: 'hidden text',
      ignored: true
    } as any)
    message.parts.push({
      id: 'msg1-tool',
      sessionID: 's1',
      messageID: 'msg1',
      type: 'tool',
      callID: 'call-1',
      tool: 'grep',
      state: {
        status: 'completed',
        input: { z: 2, a: 1 },
        output: { ok: true }
      }
    } as any)
    message.parts.push({
      id: 'msg1-tool-pending',
      sessionID: 's1',
      messageID: 'msg1',
      type: 'tool',
      callID: 'call-2',
      tool: 'bash',
      state: {
        status: 'running',
        input: { cmd: 'ls' },
        output: 'pending'
      }
    } as any)

    const corpus = buildMessageSearchCorpus(message)
    expect(corpus).toContain('text:visible text')
    expect(corpus).toContain('tool:grep')
    expect(corpus).toContain('input:{"a":1,"z":2}')
    expect(corpus).toContain('output:{"ok":true}')
    expect(corpus).not.toContain('[msg:msg1]')
    expect(corpus).not.toContain('hidden text')
    expect(corpus).not.toContain('tool:bash')
  })

  test('message matching requires corpus containment for a heuristic candidate', () => {
    const corpus = 'alpha\nbeta'
    const pattern = ' alpha \n beta '

    // SimpleReplacer yields the raw pattern which is not contained in corpus.
    // A later heuristic still matches by producing a contained candidate.
    expect(messageMatchesPattern(corpus, pattern)).toBe(true)
  })

  test('resolvePatternBoundary returns exact deterministic errors', () => {
    const messages = [
      makeUserMessage('msg1', 's1', 'shared content'),
      makeAssistantMessage('msg2', 's1', 'shared content')
    ]

    expect(() => resolvePatternBoundary(messages, 'missing')).toThrow('No messages match "missing"')
    expect(() => resolvePatternBoundary(messages, 'shared content')).toThrow('2 messages match "shared content"; use a more precise pattern')
  })

  test('resolvePatternBoundary can match completed tool output content', () => {
    const plain = makeUserMessage('msg1', 's1', 'plain text')
    const toolMessage = makeAssistantMessage('msg2', 's1', 'assistant wrapper')
    toolMessage.parts = [{
      id: 'msg2-tool',
      sessionID: 's1',
      messageID: 'msg2',
      type: 'tool',
      callID: 'call-1',
      tool: 'bash',
      state: {
        status: 'completed',
        input: { cmd: 'bun test', retries: 2 },
        output: { status: 'ok', lines: ['pass'] }
      }
    } as any]

    expect(resolvePatternBoundary([plain, toolMessage], 'tool:bash')).toBe('msg2')
    expect(resolvePatternBoundary([plain, toolMessage], '"retries":2')).toBe('msg2')
    expect(resolvePatternBoundary([plain, toolMessage], '"status":"ok"')).toBe('msg2')
  })
})
