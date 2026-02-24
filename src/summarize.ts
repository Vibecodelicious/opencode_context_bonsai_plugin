import { generateText } from 'ai'
import type { LanguageModel } from 'ai'
import type { WithParts } from './test/fixtures'

export async function summarizeRange(
  messages: WithParts[],
  languageModel: LanguageModel
): Promise<{ summary: string; indexTerms: string[] }> {
  // Filter out synthetic parts before summarization
  const filteredMessages = messages.map(msg => ({
    ...msg,
    parts: msg.parts.filter(part => part.type === 'text' && !part.synthetic)
  })).filter(msg => msg.parts.length > 0)

  const conversationText = filteredMessages
    .map(msg => {
      const textParts = msg.parts
        .filter(part => part.type === 'text')
        .map(part => (part as any).text)
        .join(' ')
      return `${msg.role}: ${textParts}`
    })
    .join('\n')

  const prompt = `Analyze this conversation segment and provide:
1. A concise summary (1-3 sentences) focusing on what was done and what was learned
2. Index terms (3-8 keywords) for retrieval

Conversation:
${conversationText}

Respond in this exact format:
SUMMARY: [your summary here]
INDEX: [term1, term2, term3, ...]`

  const result = await generateText({
    model: languageModel,
    prompt
  })

  const lines = result.text.split('\n')
  const summaryLine = lines.find(line => line.startsWith('SUMMARY:'))
  const indexLine = lines.find(line => line.startsWith('INDEX:'))

  if (!summaryLine || !indexLine) {
    throw new Error('Invalid summarization response format')
  }

  const summary = summaryLine.replace('SUMMARY:', '').trim()
  const indexTerms = indexLine
    .replace('INDEX:', '')
    .trim()
    .split(',')
    .map(term => term.trim())
    .filter(term => term.length > 0)

  return { summary, indexTerms }
}