import type { Plugin } from "@opencode-ai/plugin"
import { getSystemPromptGuidance } from "./prompt"
import { PLUGIN_ID } from "./constants"
import { transformMessages } from "./transform"
import { getIdVisibility } from "./state"

export const contextBonsai: Plugin = async (_input) => ({
  tool: {},
  event: async (_input) => {},
  "chat.params": async (_input, _output) => {},
  "experimental.chat.messages.transform": async (input, output) => {
    const sessionID = (input as any).sessionID || output.messages[0]?.info.sessionID || 'default'
    const idVisibility = getIdVisibility(sessionID)
    
    // Convert to WithParts format for transform
    const messages = output.messages.map(msg => ({
      id: msg.info.id,
      sessionID: msg.info.sessionID,
      role: msg.info.role,
      parts: msg.parts,
      metadata: (msg.info as any).metadata || {},
      createdAt: new Date((msg.info as any).time?.created || Date.now())
    }))
    
    transformMessages(messages, PLUGIN_ID, idVisibility, sessionID)
    
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
