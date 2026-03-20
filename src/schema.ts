import { z } from "zod"
import { ARCHIVE_KEY } from "./constants"
import type { WithParts } from "./test/fixtures"

export const ArchiveSchema = z.object({
  archive: z.object({
    summary: z.string(),
    indexTerms: z.array(z.string()),
    rangeEnd: z.string()
  }).optional()
})

export type ArchiveValue = NonNullable<z.infer<typeof ArchiveSchema>["archive"]>

export function resolveArchiveFromMetadata(
  metadata: Record<string, unknown> | undefined
): { archive: ArchiveValue; key: string } | null {
  try {
    const parsed = ArchiveSchema.parse(metadata?.[ARCHIVE_KEY])
    if (parsed.archive) {
      return { archive: parsed.archive, key: ARCHIVE_KEY }
    }
  } catch {
    // Ignore invalid archive metadata and treat as non-archive state.
  }

  return null
}

export function getArchive(msg: WithParts): ArchiveValue | null {
  return resolveArchiveFromMetadata(msg.metadata)?.archive ?? null
}

export function hasArchive(msg: WithParts): boolean {
  return getArchive(msg) !== null
}

export function getArchiveFromMetadata(metadata: Record<string, unknown> | undefined): ArchiveValue | null {
  return resolveArchiveFromMetadata(metadata)?.archive ?? null
}

export function setArchiveMetadata(draft: { metadata?: Record<string, unknown> }, archive: ArchiveValue): void {
  if (!draft.metadata) {
    draft.metadata = {}
  }

  draft.metadata[ARCHIVE_KEY] = { archive }
}

export function clearArchiveMetadata(
  draft: { metadata?: Record<string, unknown> }
): void {
  if (!draft.metadata) {
    return
  }

  delete draft.metadata[ARCHIVE_KEY]
}
