import { tool, type ToolDefinition } from "@opencode-ai/plugin"
import { getArchive } from "./schema"
import { getSameStepPrunes } from "./state"
import { PLUGIN_ID } from "./constants"
import type { WithParts } from "./test/fixtures"

export const retrieveTool: ToolDefinition = tool({
  description: "Restore previously pruned conversation content by clearing archive metadata from the anchor message",
  args: {
    anchor_id: tool.schema.string().describe("The ID of the anchor message to restore")
  },
  async execute(args, ctx) {
    const { anchor_id } = args
    
    // Convert messages to WithParts format
    const messages: WithParts[] = (ctx as any).messages.map((msg: any) => ({
      id: msg.info.id,
      sessionID: msg.info.sessionID,
      role: msg.info.role,
      parts: msg.parts,
      metadata: (msg.info as any).metadata || {},
      createdAt: new Date((msg.info as any).time?.created || Date.now())
    }))
    
    // Find anchor in messages
    const anchor = messages.find(msg => msg.id === anchor_id)
    
    if (!anchor) {
      return `Error: Message ${anchor_id} not found`
    }
    
    // Check if anchor has archive metadata
    const archive = getArchive(anchor, PLUGIN_ID)
    if (!archive) {
      return `Error: No archive found for message ${anchor_id}`
    }
    
    // Same-step guard: check if anchor was pruned in current step
    const sameStepPrunes = getSameStepPrunes(ctx.sessionID)
    if (sameStepPrunes.has(anchor_id)) {
      return "Error: This archive was created in the current step. Call context-bonsai-retrieve on the next turn."
    }
    
    // Count messages in range for status message
    const rangeEndIndex = messages.findIndex(msg => msg.id === archive.rangeEnd)
    const anchorIndex = messages.findIndex(msg => msg.id === anchor_id)
    let messageCount = 1
    
    if (rangeEndIndex !== -1 && rangeEndIndex !== anchorIndex) {
      const start = Math.min(anchorIndex, rangeEndIndex)
      const end = Math.max(anchorIndex, rangeEndIndex)
      messageCount = end - start + 1
    }
    
    // Clear archive metadata
    await (ctx as any).updateMessage(anchor_id, (draft: any) => {
      delete draft.metadata[PLUGIN_ID]
    })
    
    return `Restored ${messageCount} messages from range ${anchor_id} to ${archive.rangeEnd}. Original content is now visible.`
  }
})