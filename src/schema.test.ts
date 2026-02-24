import { describe, it, expect } from "bun:test"
import { getArchive, hasArchive } from "./schema"
import { makeArchivedMessage, makeUserMessage } from "./test/fixtures"

describe("schema", () => {
  const pluginID = "test-plugin"
  const sessionID = "session1"

  it("getArchive returns archive data when present", () => {
    const msg = makeArchivedMessage("msg1", sessionID, pluginID, {
      summary: "Test summary",
      indexTerms: ["term1", "term2"],
      rangeEnd: "msg2"
    })

    const archive = getArchive(msg, pluginID)
    expect(archive).toEqual({
      summary: "Test summary",
      indexTerms: ["term1", "term2"],
      rangeEnd: "msg2"
    })
  })

  it("getArchive returns null when archive not present", () => {
    const msg = makeUserMessage("msg1", sessionID, "Hello")
    expect(getArchive(msg, pluginID)).toBeNull()
  })

  it("getArchive returns null for invalid metadata", () => {
    const msg = makeUserMessage("msg1", sessionID, "Hello", {
      metadata: { [pluginID]: { invalid: "data" } }
    })
    expect(getArchive(msg, pluginID)).toBeNull()
  })

  it("hasArchive returns true when archive present", () => {
    const msg = makeArchivedMessage("msg1", sessionID, pluginID, {
      summary: "Test",
      indexTerms: [],
      rangeEnd: "msg2"
    })
    expect(hasArchive(msg, pluginID)).toBe(true)
  })

  it("hasArchive returns false when archive not present", () => {
    const msg = makeUserMessage("msg1", sessionID, "Hello")
    expect(hasArchive(msg, pluginID)).toBe(false)
  })
})