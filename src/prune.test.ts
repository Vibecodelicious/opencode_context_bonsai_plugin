import { describe, test, expect, beforeEach, mock } from 'bun:test'
import { pruneToolDefinition } from './prune'
import { makeUserMessage, makeAssistantMessage, createAssistantWithAttachments } from './test/fixtures'
import { clearSessionState } from './state'
import { PLUGIN_ID } from './constants'

describe('prune tool', () => {
  const sessionID = 'test-session'
  
  beforeEach(() => {
    clearSessionState(sessionID)
  })

  test('phase 1: enables ID visibility', async () => {
    const mockCtx = {
      sessionID,
      messages: [],
      languageModel: null,
      updateMessage: null
    }

    const result = await pruneToolDefinition.execute({}, mockCtx as any)
    
    expect(result).toContain('Message IDs are now visible')
  })

  test('phase 2: validates both IDs required', async () => {
    const mockCtx = {
      sessionID,
      messages: [],
      languageModel: null,
      updateMessage: null
    }

    const result = await pruneToolDefinition.execute({ from_id: 'msg1' }, mockCtx as any)
    
    expect(result).toContain('Phase 2 requires both from_id and to_id')
  })

  test('phase 2: validates message IDs exist', async () => {
    const messages = [
      makeUserMessage('msg1', sessionID, 'Hello'),
      makeAssistantMessage('msg2', sessionID, 'Hi there')
    ]

    const mockCtx = {
      sessionID,
      messages: messages.map(msg => ({ info: { id: msg.id, sessionID: msg.sessionID, role: msg.role, metadata: msg.metadata }, parts: msg.parts })),
      languageModel: null,
      updateMessage: null
    }

    const result = await pruneToolDefinition.execute({ 
      from_id: 'nonexistent', 
      to_id: 'msg2',
      summary: 'Test summary',
      index_terms: ['test']
    }, mockCtx as any)
    
    expect(result).toContain('Cannot resolve synthetic message ID nonexistent to parent')
  })

  test('validation with synthetic ID resolution succeeds', async () => {
    const messages = [
      createAssistantWithAttachments('msg1', sessionID, 1),
      makeUserMessage('msg2', sessionID, 'Hello')
    ]

    let updatedMetadata: any = null
    const mockCtx = {
      sessionID,
      messages: messages.map(msg => ({ info: { id: msg.id, sessionID: msg.sessionID, role: msg.role, metadata: msg.metadata }, parts: msg.parts })),
      languageModel: {},
      updateMessage: async (id: string, updater: (draft: any) => void) => {
        const draft = { metadata: {} }
        updater(draft)
        if (id === 'msg1') {
          updatedMetadata = draft.metadata
        }
      }
    }

    // Synthetic wrapper ID that should resolve to msg1
    const result = await pruneToolDefinition.execute({ 
      from_id: 'msg1_synthetic', 
      to_id: 'msg1_synthetic2',
      summary: 'Test synthetic resolution',
      index_terms: ['test', 'synthetic']
    }, mockCtx as any)
    
    expect(result).toContain('Archived 1 messages')
    expect(result).toContain('resolved to msg1')
    expect(updatedMetadata).toBeTruthy()
    expect(updatedMetadata[PLUGIN_ID].archive.summary).toBe('Test synthetic resolution')
  })

  test('success message shows resolved IDs when different from original', async () => {
    const messages = [
      createAssistantWithAttachments('msg1', sessionID, 1),
      makeUserMessage('msg2', sessionID, 'Hello')
    ]

    const mockCtx = {
      sessionID,
      messages: messages.map(msg => ({ info: { id: msg.id, sessionID: msg.sessionID, role: msg.role, metadata: msg.metadata }, parts: msg.parts })),
      languageModel: {},
      updateMessage: async () => {}
    }

    const result = await pruneToolDefinition.execute({ 
      from_id: 'msg1_synthetic', 
      to_id: 'msg1_synthetic2',
      summary: 'Test message',
      index_terms: ['test']
    }, mockCtx as any)
    
    expect(result).toContain('msg1_synthetic (resolved to msg1)')
    expect(result).toContain('msg1_synthetic2 (resolved to msg1)')
  })

  test('phase 2: validates chronological order', async () => {
    const messages = [
      makeUserMessage('msg1', sessionID, 'Hello'),
      makeAssistantMessage('msg2', sessionID, 'Hi there')
    ]

    const mockCtx = {
      sessionID,
      messages: messages.map(msg => ({ info: { id: msg.id, sessionID: msg.sessionID, role: msg.role, metadata: msg.metadata }, parts: msg.parts })),
      languageModel: null,
      updateMessage: null
    }

    const result = await pruneToolDefinition.execute({ 
      from_id: 'msg2', 
      to_id: 'msg1',
      summary: 'Test summary',
      index_terms: ['test']
    }, mockCtx as any)
    
    expect(result).toContain('from_id must precede to_id chronologically')
  })

  test('phase 2: successful archiving', async () => {
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
      from_id: 'msg1', 
      to_id: 'msg2',
      summary: 'User greeted assistant and asked how they are',
      index_terms: ['greeting', 'conversation', 'hello']
    }, mockCtx as any)
    
    expect(result).toContain('Archived 2 messages')
    expect(result).toContain('msg1 to msg2')
    expect(updatedMetadata).toBeTruthy()
    expect(updatedMetadata[PLUGIN_ID].archive.summary).toContain('User greeted assistant')
    expect(updatedMetadata[PLUGIN_ID].archive.indexTerms).toEqual(['greeting', 'conversation', 'hello'])
    expect(updatedMetadata[PLUGIN_ID].archive.rangeEnd).toBe('msg2')
  })

  test('phase 2: requires summary parameter', async () => {
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
      from_id: 'msg1', 
      to_id: 'msg2',
      index_terms: ['greeting', 'conversation']
    }, mockCtx as any)
    
    expect(result).toContain('Phase 2 requires summary parameter')
  })

  test('phase 2: requires index_terms parameter', async () => {
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
      from_id: 'msg1', 
      to_id: 'msg2',
      summary: 'User greeted assistant'
    }, mockCtx as any)
    
    expect(result).toContain('Phase 2 requires index_terms parameter')
  })

  test('phase 2: rejects empty summary', async () => {
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
      from_id: 'msg1', 
      to_id: 'msg2',
      summary: '   ',
      index_terms: ['greeting', 'conversation']
    }, mockCtx as any)
    
    expect(result).toContain('summary cannot be empty')
  })

  test('phase 2: rejects empty index_terms array', async () => {
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
      from_id: 'msg1', 
      to_id: 'msg2',
      summary: 'User greeted assistant',
      index_terms: []
    }, mockCtx as any)
    
    expect(result).toContain('index_terms cannot be empty')
  })

  test('phase 2: allows single-message range (from_id === to_id)', async () => {
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
      from_id: 'msg1', 
      to_id: 'msg1',
      summary: 'User greeting',
      index_terms: ['greeting']
    }, mockCtx as any)
    
    expect(result).toContain('Archived 1 messages')
    expect(result).toContain('msg1 to msg1')
    expect(updatedMetadata[PLUGIN_ID].archive.rangeEnd).toBe('msg1')
  })
})