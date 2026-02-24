import { describe, expect, test } from "bun:test"
import { contextBonsai } from "./index"

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
