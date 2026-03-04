import { describe, expect, test } from "bun:test"
import { getSystemPromptGuidance } from "./prompt"

describe("getSystemPromptGuidance", () => {
  test("returns a string", () => {
    const guidance = getSystemPromptGuidance()
    expect(typeof guidance).toBe("string")
    expect(guidance.length).toBeGreaterThan(0)
  })

  test("contains key terms", () => {
    const guidance = getSystemPromptGuidance()
    expect(guidance).toContain("context-bonsai-prune")
    expect(guidance).toContain("context-bonsai-retrieve")
    expect(guidance).toContain("Two-Phase Prune Flow")
    expect(guidance).toContain("Quality Gate")
    expect(guidance).toContain("Summary Quality")
    expect(guidance).toContain("Index Terms")
    expect(guidance).toContain("from_id, to_id")
  })
})