import { describe, expect, test, mock } from "bun:test"
import { contextBonsai } from "./index"
import { convertPluginMessages } from "./convert"
import { transformMessages } from "./transform"
import { PLUGIN_ID } from "./constants"
import { makeArchivedMessage } from "./test/fixtures"

describe("contextBonsai", () => {
  test("exports a plugin factory function", () => {
    expect(typeof contextBonsai).toBe("function")
  })

  test("returns hooks object with all expected keys", async () => {
    const hooks = await contextBonsai({} as any)
    expect(hooks).toBeDefined()
    expect(typeof hooks).toBe("object")
    expect(hooks.tool).toBeDefined()
    expect(hooks.event).toBeDefined()
    expect(hooks["chat.params"]).toBeDefined()
    expect(hooks["experimental.chat.messages.transform"]).toBeDefined()
    expect(hooks["experimental.chat.system.transform"]).toBeDefined()
  })

  test("system transform hook appends guidance", async () => {
    const hooks = await contextBonsai({} as any)
    const output = { system: ["existing prompt"] }
    
    await hooks["experimental.chat.system.transform"]!({} as any, output)
    
    expect(output.system).toHaveLength(2)
    expect(output.system[0]).toBe("existing prompt")
    expect(output.system[1]).toContain("Context Bonsai Plugin")
  })

  test("wires injected updater from plugin initialization into tools", async () => {
    const atomicUpdater = mock(async () => {})
    const hooks = await contextBonsai({
      client: {
        session: {
          updateMessageAtomic: atomicUpdater
        }
      }
    } as any)

    const archived = makeArchivedMessage("msg1", "s1", PLUGIN_ID, {
      summary: "summary",
      indexTerms: ["term"],
      rangeEnd: "msg1"
    })

    const result = await hooks.tool!["context-bonsai-retrieve"]!.execute({ anchor_id: "msg1" }, {
      sessionID: "s1",
      messages: [{
        info: {
          id: archived.id,
          sessionID: archived.sessionID,
          role: archived.role,
          metadata: archived.metadata,
          time: { created: archived.createdAt.getTime() }
        },
        parts: archived.parts
      }]
    } as any)

    expect(result).toBe("Restored 1 messages from range msg1 to msg1. Original content is now visible.")
    expect(atomicUpdater).toHaveBeenCalledTimes(1)
  })

  test("emits compat diagnostics to stderr when enabled", async () => {
    const previous = process.env.CONTEXT_BONSAI_COMPAT_DIAGNOSTICS
    process.env.CONTEXT_BONSAI_COMPAT_DIAGNOSTICS = "1"
    const errorSpy = mock(() => {})
    const originalError = console.error
    console.error = errorSpy as any

    try {
      await contextBonsai({
        client: {
          session: {
            updateMessageAtomic: async () => {}
          }
        }
      } as any)
    } finally {
      console.error = originalError
      if (previous === undefined) delete process.env.CONTEXT_BONSAI_COMPAT_DIAGNOSTICS
      else process.env.CONTEXT_BONSAI_COMPAT_DIAGNOSTICS = previous
    }

    expect(errorSpy).toHaveBeenCalled()
  })
})

describe("message conversion", () => {
  test("converts plugin framework messages to WithParts format", () => {
    const pluginMessages = [{
      info: {
        id: "msg1",
        sessionID: "s1",
        role: "assistant" as const,
        metadata: {
          [PLUGIN_ID]: {
            archive: {
              summary: "Test archive summary",
              indexTerms: ["test", "archive"],
              rangeEnd: "msg2"
            }
          }
        }
      },
      parts: [{
        id: "p1",
        sessionID: "s1",
        messageID: "msg1",
        type: "text" as const,
        text: "original content"
      }]
    }]

    const converted = convertPluginMessages(pluginMessages as any)
    
    expect(converted).toHaveLength(1)
    expect(converted[0].id).toBe("msg1")
    expect(converted[0].sessionID).toBe("s1")
    expect(converted[0].role).toBe("assistant")
    expect(converted[0].parts).toEqual(pluginMessages[0].parts)
    expect(converted[0].metadata[PLUGIN_ID]).toEqual({
      archive: {
        summary: "Test archive summary",
        indexTerms: ["test", "archive"],
        rangeEnd: "msg2"
      }
    })
  })

  test("integration: conversion preserves metadata for archive detection", () => {
    const pluginMessages = [{
      info: {
        id: "msg1",
        sessionID: "s1",
        role: "assistant" as const,
        metadata: {
          [PLUGIN_ID]: {
            archive: {
              summary: "Integration test summary",
              indexTerms: ["integration", "test"],
              rangeEnd: "msg1"
            }
          }
        }
      },
      parts: [{
        id: "p1",
        sessionID: "s1",
        messageID: "msg1",
        type: "text" as const,
        text: "original content"
      }]
    }]

    const converted = convertPluginMessages(pluginMessages as any)
    transformMessages(converted, PLUGIN_ID, false, "s1")
    
    expect(converted).toHaveLength(1)
    expect(converted[0].parts).toHaveLength(1)
    expect(converted[0].parts[0].type).toBe("text")
    expect((converted[0].parts[0] as any).text).toContain("[PRUNED: msg1 to msg1]")
    expect((converted[0].parts[0] as any).text).toContain("Summary: Integration test summary")
    expect((converted[0].parts[0] as any).text).toContain("Index: integration, test")
  })
})
