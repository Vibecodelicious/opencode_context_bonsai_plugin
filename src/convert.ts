import type { Message, Part } from "@opencode-ai/sdk"
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
