import { describe, test, expect, beforeEach, mock } from 'bun:test'
import { pruneToolDefinition, createPruneToolDefinition } from './prune'
import { makeUserMessage, makeAssistantMessage } from './test/fixtures'
import { clearSessionState, getIdVisibility, setIdVisibility } from './state'
import { PLUGIN_ID } from './constants'
import { createRuntimeCompat } from './runtime-compat'

describe('prune tool', () => {
  const sessionID = 'test-session'
  
  beforeEach(() => {
    clearSessionState(sessionID)
  })

  test('no-arg calls are rejected and do not mutate ID visibility', async () => {
    setIdVisibility(sessionID, true)
    const mockCtx = {
      sessionID,
      messages: [],
      languageModel: null,
      updateMessage: null
    }

    const result = await pruneToolDefinition.execute({}, mockCtx as any)

    expect(result).toBe('Phase 2 requires from_pattern and to_pattern (pattern-only mode).')
    expect(getIdVisibility(sessionID)).toBe(true)
  })

  test('ID selector mode is explicitly unsupported', async () => {
    const mockCtx = {
      sessionID,
      messages: [],
      languageModel: null,
      updateMessage: null
    }

    const result = await pruneToolDefinition.execute({ from_id: 'msg1' }, mockCtx as any)

    expect(result).toBe('ID selectors are no longer supported; use from_pattern and to_pattern.')
  })

  test('mixed selector payload returns ID-unsupported error first', async () => {
    const mockCtx = {
      sessionID,
      messages: [],
      languageModel: null,
      updateMessage: null
    }

    const result = await pruneToolDefinition.execute({
      from_id: 'msg1',
      to_id: 'msg2',
      from_pattern: 'alpha',
      to_pattern: 'beta',
      summary: 'Test summary',
      index_terms: ['test', 'selector', 'mixed']
    }, mockCtx as any)

    expect(result).toBe('ID selectors are no longer supported; use from_pattern and to_pattern.')
  })

  test('pattern mode requires both patterns', async () => {
    const mockCtx = {
      sessionID,
      messages: [],
      languageModel: null,
      updateMessage: null
    }

    const result = await pruneToolDefinition.execute({
      from_pattern: 'alpha',
      summary: 'Test summary',
      index_terms: ['test', 'pattern', 'partial']
    }, mockCtx as any)

    expect(result).toBe('Pattern mode requires both from_pattern and to_pattern.')
  })

  test('pattern mode resolves from and to boundaries', async () => {
    const messages = [
      makeUserMessage('msg1', sessionID, 'Alpha boundary text'),
      makeAssistantMessage('msg2', sessionID, 'Middle content'),
      makeUserMessage('msg3', sessionID, 'Omega boundary text')
    ]

    let updatedID = ''
    const mockCtx = {
      sessionID,
      messages: messages.map(msg => ({ info: { id: msg.id, sessionID: msg.sessionID, role: msg.role, metadata: msg.metadata }, parts: msg.parts })),
      languageModel: {},
      updateMessage: async (id: string) => {
        updatedID = id
      }
    }

    const result = await pruneToolDefinition.execute({
      from_pattern: 'Alpha boundary text',
      to_pattern: 'Omega boundary text',
      summary: 'Boundary selection by pattern',
      index_terms: ['pattern', 'boundary', 'selection']
    }, mockCtx as any)

    expect(updatedID).toBe('msg1')
    expect(result).toContain('pattern "Alpha boundary text" (resolved to msg1)')
    expect(result).toContain('pattern "Omega boundary text" (resolved to msg3)')
  })

  test('pattern mode returns exact no-match error', async () => {
    const messages = [
      makeUserMessage('msg1', sessionID, 'hello world')
    ]

    const mockCtx = {
      sessionID,
      messages: messages.map(msg => ({ info: { id: msg.id, sessionID: msg.sessionID, role: msg.role, metadata: msg.metadata }, parts: msg.parts })),
      languageModel: {},
      updateMessage: async () => {}
    }

    const result = await pruneToolDefinition.execute({
      from_pattern: 'not present',
      to_pattern: 'hello world',
      summary: 'No match case',
      index_terms: ['pattern', 'nomatch', 'error']
    }, mockCtx as any)

    expect(result).toBe('No messages match "not present"')
  })

  test('pattern mode returns exact ambiguous-match error', async () => {
    const messages = [
      makeUserMessage('msg1', sessionID, 'shared needle'),
      makeAssistantMessage('msg2', sessionID, 'shared needle'),
      makeUserMessage('msg3', sessionID, 'unique tail')
    ]

    const mockCtx = {
      sessionID,
      messages: messages.map(msg => ({ info: { id: msg.id, sessionID: msg.sessionID, role: msg.role, metadata: msg.metadata }, parts: msg.parts })),
      languageModel: {},
      updateMessage: async () => {}
    }

    const result = await pruneToolDefinition.execute({
      from_pattern: 'shared needle',
      to_pattern: 'unique tail',
      summary: 'Ambiguous match case',
      index_terms: ['pattern', 'ambiguous', 'error']
    }, mockCtx as any)

    expect(result).toBe('2 messages match "shared needle"; use a more precise pattern')
  })

  test('pattern mode retry resolves corrected boundaries despite prior prune-call corpus matches', async () => {
    const start = makeUserMessage('msg1', sessionID, 'retry start marker')
    const middle = makeAssistantMessage('msg2', sessionID, 'middle content')
    const end = makeUserMessage('msg3', sessionID, 'retry end marker')

    const failedPruneCall = makeAssistantMessage('msg4', sessionID, 'failed prune wrapper')
    failedPruneCall.parts = [{
      id: 'msg4-tool',
      sessionID,
      messageID: 'msg4',
      type: 'tool',
      callID: 'call-prune-1',
      tool: 'context-bonsai-prune',
      state: {
        status: 'completed',
        input: {
          from_pattern: 'retry start marker',
          to_pattern: 'retry end marker'
        },
        output: {
          error: '2 messages match "retry start marker"; use a more precise pattern'
        }
      }
    } as any]

    const messages = [start, middle, end, failedPruneCall]

    let updatedID = ''
    const mockCtx = {
      sessionID,
      messages: messages.map(msg => ({ info: { id: msg.id, sessionID: msg.sessionID, role: msg.role, metadata: msg.metadata }, parts: msg.parts })),
      languageModel: {},
      updateMessage: async (id: string) => {
        updatedID = id
      }
    }

    const result = await pruneToolDefinition.execute({
      from_pattern: 'retry start marker',
      to_pattern: 'retry end marker',
      summary: 'Retry succeeds after failed prune call',
      index_terms: ['retry', 'stability', 'ambiguity']
    }, mockCtx as any)

    expect(updatedID).toBe('msg1')
    expect(result).toContain('Archived 3 messages')
    expect(result).toContain('pattern "retry start marker" (resolved to msg1)')
    expect(result).toContain('pattern "retry end marker" (resolved to msg3)')
  })

  test('pattern resolution errors run before validatePruneInput errors', async () => {
    const messages = [
      makeUserMessage('msg1', sessionID, 'first marker'),
      makeAssistantMessage('msg2', sessionID, 'second marker')
    ]

    const mockCtx = {
      sessionID,
      messages: messages.map(msg => ({ info: { id: msg.id, sessionID: msg.sessionID, role: msg.role, metadata: msg.metadata }, parts: msg.parts })),
      languageModel: {},
      updateMessage: async () => {}
    }

    const result = await pruneToolDefinition.execute({
      from_pattern: 'first marker',
      to_pattern: 'missing marker',
      summary: 'Precedence case',
      index_terms: ['pattern', 'precedence', 'error']
    }, mockCtx as any)

    expect(result).toBe('No messages match "missing marker"')
  })

  test('pattern mode still enforces validatePruneInput chronology checks', async () => {
    const messages = [
      makeUserMessage('msg1', sessionID, 'first marker'),
      makeAssistantMessage('msg2', sessionID, 'second marker')
    ]

    const mockCtx = {
      sessionID,
      messages: messages.map(msg => ({ info: { id: msg.id, sessionID: msg.sessionID, role: msg.role, metadata: msg.metadata }, parts: msg.parts })),
      languageModel: {},
      updateMessage: async () => {}
    }

    const result = await pruneToolDefinition.execute({
      from_pattern: 'second marker',
      to_pattern: 'first marker',
      summary: 'Chronology with pattern mode',
      index_terms: ['pattern', 'chronology', 'validation']
    }, mockCtx as any)

    expect(result).toContain('from_pattern must resolve to a message that precedes to_pattern chronologically')
  })

  test('pattern mode: successful archiving', async () => {
    const messages = [
      makeUserMessage('msg1', sessionID, 'Hello'),
      makeAssistantMessage('msg2', sessionID, 'Hi there'),
      makeUserMessage('msg3', sessionID, 'How are you?')
    ]

    let updatedMetadata: any = null
    const mockCtx = {
      sessionID,
      messages: messages.map(msg => ({ info: { id: msg.id, sessionID: msg.sessionID, role: msg.role, metadata: msg.metadata }, parts: msg.parts })),
      languageModel: {},
      updateMessage: async (id: string, updater: (draft: any) => void) => {
        const draft = { metadata: {}, parts: [] }
        updater(draft)
        if (id === 'msg1') {
          updatedMetadata = draft.metadata
        }
      }
    }

    const result = await pruneToolDefinition.execute({ 
      from_pattern: 'Hello',
      to_pattern: 'Hi there',
      summary: 'User greeted assistant and asked how they are',
      index_terms: ['greeting', 'conversation', 'hello']
    }, mockCtx as any)
    
    expect(result).toContain('Archived 2 messages')
    expect(result).toContain('pattern "Hello" (resolved to msg1)')
    expect(result).toContain('pattern "Hi there" (resolved to msg2)')
    expect(updatedMetadata).toBeTruthy()
    expect(updatedMetadata[PLUGIN_ID].archive.summary).toContain('User greeted assistant')
    expect(updatedMetadata[PLUGIN_ID].archive.indexTerms).toEqual(['greeting', 'conversation', 'hello'])
    expect(updatedMetadata[PLUGIN_ID].archive.rangeEnd).toBe('msg2')
  })

  test('pattern mode: requires summary parameter', async () => {
    const messages = [
      makeUserMessage('msg1', sessionID, 'Hello'),
      makeAssistantMessage('msg2', sessionID, 'Hi there')
    ]

    const mockCtx = {
      sessionID,
      messages: messages.map(msg => ({ info: { id: msg.id, sessionID: msg.sessionID, role: msg.role, metadata: msg.metadata }, parts: msg.parts })),
      languageModel: {},
      updateMessage: async () => {}
    }

    const result = await pruneToolDefinition.execute({ 
      from_pattern: 'Hello',
      to_pattern: 'Hi there',
      index_terms: ['greeting', 'conversation']
    }, mockCtx as any)

    expect(result).toContain('Prune requires summary parameter')
  })

  test('pattern mode: requires index_terms parameter', async () => {
    const messages = [
      makeUserMessage('msg1', sessionID, 'Hello'),
      makeAssistantMessage('msg2', sessionID, 'Hi there')
    ]

    const mockCtx = {
      sessionID,
      messages: messages.map(msg => ({ info: { id: msg.id, sessionID: msg.sessionID, role: msg.role, metadata: msg.metadata }, parts: msg.parts })),
      languageModel: {},
      updateMessage: async () => {}
    }

    const result = await pruneToolDefinition.execute({ 
      from_pattern: 'Hello',
      to_pattern: 'Hi there',
      summary: 'User greeted assistant'
    }, mockCtx as any)

    expect(result).toContain('Prune requires index_terms parameter')
  })

  test('pattern mode: rejects empty summary', async () => {
    const messages = [
      makeUserMessage('msg1', sessionID, 'Hello'),
      makeAssistantMessage('msg2', sessionID, 'Hi there')
    ]

    const mockCtx = {
      sessionID,
      messages: messages.map(msg => ({ info: { id: msg.id, sessionID: msg.sessionID, role: msg.role, metadata: msg.metadata }, parts: msg.parts })),
      languageModel: {},
      updateMessage: async () => {}
    }

    const result = await pruneToolDefinition.execute({ 
      from_pattern: 'Hello',
      to_pattern: 'Hi there',
      summary: '   ',
      index_terms: ['greeting', 'conversation']
    }, mockCtx as any)
    
    expect(result).toContain('summary cannot be empty')
  })

  test('pattern mode: rejects empty index_terms array', async () => {
    const messages = [
      makeUserMessage('msg1', sessionID, 'Hello'),
      makeAssistantMessage('msg2', sessionID, 'Hi there')
    ]

    const mockCtx = {
      sessionID,
      messages: messages.map(msg => ({ info: { id: msg.id, sessionID: msg.sessionID, role: msg.role, metadata: msg.metadata }, parts: msg.parts })),
      languageModel: {},
      updateMessage: async () => {}
    }

    const result = await pruneToolDefinition.execute({ 
      from_pattern: 'Hello',
      to_pattern: 'Hi there',
      summary: 'User greeted assistant',
      index_terms: []
    }, mockCtx as any)
    
    expect(result).toContain('index_terms cannot be empty')
  })

  test('pattern mode: allows single-message range', async () => {
    const messages = [
      makeUserMessage('msg1', sessionID, 'Hello'),
      makeAssistantMessage('msg2', sessionID, 'Hi there')
    ]

    let updatedMetadata: any = null
    const mockCtx = {
      sessionID,
      messages: messages.map(msg => ({ info: { id: msg.id, sessionID: msg.sessionID, role: msg.role, metadata: msg.metadata }, parts: msg.parts })),
      languageModel: {},
      updateMessage: async (id: string, updater: (draft: any) => void) => {
        const draft = { metadata: {} }
        updater(draft)
        updatedMetadata = draft.metadata
      }
    }

    const result = await pruneToolDefinition.execute({ 
      from_pattern: 'Hello',
      to_pattern: 'Hello',
      summary: 'User greeting',
      index_terms: ['greeting']
    }, mockCtx as any)
    
    expect(result).toContain('Archived 1 messages')
    expect(result).toContain('pattern "Hello" (resolved to msg1)')
    expect(updatedMetadata[PLUGIN_ID].archive.rangeEnd).toBe('msg1')
  })

  test('returns exact compatibility error when message loading is unsupported', async () => {
    const compatTool = createPruneToolDefinition(createRuntimeCompat())
    const result = await compatTool.execute({}, { sessionID } as any)
    expect(result).toBe('Compatibility error: unable to load session messages in this runtime.')
  })

  test('returns exact compatibility error when message updates are unsupported', async () => {
    const compatTool = createPruneToolDefinition(createRuntimeCompat())
    const messages = [makeUserMessage('msg1', sessionID, 'Hello')]

    const result = await compatTool.execute({
      from_pattern: 'Hello',
      to_pattern: 'Hello',
      summary: 'single message summary',
      index_terms: ['single', 'message', 'summary']
    }, {
      sessionID,
      messages: messages.map(msg => ({
        info: {
          id: msg.id,
          sessionID: msg.sessionID,
          role: msg.role,
          metadata: msg.metadata,
          time: { created: msg.createdAt.getTime() }
        },
        parts: msg.parts
      }))
    } as any)

    expect(result).toBe('Compatibility error: message updates are unsupported in this runtime.')
  })
})
