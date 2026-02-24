import { tool, type ToolDefinition } from '@opencode-ai/plugin'
import { setIdVisibility, getSameStepPrunes, setSameStepPrunes } from './state'
import { summarizeRange } from './summarize'
import { PLUGIN_ID } from './constants'
import type { WithParts } from './test/fixtures'

function findMessageIndex(messages: WithParts[], id: string): number | null {
  const index = messages.findIndex(msg => msg.id === id)
  return index === -1 ? null : index
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
): string | null {
  const fromIndex = findMessageIndex(messages, fromId)
  const toIndex = findMessageIndex(messages, toId)

  if (fromIndex === null) return `Message ID ${fromId} not found`
  if (toIndex === null) return `Message ID ${toId} not found`

  if (fromIndex >= toIndex) {
    return `from_id must precede to_id chronologically`
  }

  if (isInPrunedRange(messages, fromId, pluginID)) {
    return `from_id ${fromId} falls within an already-pruned range`
  }
  if (isInPrunedRange(messages, toId, pluginID)) {
    return `to_id ${toId} falls within an already-pruned range`
  }

  // Check for pending/running tool calls in range
  for (let i = fromIndex; i <= toIndex; i++) {
    const msg = messages[i]
    for (const part of msg.parts) {
      if (part.type === 'tool' && (part.state?.status === 'pending' || part.state?.status === 'running')) {
        return `Range contains incomplete tool calls that would produce malformed history`
      }
    }
  }

  return null
}

export const pruneToolDefinition: ToolDefinition = tool({
  description: 'Archive a range of conversation messages with LLM-generated summary. Phase 1: enable message ID visibility. Phase 2: archive specified range.',
  args: {
    from_id: tool.schema.string().optional().describe('Start message ID for archiving (Phase 2)'),
    to_id: tool.schema.string().optional().describe('End message ID for archiving (Phase 2)'),
    reason: tool.schema.string().optional().describe('Reason for archiving this range (Phase 2)')
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

    const validationError = validatePruneInput(messages, args.from_id, args.to_id, PLUGIN_ID)
    if (validationError) {
      return `Validation error: ${validationError}`
    }

    const fromIndex = findMessageIndex(messages, args.from_id)!
    const toIndex = findMessageIndex(messages, args.to_id)!
    const rangeMessages = messages.slice(fromIndex, toIndex + 1)

    try {
      // Summarize the range
      const { summary, indexTerms } = await summarizeRange(rangeMessages, (ctx as any).languageModel)

      // Write archive metadata to the start message
      await (ctx as any).updateMessage(args.from_id, (draft: any) => {
        if (!draft.metadata) draft.metadata = {}
        draft.metadata[PLUGIN_ID] = {
          archive: {
            summary,
            indexTerms,
            rangeEnd: args.to_id
          }
        }
      })

      // Add to same-step prune set
      const currentPrunes = getSameStepPrunes(ctx.sessionID)
      currentPrunes.add(args.from_id)
      setSameStepPrunes(ctx.sessionID, currentPrunes)

      // Clear ID visibility
      setIdVisibility(ctx.sessionID, false)

      const rangeSize = toIndex - fromIndex + 1
      return `Archived ${rangeSize} messages from ${args.from_id} to ${args.to_id}. Summary: ${summary.substring(0, 100)}${summary.length > 100 ? '...' : ''}`

    } catch (error) {
      return `Summarization failed: ${error instanceof Error ? error.message : 'Unknown error'}`
    }
  }
})