import { tool, type ToolDefinition } from '@opencode-ai/plugin'
import { setIdVisibility, getSameStepPrunes, setSameStepPrunes } from './state'
import { PLUGIN_ID } from './constants'
import type { WithParts } from './test/fixtures'

function findMessageIndex(messages: WithParts[], id: string): number | null {
  const index = messages.findIndex(msg => msg.id === id)
  return index === -1 ? null : index
}

function resolveToStoredMessage(messages: WithParts[], messageId: string): string {
  // Check if message exists using findMessageIndex
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

function isInPrunedRange(messages: WithParts[], id: string, pluginID: string): boolean {
  for (const msg of messages) {
    const archive = (msg.metadata[pluginID] as any)?.archive
    if (archive && archive.rangeEnd) {
      const msgIndex = findMessageIndex(messages, id)
      const startIndex = findMessageIndex(messages, msg.id)
      const endIndex = findMessageIndex(messages, archive.rangeEnd)
      
      if (msgIndex !== null && startIndex !== null && endIndex !== null) {
        const rangeStart = Math.min(startIndex, endIndex)
        const rangeEnd = Math.max(startIndex, endIndex)
        if (msgIndex >= rangeStart && msgIndex <= rangeEnd) {
          return true
        }
      }
    }
  }
  return false
}

function validatePruneInput(
  messages: WithParts[],
  fromId: string,
  toId: string,
  pluginID: string
): { error: string } | { resolvedFromId: string; resolvedToId: string; fromIndex: number; toIndex: number } {
  try {
    const resolvedFromId = resolveToStoredMessage(messages, fromId)
    const resolvedToId = resolveToStoredMessage(messages, toId)
    
    const fromIndex = findMessageIndex(messages, resolvedFromId)!
    const toIndex = findMessageIndex(messages, resolvedToId)!

    if (fromIndex > toIndex) {
      return { error: `from_id must precede to_id chronologically` }
    }

    if (isInPrunedRange(messages, resolvedFromId, pluginID)) {
      return { error: `from_id ${fromId} falls within an already-pruned range` }
    }
    if (isInPrunedRange(messages, resolvedToId, pluginID)) {
      return { error: `to_id ${toId} falls within an already-pruned range` }
    }

    // Check for pending/running tool calls in range
    for (let i = fromIndex; i <= toIndex; i++) {
      const msg = messages[i]
      for (const part of msg.parts) {
        if (part.type === 'tool' && (part.state?.status === 'pending' || part.state?.status === 'running')) {
          return { error: `Range contains incomplete tool calls that would produce malformed history` }
        }
      }
    }

    return { resolvedFromId, resolvedToId, fromIndex, toIndex }
  } catch (e: any) {
    return { error: e.message }
  }
}

export const pruneToolDefinition: ToolDefinition = tool({
  description: 'Archive a range of conversation messages with a summary. Phase 1: enable message ID visibility. Phase 2: archive specified range.',
  args: {
    from_id: tool.schema.string().optional().describe('Start message ID for archiving (Phase 2)'),
    to_id: tool.schema.string().optional().describe('End message ID for archiving (Phase 2)'),
    reason: tool.schema.string().optional().describe('Reason for archiving this range (Phase 2)'),
    summary: tool.schema.string().optional().describe('Concise summary (1-3 sentences) of the archived content (Phase 2)'),
    index_terms: tool.schema.array(tool.schema.string()).optional().describe('Keywords for retrieval, 3-8 terms (Phase 2)')
  },
  async execute(args, ctx) {
    // Convert messages to WithParts format
    const messages: WithParts[] = (ctx as any).messages.map((msg: any) => ({
      id: msg.info.id,
      sessionID: msg.info.sessionID,
      role: msg.info.role,
      parts: msg.parts,
      metadata: (msg.info as any).metadata || {},
      createdAt: new Date((msg.info as any).time?.created || Date.now())
    }))

    // Phase detection
    if (!args.from_id && !args.to_id) {
      // Phase 1: Enable ID visibility
      setIdVisibility(ctx.sessionID, true)
      return 'Message IDs are now visible in the conversation. Use the prune tool again with from_id and to_id to archive a specific range.'
    }

    // Phase 2: Validate inputs
    if (!args.from_id || !args.to_id) {
      return 'Phase 2 requires both from_id and to_id. Call without arguments to see message IDs.'
    }

    if (!args.summary) {
      return 'Phase 2 requires summary parameter'
    }

    if (!args.index_terms) {
      return 'Phase 2 requires index_terms parameter'
    }

    if (args.summary.trim() === '') {
      return 'summary cannot be empty'
    }

    if (args.index_terms.length === 0) {
      return 'index_terms cannot be empty'
    }

    const result = validatePruneInput(messages, args.from_id, args.to_id, PLUGIN_ID)
    if ('error' in result) {
      return `Validation error: ${result.error}`
    }

    // Write archive metadata to the start message
    await (ctx as any).updateMessage(result.resolvedFromId, (draft: any) => {
      if (!draft.metadata) draft.metadata = {}
      draft.metadata[PLUGIN_ID] = {
        archive: {
          summary: args.summary,
          indexTerms: args.index_terms,
          rangeEnd: result.resolvedToId
        }
      }
    })

    // Add to same-step prune set
    const currentPrunes = getSameStepPrunes(ctx.sessionID)
    currentPrunes.add(result.resolvedFromId)
    setSameStepPrunes(ctx.sessionID, currentPrunes)

    // Clear ID visibility
    setIdVisibility(ctx.sessionID, false)

    const rangeSize = result.toIndex - result.fromIndex + 1
    const idsChanged = args.from_id !== result.resolvedFromId || args.to_id !== result.resolvedToId
    
    if (idsChanged) {
      return `Archived ${rangeSize} messages from ${args.from_id} (resolved to ${result.resolvedFromId}) to ${args.to_id} (resolved to ${result.resolvedToId}).\nSummary: ${args.summary}\nIndex terms: ${args.index_terms.join(', ')}`
    } else {
      return `Archived ${rangeSize} messages from ${args.from_id} to ${args.to_id}.\nSummary: ${args.summary}\nIndex terms: ${args.index_terms.join(', ')}`
    }
  }
})