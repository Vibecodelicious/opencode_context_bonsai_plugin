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

  const sessionID = event.properties.info.sessionID
  const tokens = (event.properties.info as unknown as AssistantMessage).tokens
  if (!tokens) return

  const total = getCompactionAlignedTokenCount(tokens)
  if (total <= 0) return

  setTokenCache(sessionID, { totalTokens: total })
}

export function formatGaugeText(used: number, modelLimit: number, percent: number): string {
  const baseGauge = `[CONTEXT GAUGE: ${used} / ${modelLimit} tokens (${percent}%)]`

  const selectionContract = 'Protect operational-rule and overarching-goal anchors, protect unresolved task instructions, and prune oldest completed contiguous blocks first. In a single turn, rank safe blocks by completion certainty, dependency risk, age, then reclaim size, execute prune immediately, and do not output partitions or rankings.'

  if (percent < 30) {
    return `${baseGauge} ${selectionContract} Then continue your work.`
  } else if (percent <= 60) {
    return `${baseGauge} ${selectionContract} Pruning is not destructive - a summary is left behind and the original content can be retrieved later.`
  } else if (percent <= 80) {
    return `${baseGauge} ${selectionContract} Newest content is default keep, with narrow exceptions for clearly completed or redundant recent blocks. significant drift requires 2 of 3 signals before pruning protected anchors; signal (c) is unmet reclaim below 60% usage or below 15% of usable budget while above 60%. Pruning is not destructive - a summary is left behind and the original content can be retrieved later.`
  } else {
    return `[CONTEXT GAUGE: ${used} / ${modelLimit} tokens (${percent}%) - PRUNE NOW] ${selectionContract} Newest content is default keep, with narrow exceptions for clearly completed or redundant recent blocks. significant drift requires 2 of 3 signals before pruning protected anchors; signal (c) is unmet reclaim below 60% usage or below 15% of usable budget while above 60%. Pruning is not destructive - a summary is left behind and the original content can be retrieved later. Failure to prune immediately will lead to significantly degraded performance.`
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
