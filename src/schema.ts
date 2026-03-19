import { z } from "zod"
import { ARCHIVE_KEY, LEGACY_ARCHIVE_KEYS } from "./constants"
import type { WithParts } from "./test/fixtures"

export const ArchiveSchema = z.object({
  archive: z.object({
    summary: z.string(),
    indexTerms: z.array(z.string()),
    rangeEnd: z.string()
  }).optional()
})

export type ArchiveValue = NonNullable<z.infer<typeof ArchiveSchema>["archive"]>

export function getArchiveKeys(): string[] {
  return [ARCHIVE_KEY, ...LEGACY_ARCHIVE_KEYS]
}

export function resolveArchiveFromMetadata(
  metadata: Record<string, unknown> | undefined,
  archiveKeys: readonly string[] = getArchiveKeys()
): { archive: ArchiveValue; key: string } | null {
  for (const key of archiveKeys) {
    try {
      const parsed = ArchiveSchema.parse(metadata?.[key])
      if (parsed.archive) {
        return { archive: parsed.archive, key }
      }
    } catch {
      // Continue scanning configured keys.
    }
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
  draft: { metadata?: Record<string, unknown> },
  archiveKeys: readonly string[] = getArchiveKeys()
): void {
  if (!draft.metadata) {
    return
  }

  for (const key of archiveKeys) {
    delete draft.metadata[key]
  }
}
