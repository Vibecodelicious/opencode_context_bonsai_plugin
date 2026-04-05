import { describe, expect, test } from "bun:test"
import { 
  getTokenCache, setTokenCache,
  getModelLimitCache, setModelLimitCache,
  getIdVisibility, setIdVisibility,
  getSameStepPrunes, setSameStepPrunes,
  getTurnCount, setTurnCount,
  clearSameStepPrunes,
  clearSessionState
} from "./state"

describe("state management", () => {
  test("tokenCache defaults to null", () => {
    expect(getTokenCache("test-session")).toBeNull()
  })

  test("modelLimitCache defaults to null", () => {
    expect(getModelLimitCache("test-session")).toBeNull()
  })

  test("idVisibility defaults to false", () => {
    expect(getIdVisibility("test-session")).toBe(false)
  })

  test("sameStepPrunes defaults to empty Set", () => {
    const result = getSameStepPrunes("test-session")
    expect(result).toBeInstanceOf(Set)
    expect(result.size).toBe(0)
  })

  test("turnCount defaults to 0", () => {
    expect(getTurnCount("test-session")).toBe(0)
  })

  test("per-session isolation", () => {
    setTokenCache("session1", {totalTokens: 150})
    setTokenCache("session2", {totalTokens: 300})
    
    expect(getTokenCache("session1")).toEqual({totalTokens: 150})
    expect(getTokenCache("session2")).toEqual({totalTokens: 300})
  })

  test("clearSameStepPrunes resets to empty Set", () => {
    const testSet = new Set(["id1", "id2"])
    setSameStepPrunes("test-session", testSet)
    expect(getSameStepPrunes("test-session").size).toBe(2)
    
    clearSameStepPrunes("test-session")
    expect(getSameStepPrunes("test-session").size).toBe(0)
  })

  test("clearSessionState removes all session data", () => {
    const sessionID = "cleanup-test"
    
    setTokenCache(sessionID, {totalTokens: 150})
    setModelLimitCache(sessionID, { context: 1000, maxOutputTokens: 32000 })
    setIdVisibility(sessionID, true)
    setSameStepPrunes(sessionID, new Set(["id1"]))
    setTurnCount(sessionID, 5)
    
    clearSessionState(sessionID)
    
    expect(getTokenCache(sessionID)).toBeNull()
    expect(getModelLimitCache(sessionID)).toBeNull()
    expect(getIdVisibility(sessionID)).toBe(false)
    expect(getSameStepPrunes(sessionID).size).toBe(0)
    expect(getTurnCount(sessionID)).toBe(0)
  })
})