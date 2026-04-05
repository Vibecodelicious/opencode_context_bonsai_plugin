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

      handleTokenEvent(event as any)
      
      const cached = getTokenCache(sessionID)
      expect(cached).toEqual({ totalTokens: 150 })
    })

    test("falls back to structured token fields when total is absent", () => {
      const event = {
        type: "message.updated" as const,
        properties: {
          info: {
            sessionID,
            role: "assistant" as const,
            tokens: {
              input: 100,
              output: 50,
              cache: { write: 7 }
            }
          }
        }
      }

      handleTokenEvent(event as any)

      expect(getTokenCache(sessionID)).toEqual({ totalTokens: 157 })
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

      handleTokenEvent(event as any)
      
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

      handleTokenEvent(event as any)
      
      expect(getTokenCache(sessionID)).toBeNull()
    })
  })

  describe("handleChatParams", () => {
    test("caches input path and reserves output semantics when input exists", () => {
      const model = { limit: { input: 48000, context: 128000, output: 64000 } }

      handleChatParams(sessionID, model)

      expect(getModelLimitCache(sessionID)).toEqual({
        input: 48000,
        context: 128000,
        maxOutputTokens: 32000
      })
    })

    test("falls back to context path when input is absent", () => {
      const model = { limit: { context: 8000, output: 5000 } }

      handleChatParams(sessionID, model)

      expect(getModelLimitCache(sessionID)).toEqual({
        context: 8000,
        maxOutputTokens: 5000
      })
    })

    test("clears cache when both input and context are missing", () => {
      handleChatParams(sessionID, { limit: { output: 4000 } })

      expect(getModelLimitCache(sessionID)).toBeNull()
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
      handleChatParams(sessionID, { limit: { context: 50000 } })

      // First 4 calls should not inject
      for (let i = 0; i < 4; i++) {
        injectGauge(messages, sessionID, pluginID)
        expect(messages[0].parts).toHaveLength(1)
      }

      // 5th call should inject
      injectGauge(messages, sessionID, pluginID)
      expect(messages[0].parts).toHaveLength(2)
      expect((messages[0].parts[1] as any).text).toContain("[CONTEXT GAUGE:")
    })

    test("injects gauge with correct format", () => {
      const messages = [makeUserMessage("msg1", sessionID, "Hello")]
      handleTokenEvent({
        type: "message.updated",
        properties: { info: { sessionID, role: "assistant", tokens: { input: 100 } } }
      } as any)
      handleChatParams(sessionID, { limit: { context: 50000 } })

      // Skip to 5th turn
      for (let i = 0; i < 5; i++) {
        injectGauge(messages, sessionID, pluginID)
      }

      const gaugePart = messages[0].parts[1] as any
      expect(gaugePart.synthetic).toBe(true)
      expect(gaugePart.text).toContain("[CONTEXT GAUGE: 130 / 18000 tokens (1%)]")
      expect(gaugePart.text).toContain("continue your work")
    })

    test("uses input limit path with reserved headroom", () => {
      const messages = [makeUserMessage("msg1", sessionID, "Hello")]
      handleTokenEvent({
        type: "message.updated",
        properties: { info: { sessionID, role: "assistant", tokens: { input: 100 } } }
      } as any)
      handleChatParams(sessionID, { limit: { input: 25000, context: 90000, output: 16000 } })

      for (let i = 0; i < 5; i++) {
        injectGauge(messages, sessionID, pluginID)
      }

      const gaugePart = messages[0].parts[1] as any
      expect(gaugePart.text).toContain("[CONTEXT GAUGE: 130 / 9000 tokens (1%)]")
    })

    test("skips injection when usable budget is zero or negative", () => {
      const messages = [makeUserMessage("msg1", sessionID, "Hello")]
      handleTokenEvent({
        type: "message.updated",
        properties: { info: { sessionID, role: "assistant", tokens: { input: 100 } } }
      } as any)
      handleChatParams(sessionID, { limit: { input: 10000, output: 15000 } })

      for (let i = 0; i < 5; i++) {
        injectGauge(messages, sessionID, pluginID)
      }

      expect(messages[0].parts).toHaveLength(1)
      expect(getTurnCount(sessionID)).toBe(5)
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
      handleChatParams(sessionID, { limit: { context: 50000 } })

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

    test("should return medium severity message at 60%", () => {
      const result = formatGaugeText(6000, 10000, 60)
      expect(result).toContain('[CONTEXT GAUGE: 6000 / 10000 tokens (60%)]')
      expect(result).toContain('not destructive')
      expect(result).not.toContain('preserve key details')
    })

    test("should return high severity message for 61-80%", () => {
      const result = formatGaugeText(6100, 10000, 61)
      expect(result).toContain('[CONTEXT GAUGE: 6100 / 10000 tokens (61%)]')
      expect(result).toContain('Prune any completed')
      expect(result).toContain('continue your work')
      expect(result).toContain('not destructive')
      expect(result).toContain('preserve key details')
      expect(result).not.toContain('— PRUNE NOW')
    })

    test("should return high severity message at 80%", () => {
      const result = formatGaugeText(8000, 10000, 80)
      expect(result).toContain('preserve key details')
      expect(result).not.toContain('— PRUNE NOW')
    })

    test("should return critical severity message for >=81%", () => {
      const result = formatGaugeText(8100, 10000, 81)
      expect(result).toContain('[CONTEXT GAUGE: 8100 / 10000 tokens (81%) — PRUNE NOW]')
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