import { describe, expect, test } from "bun:test"
import { 
  getTokenCache, setTokenCache,
  getModelLimitCache, setModelLimitCache,
  getIdVisibility, setIdVisibility,
  getSameStepPrunes, setSameStepPrunes,
  getTurnCount, setTurnCount,
  clearSameStepPrunes
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
    setTokenCache("session1", {inputTokens: 100, outputTokens: 50})
    setTokenCache("session2", {inputTokens: 200, outputTokens: 100})
    
    expect(getTokenCache("session1")).toEqual({inputTokens: 100, outputTokens: 50})
    expect(getTokenCache("session2")).toEqual({inputTokens: 200, outputTokens: 100})
  })

  test("clearSameStepPrunes resets to empty Set", () => {
    const testSet = new Set(["id1", "id2"])
    setSameStepPrunes("test-session", testSet)
    expect(getSameStepPrunes("test-session").size).toBe(2)
    
    clearSameStepPrunes("test-session")
    expect(getSameStepPrunes("test-session").size).toBe(0)
  })
})