import type { Plugin } from "@opencode-ai/plugin"
import { getSystemPromptGuidance } from "./prompt"

export const contextBonsai: Plugin = async (_input) => ({
  tool: {},
  event: async (_input) => {},
  "chat.params": async (_input, _output) => {},
  "experimental.chat.messages.transform": async (_input, _output) => {},
  "experimental.chat.system.transform": async (_input, output) => {
    output.system.push(getSystemPromptGuidance())
  }
})

export default contextBonsai
