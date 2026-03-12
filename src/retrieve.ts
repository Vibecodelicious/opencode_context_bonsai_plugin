import { tool, type ToolDefinition } from "@opencode-ai/plugin"
import { getArchive } from "./schema"
import { getSameStepPrunes } from "./state"
import { PLUGIN_ID } from "./constants"
import type { WithParts } from "./test/fixtures"
import { createRuntimeCompat, isRuntimeCompatError, type RuntimeCompat } from "./runtime-compat"
import { captureDiscoveryRoot } from './discovery-dump'

export function createRetrieveTool(runtimeCompat: RuntimeCompat): ToolDefinition {
  return tool({
    description: "Restore previously pruned conversation content by clearing archive metadata from the anchor message",
    args: {
      anchor_id: tool.schema.string().describe("The ID of the anchor message to restore")
    },
    async execute(args, ctx) {
      await captureDiscoveryRoot('toolExecuteContext', ctx)

      const { anchor_id } = args
      let messages: WithParts[]

      try {
        messages = await runtimeCompat.loadMessages(ctx)
      } catch (error) {
        if (isRuntimeCompatError(error)) {
          return error.message
        }

        throw error
      }

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
      try {
        await runtimeCompat.updateMessage(ctx, anchor_id, (draft: any) => {
          delete draft.metadata[PLUGIN_ID]
        })
      } catch (error) {
        if (isRuntimeCompatError(error)) {
          return error.message
        }

        throw error
      }

      return `Restored ${messageCount} messages from range ${anchor_id} to ${archive.rangeEnd}. Original content is now visible.`
    }
  })
}

export const retrieveTool: ToolDefinition = createRetrieveTool(createRuntimeCompat())
