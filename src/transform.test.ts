import { describe, it, expect } from "bun:test"
import { transformMessages } from "./transform"
import { makeUserMessage, makeAssistantMessage, makeArchivedMessage } from "./test/fixtures"
import { ARCHIVE_KEY } from "./constants"

describe("transformMessages", () => {
  const sessionID = "session1"

  it("single archive: anchor replaced, followers removed", () => {
    const messages = [
      makeUserMessage("msg1", sessionID, "Hello"),
      makeArchivedMessage("msg2", sessionID, ARCHIVE_KEY, {
        summary: "Test summary",
        indexTerms: ["term1", "term2"],
        rangeEnd: "msg4"
      }),
      makeAssistantMessage("msg3", sessionID, "Middle"),
      makeAssistantMessage("msg4", sessionID, "End"),
      makeUserMessage("msg5", sessionID, "After")
    ]

    transformMessages(messages, false, sessionID)

    expect(messages).toHaveLength(3)
    expect(messages[0].id).toBe("msg1")
    expect(messages[1].id).toBe("msg2")
    expect(messages[2].id).toBe("msg5")
    
    // Check placeholder content
    expect(messages[1].parts).toHaveLength(1)
    expect(messages[1].parts[0].type).toBe("text")
    expect(messages[1].parts[0].synthetic).toBe(true)
    expect(messages[1].parts[0].text).toContain("[PRUNED: msg2 to msg4]")
    expect(messages[1].parts[0].text).toContain("Summary: Test summary")
    expect(messages[1].parts[0].text).toContain("Index: term1, term2")
  })

  it("multiple archives: both rendered correctly", () => {
    const messages = [
      makeArchivedMessage("msg1", sessionID, ARCHIVE_KEY, {
        summary: "First summary",
        indexTerms: ["a"],
        rangeEnd: "msg2"
      }),
      makeAssistantMessage("msg2", sessionID, "End1"),
      makeArchivedMessage("msg3", sessionID, ARCHIVE_KEY, {
        summary: "Second summary", 
        indexTerms: ["b"],
        rangeEnd: "msg4"
      }),
      makeAssistantMessage("msg4", sessionID, "End2")
    ]

    transformMessages(messages, false, sessionID)

    expect(messages).toHaveLength(2)
    expect(messages[0].parts[0].text).toContain("First summary")
    expect(messages[1].parts[0].text).toContain("Second summary")
  })

  it("missing rangeEnd: anchor-only replacement", () => {
    const messages = [
      makeUserMessage("msg1", sessionID, "Hello"),
      makeArchivedMessage("msg2", sessionID, ARCHIVE_KEY, {
        summary: "Test summary",
        indexTerms: ["term1"],
        rangeEnd: "missing"
      }),
      makeAssistantMessage("msg3", sessionID, "After")
    ]

    transformMessages(messages, false, sessionID)

    expect(messages).toHaveLength(3)
    expect(messages[1].parts[0].synthetic).toBe(true)
    expect(messages[1].parts[0].text).toContain("[PRUNED: msg2 to missing]")
  })

  it("single-message range: anchor replaced, no followers", () => {
    const messages = [
      makeUserMessage("msg1", sessionID, "Hello"),
      makeArchivedMessage("msg2", sessionID, ARCHIVE_KEY, {
        summary: "Self range",
        indexTerms: [],
        rangeEnd: "msg2"
      }),
      makeAssistantMessage("msg3", sessionID, "After")
    ]

    transformMessages(messages, false, sessionID)

    expect(messages).toHaveLength(3)
    expect(messages[1].parts[0].synthetic).toBe(true)
  })

  it("ID prefixing enabled: non-synthetic text parts get prefix", () => {
    const messages = [
      makeUserMessage("msg1", sessionID, "Hello"),
      makeAssistantMessage("msg2", sessionID, "World")
    ]

    transformMessages(messages, true, sessionID)

    expect(messages[0].parts[0].text).toBe("[msg:msg1] Hello")
    expect(messages[1].parts[0].text).toBe("[msg:msg2] World")
  })

  it("ID prefixing enabled, synthetic-only message: ID part inserted", () => {
    const messages = [
      makeArchivedMessage("msg1", sessionID, ARCHIVE_KEY, {
        summary: "Test",
        indexTerms: [],
        rangeEnd: "msg1"
      })
    ]

    transformMessages(messages, true, sessionID)

    expect(messages[0].parts).toHaveLength(2)
    expect(messages[0].parts[0].text).toBe("[msg:msg1]")
    expect(messages[0].parts[0].synthetic).toBe(true)
    expect(messages[0].parts[1].synthetic).toBe(true)
  })

  it("ID prefixing disabled: messages unchanged", () => {
    const messages = [
      makeUserMessage("msg1", sessionID, "Hello")
    ]

    transformMessages(messages, false, sessionID)

    expect(messages[0].parts[0].text).toBe("Hello")
  })

  it("no archives: messages pass through", () => {
    const messages = [
      makeUserMessage("msg1", sessionID, "Hello"),
      makeAssistantMessage("msg2", sessionID, "World")
    ]

    transformMessages(messages, false, sessionID)

    expect(messages).toHaveLength(2)
    expect(messages[0].parts[0].text).toBe("Hello")
    expect(messages[1].parts[0].text).toBe("World")
  })

  it("empty messages array: no crash", () => {
    const messages: any[] = []
    
    expect(() => {
      transformMessages(messages, false, sessionID)
    }).not.toThrow()
    
    expect(messages).toHaveLength(0)
  })
})
