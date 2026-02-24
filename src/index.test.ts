import { describe, expect, test } from "bun:test"
import { contextBonsai } from "./index"

describe("contextBonsai", () => {
  test("exports a plugin factory function", () => {
    expect(typeof contextBonsai).toBe("function")
  })

  test("returns hooks object when called", async () => {
    const hooks = await contextBonsai({} as any)
    expect(hooks).toBeDefined()
    expect(typeof hooks).toBe("object")
  })
})
