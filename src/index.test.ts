import { describe, expect, test } from "bun:test"
import { contextBonsai, convertPluginMessages } from "./index"
import { transformMessages } from "./transform"
import { PLUGIN_ID } from "./constants"

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

    const converted = convertPluginMessages(pluginMessages)
    
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

    const converted = convertPluginMessages(pluginMessages)
    transformMessages(converted, PLUGIN_ID, false, "s1")
    
    expect(converted).toHaveLength(1)
    expect(converted[0].parts).toHaveLength(1)
    expect(converted[0].parts[0].type).toBe("text")
    expect(converted[0].parts[0].text).toContain("[PRUNED: msg1 to msg1]")
    expect(converted[0].parts[0].text).toContain("Summary: Integration test summary")
    expect(converted[0].parts[0].text).toContain("Index: integration, test")
  })
})
