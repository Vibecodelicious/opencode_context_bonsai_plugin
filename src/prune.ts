import { tool, type ToolDefinition } from '@opencode-ai/plugin'
import { setIdVisibility, getSameStepPrunes, setSameStepPrunes } from './state'
import type { WithParts } from './test/fixtures'
import { resolvePatternBoundary } from './prune-pattern'
import { createRuntimeCompat, isRuntimeCompatError, type RuntimeCompat } from './runtime-compat'
import { getArchive, setArchiveMetadata } from './schema'

function findMessageIndex(messages: WithParts[], id: string): number | null {
  const index = messages.findIndex(msg => msg.id === id)
  return index === -1 ? null : index
}

export function resolveToStoredMessage(messages: WithParts[], messageId: string): string {
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

function isInPrunedRange(messages: WithParts[], id: string): boolean {
  for (const msg of messages) {
    const archive = getArchive(msg)
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
  toId: string
): { error: string } | { resolvedFromId: string; resolvedToId: string; fromIndex: number; toIndex: number } {
  try {
    const resolvedFromId = resolveToStoredMessage(messages, fromId)
    const resolvedToId = resolveToStoredMessage(messages, toId)
    
    const fromIndex = findMessageIndex(messages, resolvedFromId)!
    const toIndex = findMessageIndex(messages, resolvedToId)!

    if (fromIndex > toIndex) {
      return { error: `from_pattern must resolve to a message that precedes to_pattern chronologically` }
    }

    if (isInPrunedRange(messages, resolvedFromId)) {
      return { error: `from_pattern resolved to ${fromId}, which falls within an already-pruned range` }
    }
    if (isInPrunedRange(messages, resolvedToId)) {
      return { error: `to_pattern resolved to ${toId}, which falls within an already-pruned range` }
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

export function createPruneToolDefinition(runtimeCompat: RuntimeCompat): ToolDefinition {
  return tool({
    description: 'Archive a range of conversation messages with a summary using pattern boundaries.',
    args: {
      from_pattern: tool.schema.string().optional().describe('Pattern used to resolve start message ID'),
      to_pattern: tool.schema.string().optional().describe('Pattern used to resolve end message ID'),
      reason: tool.schema.string().optional().describe('Reason for archiving this range'),
      summary: tool.schema.string().optional().describe('Concise summary (1-3 sentences) of the archived content'),
      index_terms: tool.schema.array(tool.schema.string()).optional().describe('Keywords for retrieval, 3-8 terms')
    },
    async execute(rawArgs, ctx) {
      const args = rawArgs as any
      let messages: WithParts[]

      try {
        messages = await runtimeCompat.loadMessages(ctx)
      } catch (error) {
        if (isRuntimeCompatError(error)) {
          return error.message
        }

        throw error
      }

    const hasFromId = args.from_id !== undefined
    const hasToId = args.to_id !== undefined
    const hasFromPattern = args.from_pattern !== undefined
    const hasToPattern = args.to_pattern !== undefined
    const hasAnyIdSelector = hasFromId || hasToId
    const hasAnyPatternSelector = hasFromPattern || hasToPattern

    if (hasAnyIdSelector) {
      return 'ID selectors are no longer supported; use from_pattern and to_pattern.'
    }

    if (!hasAnyPatternSelector) {
      return 'Phase 2 requires from_pattern and to_pattern (pattern-only mode).'
    }

    if (!hasFromPattern || !hasToPattern) {
      return 'Pattern mode requires both from_pattern and to_pattern.'
    }

    if (!args.summary) {
      return 'Prune requires summary parameter'
    }

    if (!args.index_terms) {
      return 'Prune requires index_terms parameter'
    }

    if (args.summary.trim() === '') {
      return 'summary cannot be empty'
    }

    if (args.index_terms.length === 0) {
      return 'index_terms cannot be empty'
    }

    let fromId: string
    let toId: string

    try {
      fromId = resolvePatternBoundary(messages, args.from_pattern!)
    } catch (error: any) {
      return error.message
    }

    try {
      toId = resolvePatternBoundary(messages, args.to_pattern!)
    } catch (error: any) {
      return error.message
    }

    const result = validatePruneInput(messages, fromId, toId)
    if ('error' in result) {
      return `Validation error: ${result.error}`
    }

      // Write archive metadata to the start message
      try {
        await runtimeCompat.updateMessage(ctx, result.resolvedFromId, (draft: any) => {
          setArchiveMetadata(draft, {
            summary: args.summary,
            indexTerms: args.index_terms,
            rangeEnd: result.resolvedToId
          })
        })
      } catch (error) {
        if (isRuntimeCompatError(error)) {
          return error.message
        }

        throw error
      }


      // Add to same-step prune set
      const currentPrunes = getSameStepPrunes(ctx.sessionID)
      currentPrunes.add(result.resolvedFromId)
      setSameStepPrunes(ctx.sessionID, currentPrunes)

      // Clear ID visibility
      setIdVisibility(ctx.sessionID, false)

      const rangeSize = result.toIndex - result.fromIndex + 1
      return `Archived ${rangeSize} messages from pattern "${args.from_pattern}" (resolved to ${result.resolvedFromId}) to pattern "${args.to_pattern}" (resolved to ${result.resolvedToId}).\nSummary: ${args.summary}\nIndex terms: ${args.index_terms.join(', ')}`
    }
  })
}

export const pruneToolDefinition: ToolDefinition = createPruneToolDefinition(createRuntimeCompat())
