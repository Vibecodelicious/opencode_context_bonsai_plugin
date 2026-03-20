import { describe, it, expect } from "bun:test"
import { ARCHIVE_KEY } from "./constants"
import { clearArchiveMetadata, getArchive, hasArchive, resolveArchiveFromMetadata } from "./schema"
import { makeArchivedMessage, makeUserMessage } from "./test/fixtures"

describe("schema", () => {
  const sessionID = "session1"

  it("getArchive returns archive data from canonical key", () => {
    const msg = makeArchivedMessage("msg1", sessionID, ARCHIVE_KEY, {
      summary: "Test summary",
      indexTerms: ["term1", "term2"],
      rangeEnd: "msg2"
    })

    const archive = getArchive(msg)
    expect(archive).toEqual({
      summary: "Test summary",
      indexTerms: ["term1", "term2"],
      rangeEnd: "msg2"
    })
  })

  it("getArchive returns null when archive not present", () => {
    const msg = makeUserMessage("msg1", sessionID, "Hello")
    expect(getArchive(msg)).toBeNull()
  })

  it("getArchive returns null for invalid metadata", () => {
    const msg = makeUserMessage("msg1", sessionID, "Hello", {
      metadata: { [ARCHIVE_KEY]: { invalid: "data" } }
    })
    expect(getArchive(msg)).toBeNull()
  })

  it("hasArchive returns true when archive present", () => {
    const msg = makeArchivedMessage("msg1", sessionID, ARCHIVE_KEY, {
      summary: "Test",
      indexTerms: [],
      rangeEnd: "msg2"
    })
    expect(hasArchive(msg)).toBe(true)
  })

  it("hasArchive returns false when archive not present", () => {
    const msg = makeUserMessage("msg1", sessionID, "Hello")
    expect(hasArchive(msg)).toBe(false)
  })

  it("resolveArchiveFromMetadata ignores legacy-only metadata", () => {
    const legacyKey = "legacy-context-bonsai"

    const legacyOnly = {
      [legacyKey]: {
        archive: {
          summary: "legacy",
          indexTerms: ["legacy"],
          rangeEnd: "msg2"
        }
      }
    }

    const legacyResolved = resolveArchiveFromMetadata(legacyOnly)
    expect(legacyResolved).toBeNull()
  })

  it("clearArchiveMetadata clears canonical key only", () => {
    const legacyKey = "legacy-context-bonsai"
    const draft = {
      metadata: {
        [ARCHIVE_KEY]: { archive: { summary: "canonical", indexTerms: [], rangeEnd: "msg1" } },
        [legacyKey]: { archive: { summary: "legacy", indexTerms: [], rangeEnd: "msg2" } },
        unrelated: { keep: true }
      }
    }

    clearArchiveMetadata(draft)

    expect(draft.metadata[ARCHIVE_KEY]).toBeUndefined()
    expect(draft.metadata[legacyKey]).toEqual({ archive: { summary: "legacy", indexTerms: [], rangeEnd: "msg2" } })
    expect(draft.metadata.unrelated).toEqual({ keep: true })
  })
})
