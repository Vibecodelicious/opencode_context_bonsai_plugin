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
    expect(guidance).toContain("Prune Flow")
    expect(guidance).toContain("Quality Gate")
    expect(guidance).toContain("Summary Quality")
    expect(guidance).toContain("Index Terms")
    expect(guidance).toContain("from_pattern + to_pattern")
    expect(guidance).toContain("oldest completed contiguous blocks first")
    expect(guidance).toContain("protect unresolved task instructions")
    expect(guidance).toContain("single turn")
    expect(guidance).toContain("do not output partitions or rankings")
    expect(guidance).toContain("significant drift requires 2 of 3 signals")
    expect(guidance).toContain("Default keep protected anchors")
    expect(guidance).toContain("Newest content is default keep")
    expect(guidance).toContain("completion certainty")
    expect(guidance).toContain("dependency risk")
    expect(guidance).toContain("Single contiguous range per prune call")
    expect(guidance).not.toContain("Two-Phase")
    expect(guidance).not.toContain("no arguments")
    expect(guidance).not.toContain("Multiple ranges")
    expect(guidance).not.toContain("first report candidates")
    expect(guidance).not.toContain("then prune")
    expect(guidance).not.toContain("state what you need to remember in a new message before pruning")
  })
})
