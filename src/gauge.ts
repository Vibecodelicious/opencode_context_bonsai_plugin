import type { Event as V1Event } from "@opencode-ai/sdk"
import type { AssistantMessage } from "@opencode-ai/sdk/v2"
import type { TextPart } from "@opencode-ai/sdk/v2"
import type { WithParts } from "./test/fixtures"
import { getTokenCache, setTokenCache, getModelLimitCache, setModelLimitCache, getTurnCount, setTurnCount } from "./state"

const GAUGE_CADENCE = 5 // Show gauge every N turns
const GAUGE_TOKEN_OVERHEAD = 30 // Approximate tokens for gauge message
const MAX_OUTPUT_TOKENS_FALLBACK = 32000
const RESERVED_HEADROOM_MAX = 20000

function getCompactionAlignedTokenCount(tokens: AssistantMessage["tokens"]): number {
  const input = tokens?.input ?? 0
  const output = tokens?.output ?? 0
  const cacheRead = tokens?.cache?.read ?? 0
  const cacheWrite = tokens?.cache?.write ?? 0

  return tokens?.total || (input + output + cacheRead + cacheWrite)
}

function getUsableBudget(modelLimit: { input?: number; context?: number; maxOutputTokens: number }): number {
  if (typeof modelLimit.input === "number") {
    const reserved = Math.min(RESERVED_HEADROOM_MAX, modelLimit.maxOutputTokens)
    return modelLimit.input - reserved
  }

  if (typeof modelLimit.context === "number") {
    return modelLimit.context - modelLimit.maxOutputTokens
  }

  return 0
}

export function handleTokenEvent(event: V1Event): void {
  if (event.type !== "message.updated") return
  if (event.properties.info.role !== "assistant") return
  if (!event.properties.info.tokens || event.properties.info.tokens.input <= 0) return

  const sessionID = event.properties.info.sessionID
  const tokens = (event.properties.info as unknown as AssistantMessage).tokens
  const total = getCompactionAlignedTokenCount(tokens)

  setTokenCache(sessionID, { totalTokens: total })
}

export function formatGaugeText(used: number, modelLimit: number, percent: number): string {
  const baseGauge = `[CONTEXT GAUGE: ${used} / ${modelLimit} tokens (${percent}%)]`
  
  if (percent < 30) {
    return `${baseGauge} Prune any completed, no-longer-useful context now and then continue your work.`
  } else if (percent <= 60) {
    return `${baseGauge} Prune any completed, no-longer-useful context now and then continue your work. Pruning is not destructive — a summary is left behind and the original content can be retrieved later.`
  } else if (percent <= 80) {
    return `${baseGauge} Prune any completed, no-longer-useful context now and then continue your work. Pruning is not destructive — a summary is left behind and the original content can be retrieved later. Before pruning, you can preserve key details by stating what you need to remember in a new message (e.g., "I'm going to prune the messages from the previous debugging session, but I need to remember X"). This message persists separately from the pruning summary.`
  } else {
    return `[CONTEXT GAUGE: ${used} / ${modelLimit} tokens (${percent}%) — PRUNE NOW] Prune any completed, no-longer-useful context now and then continue your work. Pruning is not destructive — a summary is left behind and the original content can be retrieved later. Before pruning, you can preserve key details by stating what you need to remember in a new message (e.g., "I'm going to prune msg_abc through msg_def but I need to remember X"). This message persists separately from the pruning summary. Failure to prune immediately will lead to significantly degraded performance.`
  }
}

export function handleChatParams(sessionID: string, model: any): void {
  const input = model.limit?.input
  const context = model.limit?.context
  const output = model.limit?.output
  const maxOutputTokens = typeof output === "number"
    ? Math.min(output, MAX_OUTPUT_TOKENS_FALLBACK)
    : MAX_OUTPUT_TOKENS_FALLBACK

  if (typeof input === "number") {
    setModelLimitCache(sessionID, { input, context, maxOutputTokens })
    return
  }

  if (typeof context === "number") {
    setModelLimitCache(sessionID, { context, maxOutputTokens })
    return
  }

  setModelLimitCache(sessionID, null)
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
  const usableBudget = getUsableBudget(modelLimit)

  if (usableBudget <= 0) return

  const percent = Math.round((used / usableBudget) * 100)
  const gaugeText = `<system-reminder>\n${formatGaugeText(used, usableBudget, percent)}\n</system-reminder>`
  
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