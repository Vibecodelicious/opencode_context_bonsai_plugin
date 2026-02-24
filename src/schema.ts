import { z } from "zod"
import type { WithParts } from "./test/fixtures"

export const ArchiveSchema = z.object({
  archive: z.object({
    summary: z.string(),
    indexTerms: z.array(z.string()),
    rangeEnd: z.string()
  }).optional()
})

export function getArchive(msg: WithParts, pluginID: string) {
  try {
    const parsed = ArchiveSchema.parse(msg.metadata[pluginID])
    return parsed.archive || null
  } catch {
    return null
  }
}

export function hasArchive(msg: WithParts, pluginID: string): boolean {
  return getArchive(msg, pluginID) !== null
}