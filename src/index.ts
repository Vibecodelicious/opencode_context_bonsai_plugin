import type { Plugin } from "@opencode-ai/plugin"
import type { Message, Part } from "@opencode-ai/sdk"
import { getSystemPromptGuidance } from "./prompt"
import { PLUGIN_ID } from "./constants"
import { transformMessages } from "./transform"
import { getIdVisibility } from "./state"
import { handleTokenEvent, handleChatParams, injectGauge } from "./gauge"
import { retrieveTool } from "./retrieve"
import { pruneToolDefinition } from "./prune"
import type { WithParts } from "./test/fixtures"

export function convertPluginMessages(
  messages: { info: Message; parts: Part[] }[]
): WithParts[] {
  return messages.map(msg => ({
    id: msg.info.id,
    sessionID: msg.info.sessionID,
    role: msg.info.role,
    parts: msg.parts,
    // SDK types define Message without metadata; the hook input is typed as {} without sessionID
    // At runtime, metadata exists (added in Phase 1 upstream changes)
    // This cast can be removed when @opencode-ai/plugin types are updated
    metadata: (msg.info as any).metadata || {},
    createdAt: new Date((msg.info as any).time?.created || Date.now())
  }))
}

export const contextBonsai: Plugin = async (_input) => ({
  tool: {
    "context-bonsai:retrieve": retrieveTool,
    "context-bonsai:prune": pruneToolDefinition
  },
  event: async (input) => {
    handleTokenEvent(input.event)
  },
  "chat.params": async (input, _output) => {
    handleChatParams(input.sessionID, input.model)
  },
  "experimental.chat.messages.transform": async (input, output) => {
    const sessionID = (input as any).sessionID || output.messages[0]?.info.sessionID || 'default'
    const idVisibility = getIdVisibility(sessionID)
    
    // Convert to WithParts format for transform
    const messages = convertPluginMessages(output.messages)
    
    transformMessages(messages, PLUGIN_ID, idVisibility, sessionID)
    
    // Inject gauge after transform
    injectGauge(messages, sessionID, PLUGIN_ID)
    
    // Update output with transformed messages
    output.messages = messages.map(msg => ({
      info: {
        ...output.messages.find(m => m.info.id === msg.id)?.info!,
        metadata: msg.metadata
      },
      parts: msg.parts
    }))
  },
  "experimental.chat.system.transform": async (_input, output) => {
    output.system.push(getSystemPromptGuidance())
  }
})

export default contextBonsai
