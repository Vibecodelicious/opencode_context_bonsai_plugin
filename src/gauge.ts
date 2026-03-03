import type { Event as V1Event } from "@opencode-ai/sdk"
import type { AssistantMessage } from "@opencode-ai/sdk/v2"
import type { TextPart } from "@opencode-ai/sdk/v2"
import type { WithParts } from "./test/fixtures"
import { getTokenCache, setTokenCache, getModelLimitCache, setModelLimitCache, getTurnCount, setTurnCount } from "./state"

const GAUGE_CADENCE = 5 // Show gauge every N turns
const GAUGE_TOKEN_OVERHEAD = 30 // Approximate tokens for gauge message

function sumTokens(obj: any): number {
  if (typeof obj === 'number') return obj
  if (typeof obj !== 'object' || obj === null) return 0
  return Object.values(obj).reduce((sum: number, val) => sum + sumTokens(val), 0)
}

export function handleTokenEvent(event: V1Event): void {
  if (event.type !== "message.updated") return
  if (event.properties.info.role !== "assistant") return
  if (!event.properties.info.tokens || event.properties.info.tokens.input <= 0) return

  const sessionID = event.properties.info.sessionID
  // Cast to v2 AssistantMessage to access tokens.total field
  const tokens = (event.properties.info as unknown as AssistantMessage).tokens
  
  // Use tokens.total if available (v2 SDK types include this field)
  // Fall back to recursive sum if not present
  const total = tokens.total ?? sumTokens(tokens)
  
  setTokenCache(sessionID, { totalTokens: total })
}

export function handleChatParams(sessionID: string, model: any): void {
  const limit = model.limit?.input || model.limit?.context
  if (limit) {
    setModelLimitCache(sessionID, limit)
  }
}

export function injectGauge(messages: WithParts[], sessionID: string, pluginID: string): void {
  const tokenData = getTokenCache(sessionID)
  const modelLimit = getModelLimitCache(sessionID)
  
  if (!tokenData || !modelLimit) return

  const currentTurn = getTurnCount(sessionID)
  setTurnCount(sessionID, currentTurn + 1)
  
  if ((currentTurn + 1) % GAUGE_CADENCE !== 0) return

  // Find last user message
  let lastUserIndex = -1
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') {
      lastUserIndex = i
      break
    }
  }
  
  if (lastUserIndex === -1) return

  const used = tokenData.totalTokens + GAUGE_TOKEN_OVERHEAD
  const percent = Math.round((used / modelLimit) * 100)
  
  const gaugeText = `<system-reminder>\n[CONTEXT GAUGE: ${used} / ${modelLimit} tokens (${percent}%)]\n</system-reminder>`
  
  const gaugePart: TextPart = {
    id: `gauge-${sessionID}-${currentTurn + 1}`,
    sessionID,
    messageID: messages[lastUserIndex].id,
    type: 'text',
    text: gaugeText,
    synthetic: true
  }
  
  messages[lastUserIndex].parts.push(gaugePart)
}