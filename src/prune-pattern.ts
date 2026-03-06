import type { WithParts } from './test/fixtures'
import { messageMatchesPattern } from './prune-pattern-matcher'

const CORPUS_PART_DELIMITER = '\n<bonsai-part>\n'

function normalizeForStableJson(value: unknown): unknown {
  if (value === null) {
    return null
  }

  const valueType = typeof value

  if (valueType === 'bigint') {
    return String(value)
  }

  if (valueType === 'string' || valueType === 'number' || valueType === 'boolean') {
    return value
  }

  if (valueType === 'undefined' || valueType === 'function' || valueType === 'symbol') {
    return undefined
  }

  if (Array.isArray(value)) {
    return value.map(item => {
      const normalized = normalizeForStableJson(item)
      return normalized === undefined ? null : normalized
    })
  }

  if (typeof (value as any).toJSON === 'function') {
    return normalizeForStableJson((value as any).toJSON())
  }

  const sortedEntries = Object.keys(value as Record<string, unknown>)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    .map(key => {
      const normalized = normalizeForStableJson((value as Record<string, unknown>)[key])
      return [key, normalized] as const
    })
    .filter(([, normalized]) => normalized !== undefined)

  return Object.fromEntries(sortedEntries)
}

export function stableSerialize(value: unknown): string {
  const normalized = normalizeForStableJson(value)
  const serialized = JSON.stringify(normalized)
  return serialized === undefined ? 'null' : serialized
}

export function buildMessageSearchCorpus(message: WithParts): string {
  const segments: string[] = []

  for (const part of message.parts) {
    if (part.type === 'text') {
      if ((part as any).synthetic || (part as any).ignored === true) {
        continue
      }

      const text = (part as any).text
      if (typeof text === 'string' && text.length > 0) {
        segments.push(`text:${text}`)
      }
      continue
    }

    if (part.type !== 'tool') {
      continue
    }

    if (part.state?.status !== 'completed') {
      continue
    }

    segments.push(
      `tool:${part.tool}\ninput:${stableSerialize(part.state?.input)}\noutput:${stableSerialize(part.state?.output)}`
    )
  }

  return segments.join(CORPUS_PART_DELIMITER)
}

export function resolvePatternBoundary(messages: WithParts[], pattern: string): string {
  const matchingIds = messages
    .filter(message => messageMatchesPattern(buildMessageSearchCorpus(message), pattern))
    .map(message => message.id)

  if (matchingIds.length === 0) {
    throw new Error(`No messages match "${pattern}"`)
  }

  if (matchingIds.length > 1) {
    throw new Error(`${matchingIds.length} messages match "${pattern}"; use a more precise pattern`)
  }

  return matchingIds[0]
}
