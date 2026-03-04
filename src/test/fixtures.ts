import type { Message, Part, TextPart, ToolPart, FilePart } from "@opencode-ai/sdk/v2"

export interface WithParts {
  id: string
  sessionID: string
  role: 'user' | 'assistant'
  parts: Part[]
  metadata: Record<string, unknown>
  createdAt: Date
}

export function makeUserMessage(
  id: string,
  sessionID: string,
  text: string,
  opts?: { metadata?: Record<string, unknown> }
): WithParts {
  return {
    id,
    sessionID,
    role: 'user',
    parts: [{
      id: `${id}-text`,
      sessionID,
      messageID: id,
      type: 'text',
      text
    } as TextPart],
    metadata: opts?.metadata ?? {},
    createdAt: new Date()
  }
}

export function makeAssistantMessage(
  id: string,
  sessionID: string,
  text: string,
  opts?: { metadata?: Record<string, unknown> }
): WithParts {
  return {
    id,
    sessionID,
    role: 'assistant',
    parts: [{
      id: `${id}-text`,
      sessionID,
      messageID: id,
      type: 'text',
      text
    } as TextPart],
    metadata: opts?.metadata ?? {},
    createdAt: new Date()
  }
}

export function makeArchivedMessage(
  id: string,
  sessionID: string,
  pluginID: string,
  archive: { summary: string; indexTerms: string[]; rangeEnd: string }
): WithParts {
  return {
    id,
    sessionID,
    role: 'assistant',
    parts: [{
      id: `${id}-text`,
      sessionID,
      messageID: id,
      type: 'text',
      text: 'Original content'
    } as TextPart],
    metadata: {
      [pluginID]: { archive }
    },
    createdAt: new Date()
  }
}

export function createFilePart(id: string): FilePart {
  return {
    id,
    sessionID: 'test-session',
    messageID: 'test-message',
    type: 'file',
    mime: 'text/plain',
    filename: 'test.txt',
    url: 'file://test.txt'
  }
}

export function createToolPart(id: string, attachmentCount: number): ToolPart {
  const attachments = Array.from({ length: attachmentCount }, (_, i) => 
    createFilePart(`${id}-attachment-${i}`)
  )
  
  return {
    id,
    sessionID: 'test-session',
    messageID: 'test-message',
    type: 'tool',
    callID: `call-${id}`,
    tool: 'test_tool',
    state: {
      status: 'completed',
      input: {},
      output: 'Tool completed successfully',
      title: 'Test Tool',
      metadata: {},
      time: { start: Date.now(), end: Date.now() },
      attachments
    }
  }
}

export function createAssistantWithAttachments(id: string, sessionID: string, attachmentCount: number): WithParts {
  return {
    id,
    sessionID,
    role: 'assistant',
    parts: [createToolPart(`${id}-tool`, attachmentCount)],
    metadata: {},
    createdAt: new Date()
  }
}

export function createSyntheticWrapperScenario(): WithParts[] {
  const sessionID = 'test-session'
  return [
    createAssistantWithAttachments('msg_100', sessionID, 2),
    makeUserMessage('msg_200', sessionID, 'Some other message'),
    makeUserMessage('msg_300', sessionID, 'Another message')
  ]
}