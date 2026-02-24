import { describe, test, expect, beforeEach } from 'bun:test'
import { pruneToolDefinition } from './prune'
import { makeUserMessage, makeAssistantMessage } from './test/fixtures'
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

    const result = await pruneToolDefinition.execute({ from_id: 'nonexistent', to_id: 'msg2' }, mockCtx as any)
    
    expect(result).toContain('Message ID nonexistent not found')
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

    const result = await pruneToolDefinition.execute({ from_id: 'msg2', to_id: 'msg1' }, mockCtx as any)
    
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
      languageModel: {
        // Mock language model that returns predictable output
        doGenerate: async () => ({
          text: 'SUMMARY: User greeted assistant and asked how they are\nINDEX: greeting, conversation, hello'
        })
      },
      updateMessage: async (id: string, updater: (draft: any) => void) => {
        const draft = { metadata: {} }
        updater(draft)
        updatedMetadata = draft.metadata
      }
    }

    const result = await pruneToolDefinition.execute({ from_id: 'msg1', to_id: 'msg2' }, mockCtx as any)
    
    expect(result).toContain('Archived 2 messages')
    expect(result).toContain('msg1 to msg2')
    expect(updatedMetadata).toBeTruthy()
    expect(updatedMetadata[PLUGIN_ID].archive.summary).toContain('User greeted assistant')
    expect(updatedMetadata[PLUGIN_ID].archive.indexTerms).toEqual(['greeting', 'conversation', 'hello'])
    expect(updatedMetadata[PLUGIN_ID].archive.rangeEnd).toBe('msg2')
  })

  test('phase 2: handles summarization failure', async () => {
    const messages = [
      makeUserMessage('msg1', sessionID, 'Hello'),
      makeAssistantMessage('msg2', sessionID, 'Hi there')
    ]

    const mockCtx = {
      sessionID,
      messages: messages.map(msg => ({ info: { id: msg.id, sessionID: msg.sessionID, role: msg.role, metadata: msg.metadata }, parts: msg.parts })),
      languageModel: {
        doGenerate: async () => {
          throw new Error('Model unavailable')
        }
      },
      updateMessage: async () => {}
    }

    const result = await pruneToolDefinition.execute({ from_id: 'msg1', to_id: 'msg2' }, mockCtx as any)
    
    expect(result).toContain('Summarization failed')
    expect(result).toContain('Model unavailable')
  })
})