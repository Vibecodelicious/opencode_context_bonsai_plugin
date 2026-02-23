# Story: Archive Schema and Transform Hook

**Epic:** Context Bonsai Plugin
**Size:** Medium
**Dependencies:** Story 2 (Plugin Skeleton and System Prompt)

## Story Description

Define the archive metadata Zod schema and implement the message transform hook
that renders pruned messages as compact placeholders and removes follower
messages. This is the core rendering mechanism — without it, pruning has no
visible effect.

This story also handles message ID prefixing (for prune phase 1) and creates
the shared test fixture module used by all subsequent stories.

## User Model

### User Gamut

- LLMs that see the transformed message array — they must understand
  placeholders and not be confused by missing messages
- Users viewing conversation in TUI — pruned messages show as tool results with
  summary text, not as blank gaps

### User-Needs Gamut

- Placeholders must clearly communicate: what was pruned, the summary, index
  terms, and the anchor/range-end IDs (for retrieve)
- Follower removal must not corrupt the message array
- Multiple pruned ranges must coexist without interfering
- Message ID prefixing must be clearly visible to the LLM when active

### Design Implications

- **OpenCode message model**: Tool calls and their results are stored in the
  SAME `ToolPart` on the SAME assistant message (as a `state` discriminated
  union: pending/running/completed/error). There are NO separate "tool result
  messages." This means follower removal operates at the whole-message level
  with no cross-message pairing concerns. The real guard against pruning
  incomplete tool calls belongs in Story 4's input validation (reject ranges
  containing messages with pending/running `ToolPart` state).
- **Single-pass array filtering**: The transform must collect all indices to
  remove first, then filter once — not splice during iteration (which shifts
  indices and corrupts subsequent range boundaries).
- **Mutation semantics**: `transformMessages()` mutates the passed array
  in-place and returns `void`. The transform hook receives `output.messages`
  which is a deep clone — the plugin modifies it via splice/assignment.
  Do NOT reassign the array reference (the caller holds the original reference).
  Do NOT rebuild and return a new array.
- **`pluginID` source**: Transform hooks do not receive `pluginID` from the
  framework. Use the `PLUGIN_ID` constant from `src/constants.ts` (defined in
  Story 2). The function signature takes `pluginID: string` as a parameter so
  it remains testable with arbitrary values.
- **`rangeEnd` field**: Always present in the archive metadata schema (never
  omitted). "Missing rangeEnd" refers to the case where the message with that
  ID is absent from the current `messages` array at transform time (e.g.,
  deleted via session revert or filtered by `filterCompacted()`), not that the
  field is absent from the schema.

## Acceptance Criteria

- [ ] `ArchiveSchema` Zod schema defined and exported:
      `{ archive?: { summary: string, indexTerms: string[], rangeEnd: string } }`
- [ ] Transform hook: messages with `metadata[pluginID].archive` are replaced
      with a single text-part placeholder containing summary, index terms, and
      anchor/range-end IDs
- [ ] Transform hook: follower messages (between anchor and rangeEnd) are
      removed from the array
- [ ] Transform hook: if rangeEnd message is missing from the array,
      treat as single-message archive (anchor only, no followers removed)
- [ ] Transform hook: multiple pruned ranges in one conversation are handled
      correctly in a single pass
- [ ] Transform hook: when ID-visibility flag is set, all non-synthetic text
      parts are prefixed with their message ID (e.g., `[msg:abc123] original
      text`). Messages with no non-synthetic text parts get a synthetic TextPart
      prepended with just the ID.
- [ ] Placeholder parts conform to TextPart schema (valid `id`, `sessionID`,
      `messageID`, `type: "text"`, `text`, `synthetic: true`)
- [ ] Same-step prune tracking set is cleared at the top of the transform hook
      invocation (before any message processing), establishing the per-turn
      epoch boundary
- [ ] `idVisibility` is looked up per-session from state using `sessionID`
      from the hook input (not a global flag)
- [ ] Shared test fixture module (`src/test/fixtures.ts`) created for building
      synthetic WithParts arrays — reused by Stories 4, 5, 6
- [ ] Unit tests cover: single archive, multiple archives, missing rangeEnd,
      single-message range (from_id === to_id), ID prefixing on/off, no
      archives (passthrough), empty messages array

## Context References

### Relevant Codebase Files (must read)

- `packages/opencode/src/session/message-v2.ts` — WithParts type, Part types
  (TextPart, ToolPart and its `state` discriminated union), part schema details
- `packages/opencode/src/session/prompt.ts:620` — where transform hook fires,
  receives `{ sessionID, model }` as input (Change 6 is merged)
- `packages/opencode/src/session/prompt.ts:1234` — insertReminders pattern
  (how synthetic parts are constructed with `synthetic: true`)
- `packages/opencode/src/util/identifier.ts` — `Identifier.ascending()` for
  generating valid part IDs

### New Files to Create

- `src/schema.ts` — Archive metadata Zod schema
- `src/transform.ts` — Transform hook implementation
- `src/transform.test.ts` — Comprehensive transform tests
- `src/schema.test.ts` — Schema validation tests
- `src/test/fixtures.ts` — Shared test fixture builders for all stories

### Relevant Documentation

- PROJECT_PROPOSAL.md Feature 3 (Archived Message Rendering + Message ID
  Prefixing) — full specification
- PROJECT_PROPOSAL.md "Archive Storage: Namespaced Message Metadata" — how
  metadata is structured on messages

## Implementation Plan

### Phase 1: Test Fixtures

- Create `src/test/fixtures.ts` with helpers to build realistic WithParts
  arrays:
  - `makeUserMessage(id, sessionID, text, opts?)` — user message with text part
  - `makeAssistantMessage(id, sessionID, text, opts?)` — assistant message with
    text part, optionally with tool parts
  - `makeToolPart(callID, tool, state)` — ToolPart in various states
  - `makeArchivedMessage(id, sessionID, pluginID, archive)` — message with
    archive metadata pre-set
  - All helpers produce valid `WithParts` shapes that match OpenCode's schema

### Phase 2: Archive Schema

- Create `src/schema.ts`:
  ```typescript
  const ArchiveSchema = z.object({
    archive: z.object({
      summary: z.string(),
      indexTerms: z.array(z.string()),
      rangeEnd: z.string(),
    }).optional(),
  })
  ```
- Export helper functions:
  - `getArchive(msg, pluginID)` — parse and return archive data or null
  - `hasArchive(msg, pluginID)` — boolean check

### Phase 3: Transform Core — Anchor Replacement

- Create `src/transform.ts` with:
  `transformMessages(messages: WithParts[], pluginID: string, idVisibility: boolean, sessionID: string): void`
- At the top: clear the same-step prune tracking set for this session
  (establishes per-turn epoch boundary)
- Step 1: Scan for anchor messages (those with archive metadata via
  `hasArchive()`)
- Step 2: For each anchor, build the placeholder text:
  ```
  [PRUNED: {anchorID} to {rangeEndID}]
  Summary: {summary}
  Index: {comma-separated indexTerms}
  ```
- Step 3: Replace anchor's parts array with a single conformant TextPart
  (`type: "text"`, valid `id`/`sessionID`/`messageID`, `synthetic: true`)

### Phase 4: Transform Core — Follower Removal

- For each anchor, find the rangeEnd message by ID in the array
- If rangeEnd is missing from the array: skip follower removal (single-message
  archive fallback — only the anchor is replaced with a placeholder)
- If rangeEnd exists: collect indices of all messages between anchor and
  rangeEnd (exclusive of anchor, inclusive of rangeEnd)
- Handle same-message range (`rangeEnd === anchor`): no followers to remove,
  just the anchor placeholder
- Collect ALL removal indices across ALL pruned ranges first
- Filter the array once using reverse-index splice — never splice during
  forward iteration

### Phase 5: Message ID Prefixing

- If `idVisibility` is true:
  - For each message, find the first non-synthetic text part
  - Prepend `[msg:{id}] ` to that part's text
  - If no non-synthetic text part exists (e.g., tool-only assistant message),
    insert a new synthetic TextPart at the start of the parts array with just
    `[msg:{id}]`
- If `idVisibility` is false: skip (no-op)

### Phase 6: Wire into Plugin

- Update `src/index.ts`: the `experimental.chat.messages.transform` hook
  handler:
  1. Looks up `sessionID` from `input.sessionID`
  2. Clears the same-step prune set for this session
  3. Looks up `idVisibility` from per-session state
  4. Calls `transformMessages(output.messages, PLUGIN_ID, idVisibility, sessionID)`
  5. (Story 6 will add gauge injection after this call)

### Phase 7: Tests

- Test cases:
  1. Single archive: anchor replaced, followers removed
  2. Multiple archives: both rendered correctly in single pass
  3. Missing rangeEnd: anchor-only replacement, no followers removed
  4. Single-message range (from_id === to_id): anchor replaced, zero followers
  5. ID prefixing enabled: non-synthetic text parts get prefix
  6. ID prefixing enabled, tool-only message: synthetic part inserted with ID
  7. ID prefixing disabled: messages unchanged
  8. No archives: messages pass through unmodified
  9. Empty messages array: no crash
  10. Archive at first/last position in array: boundary handling
  11. Placeholder part has correct TextPart shape with `synthetic: true`

## Step-by-Step Tasks

1. Create `src/test/fixtures.ts` with shared test fixture builders
2. Create `src/schema.ts` with ArchiveSchema and helper functions
3. Write schema tests (`src/schema.test.ts`)
4. Implement `transformMessages()` with same-step clearing in `src/transform.ts`
5. Implement anchor replacement (placeholder rendering)
6. Implement follower removal (single-pass collection then splice)
7. Implement message ID prefixing
8. Wire transform into the plugin's messages.transform hook in `src/index.ts`
9. Write comprehensive transform tests (`src/transform.test.ts`)
10. Run `bun test` and `bun run build`

## Testing Strategy

- Unit tests with synthetic message fixtures from `src/test/fixtures.ts`
- `transformMessages()` mutates in-place and returns `void` — all behavior
  observable via array inspection after the call
- Edge case coverage: empty arrays, single-message sessions, archives at
  array boundaries (first message, last message), same-message ranges

## Validation Commands

- `bun test`
- `bun run build`

## Completion Checklist

- [ ] All acceptance criteria met
- [ ] Validation commands pass
- [ ] User-model ambiguities resolved or escalated
