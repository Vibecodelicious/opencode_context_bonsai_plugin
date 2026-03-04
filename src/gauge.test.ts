import { describe, test, expect, beforeEach } from "bun:test"
import { handleTokenEvent, handleChatParams, injectGauge, formatGaugeText } from "./gauge"
import { getTokenCache, getModelLimitCache, getTurnCount, clearSessionState } from "./state"
import { makeUserMessage, makeAssistantMessage } from "./test/fixtures"

describe("gauge", () => {
  const sessionID = "test-session"
  const pluginID = "test-plugin"

  beforeEach(() => {
    clearSessionState(sessionID)
  })

  describe("handleTokenEvent", () => {
    test("extracts and caches token data from assistant message.updated events", () => {
      const event = {
        type: "message.updated" as const,
        properties: {
          info: {
            sessionID,
            role: "assistant" as const,
            tokens: { input: 100, output: 50 }
          }
        }
      }

      handleTokenEvent(event)
      
      const cached = getTokenCache(sessionID)
      expect(cached).toEqual({ totalTokens: 150 })
    })

    test("ignores non-message.updated events", () => {
      const event = {
        type: "message.created" as const,
        properties: { info: { sessionID, role: "assistant" as const, tokens: { input: 100 } } }
      }

      handleTokenEvent(event as any)
      
      expect(getTokenCache(sessionID)).toBeNull()
    })

    test("ignores user message events", () => {
      const event = {
        type: "message.updated" as const,
        properties: {
          info: {
            sessionID,
            role: "user" as const,
            tokens: { input: 100 }
          }
        }
      }

      handleTokenEvent(event)
      
      expect(getTokenCache(sessionID)).toBeNull()
    })

    test("ignores events with zero input tokens", () => {
      const event = {
        type: "message.updated" as const,
        properties: {
          info: {
            sessionID,
            role: "assistant" as const,
            tokens: { input: 0, output: 50 }
          }
        }
      }

      handleTokenEvent(event)
      
      expect(getTokenCache(sessionID)).toBeNull()
    })
  })

  describe("handleChatParams", () => {
    test("caches model.limit.input when available", () => {
      const model = { limit: { input: 4000, context: 8000 } }
      
      handleChatParams(sessionID, model)
      
      expect(getModelLimitCache(sessionID)).toBe(4000)
    })

    test("falls back to model.limit.context", () => {
      const model = { limit: { context: 8000 } }
      
      handleChatParams(sessionID, model)
      
      expect(getModelLimitCache(sessionID)).toBe(8000)
    })
  })

  describe("injectGauge", () => {
    test("skips when no token cache", () => {
      const messages = [makeUserMessage("msg1", sessionID, "Hello")]
      
      injectGauge(messages, sessionID, pluginID)
      
      expect(messages[0].parts).toHaveLength(1)
    })

    test("skips when no model limit cache", () => {
      const messages = [makeUserMessage("msg1", sessionID, "Hello")]
      handleTokenEvent({
        type: "message.updated",
        properties: { info: { sessionID, role: "assistant", tokens: { input: 100 } } }
      } as any)
      
      injectGauge(messages, sessionID, pluginID)
      
      expect(messages[0].parts).toHaveLength(1)
    })

    test("respects cadence - only injects every 5th turn", () => {
      const messages = [makeUserMessage("msg1", sessionID, "Hello")]
      handleTokenEvent({
        type: "message.updated",
        properties: { info: { sessionID, role: "assistant", tokens: { input: 100 } } }
      } as any)
      handleChatParams(sessionID, { limit: { context: 4000 } })

      // First 4 calls should not inject
      for (let i = 0; i < 4; i++) {
        injectGauge(messages, sessionID, pluginID)
        expect(messages[0].parts).toHaveLength(1)
      }

      // 5th call should inject
      injectGauge(messages, sessionID, pluginID)
      expect(messages[0].parts).toHaveLength(2)
      expect(messages[0].parts[1].text).toContain("[CONTEXT GAUGE:")
    })

    test("injects gauge with correct format", () => {
      const messages = [makeUserMessage("msg1", sessionID, "Hello")]
      handleTokenEvent({
        type: "message.updated",
        properties: { info: { sessionID, role: "assistant", tokens: { input: 100 } } }
      } as any)
      handleChatParams(sessionID, { limit: { context: 4000 } })

      // Skip to 5th turn
      for (let i = 0; i < 5; i++) {
        injectGauge(messages, sessionID, pluginID)
      }

      const gaugePart = messages[0].parts[1]
      expect(gaugePart.synthetic).toBe(true)
      expect(gaugePart.text).toContain("[CONTEXT GAUGE: 130 / 4000 tokens (3%)]")
      expect(gaugePart.text).toContain("continue your work")
    })

    test("appends to last user message", () => {
      const messages = [
        makeUserMessage("msg1", sessionID, "First"),
        makeAssistantMessage("msg2", sessionID, "Response"),
        makeUserMessage("msg3", sessionID, "Second")
      ]
      handleTokenEvent({
        type: "message.updated",
        properties: { info: { sessionID, role: "assistant", tokens: { input: 100 } } }
      } as any)
      handleChatParams(sessionID, { limit: { context: 4000 } })

      // Skip to 5th turn
      for (let i = 0; i < 5; i++) {
        injectGauge(messages, sessionID, pluginID)
      }

      expect(messages[0].parts).toHaveLength(1) // First user message unchanged
      expect(messages[2].parts).toHaveLength(2) // Last user message has gauge
    })
  })

  describe("formatGaugeText", () => {
    test("should return low severity message for <30%", () => {
      const result = formatGaugeText(1000, 10000, 10)
      expect(result).toContain('[CONTEXT GAUGE: 1000 / 10000 tokens (10%)]')
      expect(result).toContain('Prune any completed')
      expect(result).toContain('continue your work')
      expect(result).not.toContain('not destructive')
    })

    test("should return low severity message at 29%", () => {
      const result = formatGaugeText(2900, 10000, 29)
      expect(result).toContain('[CONTEXT GAUGE: 2900 / 10000 tokens (29%)]')
      expect(result).toContain('continue your work')
      expect(result).not.toContain('not destructive')
    })

    test("should return medium severity message for 30-59%", () => {
      const result = formatGaugeText(3000, 10000, 30)
      expect(result).toContain('[CONTEXT GAUGE: 3000 / 10000 tokens (30%)]')
      expect(result).toContain('Prune any completed')
      expect(result).toContain('continue your work')
      expect(result).toContain('not destructive')
      expect(result).not.toContain('preserve key details')
    })

    test("should return medium severity message at 59%", () => {
      const result = formatGaugeText(5900, 10000, 59)
      expect(result).toContain('not destructive')
      expect(result).not.toContain('preserve key details')
    })

    test("should return high severity message for 60-79%", () => {
      const result = formatGaugeText(6000, 10000, 60)
      expect(result).toContain('[CONTEXT GAUGE: 6000 / 10000 tokens (60%)]')
      expect(result).toContain('Prune any completed')
      expect(result).toContain('continue your work')
      expect(result).toContain('not destructive')
      expect(result).toContain('preserve key details')
      expect(result).not.toContain('— PRUNE NOW')
    })

    test("should return high severity message at 79%", () => {
      const result = formatGaugeText(7900, 10000, 79)
      expect(result).toContain('preserve key details')
      expect(result).not.toContain('— PRUNE NOW')
    })

    test("should return critical severity message for >=80%", () => {
      const result = formatGaugeText(8000, 10000, 80)
      expect(result).toContain('[CONTEXT GAUGE: 8000 / 10000 tokens (80%)] — PRUNE NOW]')
      expect(result).toContain('Prune any completed')
      expect(result).toContain('continue your work')
      expect(result).toContain('not destructive')
      expect(result).toContain('preserve key details')
      expect(result).toContain('Failure to prune immediately')
    })

    test("should return critical severity message at 100%", () => {
      const result = formatGaugeText(10000, 10000, 100)
      expect(result).toContain('— PRUNE NOW]')
      expect(result).toContain('Failure to prune immediately')
    })
  })
})