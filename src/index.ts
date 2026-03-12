import type { Plugin } from "@opencode-ai/plugin"
import { getSystemPromptGuidance } from "./prompt"
import { PLUGIN_ID } from "./constants"
import { transformMessages } from "./transform"
import { getIdVisibility, clearSameStepPrunes } from "./state"
import { handleTokenEvent, handleChatParams, injectGauge } from "./gauge"
import { createRetrieveTool } from "./retrieve"
import { createPruneToolDefinition } from "./prune"
import { convertPluginMessages } from "./convert"
import { buildRuntimeCompat } from "./runtime-compat"
import { captureDiscoveryRoot } from './discovery-dump'

function isCompatDiagnosticsEnabled(): boolean {
  const raw = process.env.CONTEXT_BONSAI_COMPAT_DIAGNOSTICS
  if (!raw) return false
  const normalized = raw.trim().toLowerCase()
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on'
}

export const contextBonsai: Plugin = async (input) => {
  await captureDiscoveryRoot('pluginInitInput', input)
  await captureDiscoveryRoot('pluginInitClient', (input as any).client)

  const runtimeCompat = await buildRuntimeCompat({
    client: (input as any).client,
    onCompatDiagnostic: isCompatDiagnosticsEnabled()
      ? event => {
          console.error(`[context-bonsai][compat] ${JSON.stringify(event)}`)
        }
      : undefined
  })

  return {
    tool: {
      "context-bonsai-retrieve": createRetrieveTool(runtimeCompat),
      "context-bonsai-prune": createPruneToolDefinition(runtimeCompat)
    },
  event: async (input) => {
    handleTokenEvent(input.event)
  },
  "chat.params": async (input, _output) => {
    handleChatParams(input.sessionID, input.model)
  },
  "experimental.chat.messages.transform": async (input, output) => {
    const sessionID = (input as any).sessionID || output.messages[0]?.info.sessionID || 'default'
    const idVisibility = getIdVisibility(sessionID)
    
    // Clear same-step prune set at start of transform
    clearSameStepPrunes(sessionID)
    
    // Collect all anchor messages and their ranges
    const anchors: Array<{ index: number; archive: any }> = []
    const removalIndices: number[] = []

    // Find all anchors
    for (let i = 0; i < output.messages.length; i++) {
      const msg = output.messages[i]
      const metadata = (msg.info as any).metadata || {}
      const archive = metadata[PLUGIN_ID]?.archive
      if (archive) {
        anchors.push({ index: i, archive })
      }
    }

    // Process each anchor - replace parts with placeholder
    for (const { index, archive } of anchors) {
      const msg = output.messages[index]
      const placeholderText = `[PRUNED: ${msg.info.id} to ${archive.rangeEnd}]\nSummary: ${archive.summary}\nIndex: ${archive.indexTerms.join(', ')}`
      
      msg.parts = [{
        id: `${msg.info.id}-placeholder`,
        sessionID: msg.info.sessionID,
        messageID: msg.info.id,
        type: 'text',
        text: placeholderText,
        synthetic: true
      } as any]

      // Find rangeEnd message
      const rangeEndIndex = output.messages.findIndex(m => m.info.id === archive.rangeEnd)
      
      // If rangeEnd exists and is different from anchor, collect follower indices
      if (rangeEndIndex !== -1 && rangeEndIndex !== index) {
        for (let i = index + 1; i <= rangeEndIndex; i++) {
          removalIndices.push(i)
        }
      }
    }

    // Remove followers in reverse order
    const uniqueIndices = [...new Set(removalIndices)].sort((a, b) => b - a)
    for (const index of uniqueIndices) {
      output.messages.splice(index, 1)
    }

    // Apply ID prefixing if enabled
    if (idVisibility) {
      for (const msg of output.messages) {
        let foundNonSynthetic = false
        
        for (const part of msg.parts) {
          if (part.type === 'text' && !(part as any).synthetic) {
            (part as any).text = `[msg:${msg.info.id}] ${(part as any).text}`
            foundNonSynthetic = true
            break
          }
        }
        
        // If no non-synthetic text part found, insert synthetic ID part
        if (!foundNonSynthetic) {
          const idPart = {
            id: `${msg.info.id}-id`,
            sessionID: msg.info.sessionID,
            messageID: msg.info.id,
            type: 'text',
            text: `[msg:${msg.info.id}]`,
            synthetic: true
          } as any
          msg.parts.unshift(idPart)
        }
      }
    }
    
    // Inject gauge after transform
    const messages = convertPluginMessages(output.messages)
    injectGauge(messages, sessionID, PLUGIN_ID)
  },
  "experimental.chat.system.transform": async (_input, output) => {
    output.system.push(getSystemPromptGuidance())
  }
  }
}

export default contextBonsai
