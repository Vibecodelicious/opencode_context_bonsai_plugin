import type { Message, Part, TextPart } from "@opencode-ai/sdk"

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