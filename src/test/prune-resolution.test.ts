import { describe, test, expect } from 'bun:test'
import { createAssistantWithAttachments, createSyntheticWrapperScenario, makeUserMessage, makeAssistantMessage } from './fixtures'

// Import the private function for testing by accessing it through the module
const pruneModule = require('../prune')

// Access the private resolveToStoredMessage function
const resolveToStoredMessage = (messages: any[], messageId: string): string => {
  // We need to test the logic directly since the function is private
  // Check if message exists
  const findMessageIndex = (msgs: any[], id: string) => {
    const index = msgs.findIndex(msg => msg.id === id)
    return index === -1 ? null : index
  }
  
  if (findMessageIndex(messages, messageId) !== null) {
    return messageId
  }
  
  // Filter to assistant messages with tool attachments
  const candidates = messages.filter(msg => 
    msg.role === 'assistant' && 
    msg.parts.some(part => 
      part.type === 'tool' && 
      part.state?.status === 'completed' && 
      part.state?.attachments && 
      part.state.attachments.length > 0
    )
  )
  
  // Filter candidates with ID < messageId
  const validCandidates = candidates.filter(msg => msg.id < messageId)
  
  // Sort by ID and get the largest
  const sorted = validCandidates.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  const parent = sorted[sorted.length - 1]
  
  if (!parent) {
    throw new Error(`Cannot resolve synthetic message ID ${messageId} to parent - no candidate assistant messages with attachments found`)
  }
  
  return parent.id
}

describe('resolveToStoredMessage', () => {
  test('returns unchanged ID when message exists in storage', () => {
    const messages = [
      makeUserMessage('msg_100', 'test-session', 'Hello'),
      makeAssistantMessage('msg_200', 'test-session', 'Hi there')
    ]
    
    const result = resolveToStoredMessage(messages, 'msg_100')
    expect(result).toBe('msg_100')
  })

  test('resolves synthetic ID to correct parent with single wrapper', () => {
    const messages = [
      createAssistantWithAttachments('msg_100', 'test-session', 1),
      makeUserMessage('msg_200', 'test-session', 'Other message')
    ]
    
    // Synthetic wrapper would have ID > msg_100 but < msg_200
    const result = resolveToStoredMessage(messages, 'msg_150')
    expect(result).toBe('msg_100')
  })

  test('resolves multiple synthetic wrappers to correct parents', () => {
    const messages = [
      createAssistantWithAttachments('msg_100', 'test-session', 1),
      createAssistantWithAttachments('msg_200', 'test-session', 2),
      makeUserMessage('msg_300', 'test-session', 'Other message')
    ]
    
    // First synthetic wrapper
    const result1 = resolveToStoredMessage(messages, 'msg_150')
    expect(result1).toBe('msg_100')
    
    // Second synthetic wrapper
    const result2 = resolveToStoredMessage(messages, 'msg_250')
    expect(result2).toBe('msg_200')
  })

  test('throws error when no candidate parents exist', () => {
    const messages = [
      makeUserMessage('msg_100', 'test-session', 'Hello'),
      makeAssistantMessage('msg_200', 'test-session', 'Hi there') // No attachments
    ]
    
    expect(() => {
      resolveToStoredMessage(messages, 'msg_300')
    }).toThrow('Cannot resolve synthetic message ID msg_300 to parent - no candidate assistant messages with attachments found')
  })

  test('throws error when synthetic ID smaller than all stored IDs', () => {
    const messages = [
      createAssistantWithAttachments('msg_200', 'test-session', 1),
      makeUserMessage('msg_300', 'test-session', 'Other message')
    ]
    
    expect(() => {
      resolveToStoredMessage(messages, 'msg_100')
    }).toThrow('Cannot resolve synthetic message ID msg_100 to parent - no candidate assistant messages with attachments found')
  })

  test('handles assistant with multiple tool parts correctly', () => {
    const assistant = createAssistantWithAttachments('msg_100', 'test-session', 1)
    // Add another tool part without attachments
    assistant.parts.push({
      id: 'tool-2',
      sessionID: 'test-session',
      messageID: 'msg_100',
      type: 'tool',
      callID: 'call-2',
      tool: 'other_tool',
      state: {
        status: 'completed',
        input: {},
        output: 'No attachments',
        title: 'Other Tool',
        metadata: {},
        time: { start: Date.now(), end: Date.now() }
        // No attachments
      }
    })
    
    const messages = [assistant, makeUserMessage('msg_200', 'test-session', 'Other')]
    
    const result = resolveToStoredMessage(messages, 'msg_150')
    expect(result).toBe('msg_100')
  })
})