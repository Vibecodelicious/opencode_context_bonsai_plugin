import { describe, it, expect, beforeEach } from "bun:test"
import { retrieveTool, createRetrieveTool } from "./retrieve"
import { pruneToolDefinition } from "./prune"
import { makeArchivedMessage, makeUserMessage } from "./test/fixtures"
import { setSameStepPrunes } from "./state"
import { ARCHIVE_KEY, PLUGIN_ID } from "./constants"
import { createRuntimeCompat } from "./runtime-compat"

describe("retrieve tool", () => {
  const mockContext = {
    sessionID: "test-session",
    messageID: "test-msg",
    agent: "test-agent",
    directory: "/test",
    worktree: "/test",
    abort: new AbortController().signal,
    metadata: () => {},
    ask: async () => {},
    messages: [] as any[],
    updateMessage: undefined as any
  }

  beforeEach(() => {
    mockContext.messages = []
    mockContext.updateMessage = undefined
    setSameStepPrunes("test-session", new Set())
  })

  function toPluginMessage(msg: any) {
    return {
      info: {
        id: msg.id,
        sessionID: msg.sessionID,
        role: msg.role,
        metadata: msg.metadata,
        time: { created: msg.createdAt.getTime() }
      },
      parts: msg.parts
    }
  }

  it("should return error when anchor not found", async () => {
    const msg = makeUserMessage("msg1", "test-session", "Hello")
    mockContext.messages = [toPluginMessage(msg)]
    
    const result = await retrieveTool.execute({ anchor_id: "nonexistent" }, mockContext)
    
    expect(result).toBe("Error: Message nonexistent not found")
  })

  it("should return error when anchor has no archive", async () => {
    const msg = makeUserMessage("msg1", "test-session", "Hello")
    mockContext.messages = [toPluginMessage(msg)]
    
    const result = await retrieveTool.execute({ anchor_id: "msg1" }, mockContext)
    
    expect(result).toBe("Error: No archive found for message msg1")
  })

  it("treats legacy-only archive metadata as no archive", async () => {
    const legacyArchived = makeArchivedMessage("msg1", "test-session", "legacy-context-bonsai", {
      summary: "legacy summary",
      indexTerms: ["legacy"],
      rangeEnd: "msg2"
    })
    mockContext.messages = [toPluginMessage(legacyArchived)]

    const result = await retrieveTool.execute({ anchor_id: "msg1" }, mockContext)

    expect(result).toBe("Error: No archive found for message msg1")
  })

  it("should return error for same-step prune", async () => {
    const archived = makeArchivedMessage("msg1", "test-session", PLUGIN_ID, {
      summary: "Test summary",
      indexTerms: ["test"],
      rangeEnd: "msg2"
    })
    mockContext.messages = [toPluginMessage(archived)]
    
    // Add to same-step prunes
    setSameStepPrunes("test-session", new Set(["msg1"]))
    
    const result = await retrieveTool.execute({ anchor_id: "msg1" }, mockContext)
    
    expect(result).toBe("Error: This archive was created in the current step. Call context-bonsai-retrieve on the next turn.")
  })

  it("should clear metadata and return success message", async () => {
    const archived = makeArchivedMessage("msg1", "test-session", PLUGIN_ID, {
      summary: "Test summary", 
      indexTerms: ["test"],
      rangeEnd: "msg2"
    })
    const msg2 = makeUserMessage("msg2", "test-session", "End message")
    mockContext.messages = [toPluginMessage(archived), toPluginMessage(msg2)]
    
    let updatedId: string | undefined
    let updateFn: any
    mockContext.updateMessage = async (id: string, fn: any) => {
      updatedId = id
      updateFn = fn
    }
    
    const result = await retrieveTool.execute({ anchor_id: "msg1" }, mockContext)
    
    expect(result).toBe("Restored 2 messages from range msg1 to msg2. Original content is now visible.")
    expect(updatedId).toBe("msg1")
    
    // Test the update function
    const draft = { metadata: { [PLUGIN_ID]: { archive: {} } } }
    updateFn(draft)
    expect(draft.metadata[PLUGIN_ID]).toBeUndefined()
  })

  it("should handle single message range", async () => {
    const archived = makeArchivedMessage("msg1", "test-session", PLUGIN_ID, {
      summary: "Test summary",
      indexTerms: ["test"], 
      rangeEnd: "msg1"
    })
    mockContext.messages = [toPluginMessage(archived)]
    
    mockContext.updateMessage = async () => {}
    
    const result = await retrieveTool.execute({ anchor_id: "msg1" }, mockContext)
    
    expect(result).toBe("Restored 1 messages from range msg1 to msg1. Original content is now visible.")
  })

  it("returns exact compatibility error when message loading is unsupported", async () => {
    const compatTool = createRetrieveTool(createRuntimeCompat())
    const result = await compatTool.execute({ anchor_id: "msg1" }, { sessionID: "test-session" } as any)

    expect(result).toBe("Compatibility error: unable to load session messages in this runtime.")
  })

  it("returns exact compatibility error when message updates are unsupported", async () => {
    const compatTool = createRetrieveTool(createRuntimeCompat())
    const archived = makeArchivedMessage("msg1", "test-session", PLUGIN_ID, {
      summary: "Test summary",
      indexTerms: ["test"],
      rangeEnd: "msg1"
    })

    const result = await compatTool.execute({ anchor_id: "msg1" }, {
      sessionID: "test-session",
      messages: [toPluginMessage(archived)]
    } as any)

    expect(result).toBe("Compatibility error: message updates are unsupported in this runtime.")
  })

  it("supports prune/retrieve round-trip with canonical archive key", async () => {
    const msg1 = makeUserMessage("msg1", "test-session", "Hello")
    const msg2 = makeUserMessage("msg2", "test-session", "Hi there")
    const pluginMessages = [toPluginMessage(msg1), toPluginMessage(msg2)]

    mockContext.messages = pluginMessages
    mockContext.updateMessage = async (id: string, fn: any) => {
      const target = pluginMessages.find(msg => msg.info.id === id)
      if (!target) {
        return
      }

      const draft = { metadata: { ...(target.info.metadata || {}) } }
      fn(draft)
      target.info.metadata = draft.metadata
    }

    const pruneResult = await pruneToolDefinition.execute({
      from_pattern: "Hello",
      to_pattern: "Hi there",
      summary: "round-trip summary",
      index_terms: ["round-trip", "archive", "retrieve"]
    }, mockContext as any)

    expect(pruneResult).toContain("Archived 2 messages")
    expect((pluginMessages[0].info.metadata as any)[ARCHIVE_KEY].archive.rangeEnd).toBe("msg2")

    setSameStepPrunes("test-session", new Set())
    const retrieveResult = await retrieveTool.execute({ anchor_id: "msg1" }, mockContext)

    expect(retrieveResult).toBe("Restored 2 messages from range msg1 to msg2. Original content is now visible.")
    expect((pluginMessages[0].info.metadata as any)[ARCHIVE_KEY]).toBeUndefined()
  })
})
