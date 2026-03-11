#!/usr/bin/env bun

import { Database } from "bun:sqlite"

const BONSAI_TOOLS = ["context-bonsai-prune", "context-bonsai-retrieve"] as const

type SessionRow = {
  id: string
  parent_id: string | null
  title: string
  directory: string
  time_created: number
  time_updated: number
}

type CountRow = {
  session_id: string
  bonsai_calls: number
}

type MessageRow = {
  id: string
  time_created: number
  data: string
}

type PartRow = {
  message_id: string
  time_created: number
  data: string
}

type ParsedArgs = {
  showAll: boolean
  dbPath: string
  sessionID: string | null
  contextSize: number
  includeSubagents: boolean
}

type ToolHit = {
  messageIndex: number
  partIndex: number
  tool: string
}

function parseArgs(argv: string[]): ParsedArgs {
  let showAll = false
  let dbPath = "/home/basil/.local/share/opencode/opencode.db"
  let sessionID: string | null = null
  let contextSize = 2
  let includeSubagents = false

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === "--all") {
      showAll = true
      continue
    }
    if (arg.startsWith("--db=")) {
      dbPath = arg.slice("--db=".length)
      continue
    }
    if (arg === "--db") {
      const value = argv[i + 1]
      if (value) {
        dbPath = value
        i += 1
      }
      continue
    }
    if (arg.startsWith("--session=")) {
      sessionID = arg.slice("--session=".length)
      continue
    }
    if (arg === "--session") {
      const value = argv[i + 1]
      if (value) {
        sessionID = value
        i += 1
      }
      continue
    }
    if (arg.startsWith("--context=")) {
      const parsed = Number.parseInt(arg.slice("--context=".length), 10)
      if (!Number.isNaN(parsed) && parsed >= 0) {
        contextSize = parsed
      }
      continue
    }
    if (arg === "--context") {
      const value = argv[i + 1]
      const parsed = value ? Number.parseInt(value, 10) : Number.NaN
      if (!Number.isNaN(parsed) && parsed >= 0) {
        contextSize = parsed
        i += 1
      }
      continue
    }
    if (arg === "--include-subagents") {
      includeSubagents = true
      continue
    }
  }

  return { showAll, dbPath, sessionID, contextSize, includeSubagents }
}

const parsed = parseArgs(process.argv.slice(2))
const showAll = parsed.showAll
const dbPath = parsed.dbPath
const sessionID = parsed.sessionID
const contextSize = parsed.contextSize
const includeSubagents = parsed.includeSubagents

const db = new Database(dbPath, { readonly: true })

function parseJSON<T>(value: string): T | null {
  try {
    return JSON.parse(value) as T
  } catch {
    return null
  }
}

function summarizePart(part: any): string {
  const type = part?.type
  if (type === "text") {
    const text = String(part?.text ?? "").replace(/\s+/g, " ").trim()
    return `text: ${text.slice(0, 120)}`
  }
  if (type === "tool") {
    const tool = String(part?.tool ?? "unknown")
    const status = String(part?.state?.status ?? "unknown")
    let extra = ""
    if (tool === "context-bonsai-prune") {
      const input = part?.state?.input ?? {}
      const reason = typeof input.reason === "string" ? input.reason.replace(/\s+/g, " ").trim() : ""
      const summary = typeof input.summary === "string" ? input.summary.replace(/\s+/g, " ").trim() : ""
      const reasonText = reason.length > 0 ? reason : "<none>"
      const summaryText = summary.length > 0 ? summary : "<none>"
      extra = ` reason=${reasonText} summary=${summaryText}`
    }
    return `tool: ${tool} (${status})${extra}`
  }
  if (type === "reasoning") {
    const text = String(part?.text ?? "").replace(/\s+/g, " ").trim()
    return `reasoning: ${text.slice(0, 120)}`
  }
  if (type === "step-start" || type === "step-finish") {
    return type
  }
  return String(type ?? "unknown")
}

function reportSessionContext(dbConn: Database, id: string, context: number): void {
  const session = dbConn
    .query<SessionRow, [string]>(
      `SELECT id, parent_id, title, directory, time_created, time_updated
       FROM session
       WHERE id = ?`
    )
    .get(id)

  if (!session) {
    console.log(`Session not found: ${id}`)
    return
  }

  const messages = dbConn
    .query<MessageRow, [string]>(
      `SELECT id, time_created, data
       FROM message
       WHERE session_id = ?
       ORDER BY time_created ASC`
    )
    .all(id)

  const parts = dbConn
    .query<PartRow, [string]>(
      `SELECT message_id, time_created, data
       FROM part
       WHERE session_id = ?
       ORDER BY time_created ASC`
    )
    .all(id)

  const partsByMessage = new Map<string, any[]>()
  for (const row of parts) {
    const part = parseJSON<any>(row.data)
    if (!part) continue
    const existing = partsByMessage.get(row.message_id) ?? []
    existing.push(part)
    partsByMessage.set(row.message_id, existing)
  }

  const messageView = messages.map((row, index) => {
    const parsedMessage = parseJSON<any>(row.data)
    const role = String(parsedMessage?.role ?? "unknown")
    const messageParts = partsByMessage.get(row.id) ?? []
    return { index, id: row.id, role, timeCreated: row.time_created, parts: messageParts }
  })

  const toolHits: ToolHit[] = []
  for (const message of messageView) {
    for (let i = 0; i < message.parts.length; i++) {
      const part = message.parts[i]
      if (part?.type !== "tool") continue
      const tool = String(part?.tool ?? "")
      if (!BONSAI_TOOLS.includes(tool as (typeof BONSAI_TOOLS)[number])) continue
      toolHits.push({ messageIndex: message.index, partIndex: i, tool })
    }
  }

  console.log(`session=${session.id} | title=${session.title} | messages=${messageView.length} | bonsai_calls=${toolHits.length} | context=${context}`)

  if (toolHits.length === 0) {
    console.log("No context-bonsai tool calls found in this session.")
    return
  }

  for (const [hitIndex, hit] of toolHits.entries()) {
    const start = Math.max(0, hit.messageIndex - context)
    const end = Math.min(messageView.length - 1, hit.messageIndex + context)
    console.log("")
    console.log(`hit ${hitIndex + 1}/${toolHits.length} | tool=${hit.tool} | message_index=${hit.messageIndex}`)

    for (let i = start; i <= end; i++) {
      const message = messageView[i]
      const marker = i === hit.messageIndex ? ">" : " "
      console.log(`${marker} [${i}] ${message.role} ${message.id}`)
      for (const part of message.parts.slice(0, 4)) {
        console.log(`    - ${summarizePart(part)}`)
      }
      if (message.parts.length > 4) {
        console.log(`    - ... ${message.parts.length - 4} more parts`)
      }
    }
  }
}

function collectDescendantSessionIDs(dbConn: Database, rootID: string): string[] {
  const rows = dbConn
    .query<{ id: string; parent_id: string | null }, []>(
      `SELECT id, parent_id FROM session`
    )
    .all()

  const childrenByParent = new Map<string, string[]>()
  for (const row of rows) {
    if (!row.parent_id) continue
    const existing = childrenByParent.get(row.parent_id) ?? []
    existing.push(row.id)
    childrenByParent.set(row.parent_id, existing)
  }

  const result: string[] = []
  const queue = [...(childrenByParent.get(rootID) ?? [])]
  while (queue.length > 0) {
    const id = queue.shift()
    if (!id) continue
    result.push(id)
    const children = childrenByParent.get(id) ?? []
    for (const child of children) {
      queue.push(child)
    }
  }

  return result
}

if (sessionID) {
  reportSessionContext(db, sessionID, contextSize)

  if (includeSubagents) {
    const descendants = collectDescendantSessionIDs(db, sessionID)
    if (descendants.length === 0) {
      console.log("")
      console.log("No subagent sessions found.")
      process.exit(0)
    }

    const descendantCounts = new Map<string, number>()
    for (const row of db
      .query<CountRow, [string, string]>(
        `SELECT session_id, COUNT(*) AS bonsai_calls
         FROM part
         WHERE json_extract(data, '$.type') = 'tool'
           AND json_extract(data, '$.tool') IN (?, ?)
         GROUP BY session_id`
      )
      .all(BONSAI_TOOLS[0], BONSAI_TOOLS[1])) {
      descendantCounts.set(row.session_id, row.bonsai_calls)
    }

    const targetDescendants = showAll
      ? descendants
      : descendants.filter(id => (descendantCounts.get(id) ?? 0) > 0)

    if (targetDescendants.length === 0) {
      console.log("")
      console.log("No subagent sessions with context-bonsai tool calls found.")
      process.exit(0)
    }

    console.log("")
    console.log(`subagent_sessions=${descendants.length} | shown=${targetDescendants.length}`)
    for (const id of targetDescendants) {
      console.log("")
      reportSessionContext(db, id, contextSize)
    }
  }

  process.exit(0)
}

const sessions = db
  .query<SessionRow, []>(
    `SELECT id, parent_id, title, directory, time_created, time_updated
     FROM session
     ORDER BY time_updated DESC`
  )
  .all()

const bonsaiCounts = db
  .query<CountRow, [string, string]>(
    `SELECT session_id, COUNT(*) AS bonsai_calls
     FROM part
     WHERE json_extract(data, '$.type') = 'tool'
       AND json_extract(data, '$.tool') IN (?, ?)
     GROUP BY session_id`
  )
  .all(BONSAI_TOOLS[0], BONSAI_TOOLS[1])

const countBySession = new Map<string, number>()
for (const row of bonsaiCounts) {
  countBySession.set(row.session_id, row.bonsai_calls)
}

const childrenByParent = new Map<string, SessionRow[]>()
for (const session of sessions) {
  if (!session.parent_id) continue
  const existing = childrenByParent.get(session.parent_id) ?? []
  existing.push(session)
  childrenByParent.set(session.parent_id, existing)
}

const roots = sessions.filter(session => session.parent_id === null)

function formatDate(ms: number): string {
  return new Date(ms).toISOString()
}

function sessionLine(prefix: string, session: SessionRow): string {
  const count = countBySession.get(session.id) ?? 0
  return `${prefix}${session.id} | bonsai_calls=${count} | updated=${formatDate(session.time_updated)} | title=${session.title}`
}

for (const root of roots) {
  const rootCount = countBySession.get(root.id) ?? 0
  const children = childrenByParent.get(root.id) ?? []
  const childWithCounts = children
    .map(child => ({ child, count: countBySession.get(child.id) ?? 0 }))
    .sort((a, b) => b.count - a.count || b.child.time_updated - a.child.time_updated)

  const totalChildCalls = childWithCounts.reduce((sum, row) => sum + row.count, 0)
  const hasAnyCalls = rootCount > 0 || totalChildCalls > 0
  if (!showAll && !hasAnyCalls) continue

  const header = [
    `${root.id}`,
    `title=${root.title}`,
    `bonsai_calls=${rootCount}`,
    `subagents=${children.length}`,
    `subagent_bonsai_calls=${totalChildCalls}`,
    `updated=${formatDate(root.time_updated)}`
  ].join(" | ")

  console.log(header)

  for (const entry of childWithCounts) {
    if (!showAll && entry.count === 0) continue
    console.log(sessionLine("  - ", entry.child))
  }

  console.log("")
}
