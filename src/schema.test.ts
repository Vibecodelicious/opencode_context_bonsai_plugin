import { describe, it, expect } from "bun:test"
import { ARCHIVE_KEY, LEGACY_ARCHIVE_KEYS } from "./constants"
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

  it("resolveArchiveFromMetadata supports legacy-only and mixed precedence", () => {
    const legacyKey = "legacy-context-bonsai"
    const archiveKeys = [ARCHIVE_KEY, legacyKey]

    const legacyOnly = {
      [legacyKey]: {
        archive: {
          summary: "legacy",
          indexTerms: ["legacy"],
          rangeEnd: "msg2"
        }
      }
    }

    const mixed = {
      [ARCHIVE_KEY]: {
        archive: {
          summary: "canonical",
          indexTerms: ["canonical"],
          rangeEnd: "msg3"
        }
      },
      [legacyKey]: {
        archive: {
          summary: "legacy",
          indexTerms: ["legacy"],
          rangeEnd: "msg2"
        }
      }
    }

    const legacyResolved = resolveArchiveFromMetadata(legacyOnly, archiveKeys)
    expect(legacyResolved).toBeTruthy()
    expect(legacyResolved!.key).toBe(legacyKey)
    expect(legacyResolved!.archive.summary).toBe("legacy")

    const mixedResolved = resolveArchiveFromMetadata(mixed, archiveKeys)
    expect(mixedResolved).toBeTruthy()
    expect(mixedResolved!.key).toBe(ARCHIVE_KEY)
    expect(mixedResolved!.archive.summary).toBe("canonical")
  })

  it("clearArchiveMetadata clears canonical and provided legacy keys", () => {
    const legacyKey = "legacy-context-bonsai"
    const draft = {
      metadata: {
        [ARCHIVE_KEY]: { archive: { summary: "canonical", indexTerms: [], rangeEnd: "msg1" } },
        [legacyKey]: { archive: { summary: "legacy", indexTerms: [], rangeEnd: "msg2" } },
        unrelated: { keep: true }
      }
    }

    clearArchiveMetadata(draft, [ARCHIVE_KEY, legacyKey])

    expect(draft.metadata[ARCHIVE_KEY]).toBeUndefined()
    expect(draft.metadata[legacyKey]).toBeUndefined()
    expect(draft.metadata.unrelated).toEqual({ keep: true })
  })

  it("keeps explicit legacy key inventory empty until evidence exists", () => {
    expect(LEGACY_ARCHIVE_KEYS).toEqual([])
  })
})
