import type { TextPart } from "@opencode-ai/sdk"
import type { WithParts } from "./test/fixtures"
import { getArchive } from "./schema"
import { clearSameStepPrunes } from "./state"

export function transformMessages(
  messages: WithParts[],
  idVisibility: boolean,
  sessionID: string
): void {
  // Clear same-step prune set at start of transform
  clearSameStepPrunes(sessionID)

  // Collect all anchor messages and their ranges
  const anchors: Array<{ index: number; msg: WithParts; archive: NonNullable<ReturnType<typeof getArchive>> }> = []
  const removalIndices: number[] = []

  // Find all anchors
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]
    const archive = getArchive(msg)
    if (archive) {
      anchors.push({ index: i, msg, archive })
    }
  }

  // Process each anchor
  for (const { index, msg, archive } of anchors) {
    // Replace anchor with placeholder
    const placeholderText = `[PRUNED: ${msg.id} to ${archive.rangeEnd}]\nSummary: ${archive.summary}\nIndex: ${archive.indexTerms.join(', ')}`
    
    const placeholderPart: TextPart = {
      id: `${msg.id}-placeholder`,
      sessionID: msg.sessionID,
      messageID: msg.id,
      type: 'text',
      text: placeholderText,
      synthetic: true
    }

    msg.parts = [placeholderPart]

    // Find rangeEnd message
    const rangeEndIndex = messages.findIndex(m => m.id === archive.rangeEnd)
    
    // If rangeEnd exists and is different from anchor, collect follower indices
    if (rangeEndIndex !== -1 && rangeEndIndex !== index) {
      // Prune tool guarantees anchor precedes rangeEnd (fromIndex < toIndex validation in prune.ts)
      const start = index
      const end = rangeEndIndex
      
      // Collect indices between anchor and rangeEnd (exclusive of anchor, inclusive of rangeEnd)
      for (let i = start + 1; i <= end; i++) {
        removalIndices.push(i)
      }
    }
  }

  // Remove followers in reverse order to avoid index shifting during splice
  const uniqueIndices = [...new Set(removalIndices)].sort((a, b) => b - a)
  for (const index of uniqueIndices) {
    messages.splice(index, 1)
  }

  // Apply ID prefixing if enabled
  if (idVisibility) {
    for (const msg of messages) {
      let foundNonSynthetic = false
      
      for (const part of msg.parts) {
        if (part.type === 'text' && !part.synthetic) {
          part.text = `[msg:${msg.id}] ${part.text}`
          foundNonSynthetic = true
          break
        }
      }
      
      // If no non-synthetic text part found, insert synthetic ID part
      if (!foundNonSynthetic) {
        const idPart: TextPart = {
          id: `${msg.id}-id`,
          sessionID: msg.sessionID,
          messageID: msg.id,
          type: 'text',
          text: `[msg:${msg.id}]`,
          synthetic: true
        }
        msg.parts.unshift(idPart)
      }
    }
  }
}
