# Story: Prune Tool

**Epic:** Context Bonsai Plugin
**Size:** Large
**Dependencies:** Story 3 (Archive Schema and Transform Hook)

## Story Description

Implement the two-phase `context-bonsai:prune` tool. Phase 1 enables message ID
visibility so the LLM can see and reference message IDs. Phase 2 archives a
specified message range with an LLM-generated summary and index terms. This is
the first end-to-end demo: the LLM prunes content and placeholders appear in
the conversation on the next turn.

## User Model

### User Gamut

- LLMs that call the tool — must understand the two-phase flow and provide
  valid arguments
- Users who see the prune notification — must understand what was archived

### User-Needs Gamut

- Clear tool result messages that explain what happened (both phases)
- Reliable summarization that captures the meaning of pruned content
- Safe failure: if summarization fails, nothing is written (no partial state)
- Input validation: clear errors for invalid IDs, overlapping ranges, etc.

### Design Implications

- All parameters optional in Zod schema (phase 1 takes none, phase 2 takes all)
- Summarization failure = return error string to LLM, not throw
- Same-step prune tracking: record which anchors were pruned this step so the
  retrieve tool's same-step guard works (shared via state from Story 2)

## Acceptance Criteria

- [ ] Tool registered as `context-bonsai:prune` via the `tool` hook
- [ ] Phase 1 (no args): sets ID-visibility flag, returns instruction message
- [ ] Phase 2 (from_id, to_id, reason): validates inputs, generates summary,
      writes anchor metadata, clears ID-visibility flag, returns notification
- [ ] All parameters are optional in the tool's Zod schema
- [ ] Phase detection: if only one of `from_id`/`to_id` is provided, return
      actionable error: "Phase 2 requires both from_id and to_id. Call without
      arguments to see message IDs."
- [ ] Input validation checks:
  - Both IDs exist in `ctx.messages`
  - `from_id` precedes `to_id` chronologically
  - Neither ID falls within an already-pruned range
  - Range contains at least one message
  - No message in range has a `ToolPart` with `state.status === "pending"` or
    `"running"` (incomplete tool calls would produce malformed history when the
    transform hook removes followers)
- [ ] Summarization uses `ctx.languageModel` via `generateText()` from `ai` SDK
- [ ] Summarization prompt produces: concise summary + comma-separated index terms
- [ ] If summarization fails (any error), the tool returns an error message to
      the LLM — no metadata written, no exception thrown
- [ ] Anchor metadata written via single `ctx.updateMessage()` call:
      `metadata[ctx.pluginID] = { archive: { summary, indexTerms, rangeEnd } }`
      Note: the `updateMessage` callback's `draft` parameter is typed as SDK
      `Message`. If the SDK type has not been regenerated to include `metadata`,
      access `draft.metadata` via `(draft as any).metadata` — the field exists
      at runtime (it's on the Zod schema). This is a known temporary type gap
      until the SDK is regenerated.
- [ ] Same-step tracking: anchor ID added to per-session prune set (cleared
      each step by the transform hook)
- [ ] ID-visibility flag cleared after successful phase 2
- [ ] Tool result is a human-readable notification: what was pruned, summary
      preview, range size
- [ ] Unit tests for input validation logic
- [ ] Unit tests for summarization prompt construction
- [ ] Integration test: mock `ctx.languageModel` and `ctx.updateMessage`,
      verify full phase 2 flow

## Context References

### Relevant Codebase Files (must read)

- `packages/plugin/src/tool.ts` — `tool()` helper, `ToolContext` type,
  `tool.schema` (provides Zod)
- `packages/opencode/src/tool/registry.ts:fromPlugin()` — how plugin tools
  are registered, the `Truncate.output()` cap (2000 lines / 50KB)
- PROJECT_PROPOSAL.md Feature 1 (Prune Tool) — full specification

### New Files to Create

- `src/tools/prune.ts` — Prune tool definition
- `src/tools/prune.test.ts` — Prune tool tests
- `src/summarize.ts` — Summarization prompt and LLM call wrapper
- `src/summarize.test.ts` — Summarization tests

### Relevant Documentation

- PROJECT_PROPOSAL.md Feature 1 — two-phase flow, input validation, failure
  handling, atomicity
- PROJECT_PROPOSAL.md "Archive Storage" — metadata structure
- PROJECT_PROPOSAL.md "Lifecycle and Ordering Concerns" — within-step tool
  snapshot behavior

## Implementation Plan

### Phase 1: Summarization Module

- Create `src/summarize.ts`:
  - `summarizeRange(messages, languageModel)` — calls `generateText()` with a
    prompt that extracts a concise summary and index terms
  - Prompt should instruct the LLM to:
    - Summarize in 1-3 sentences focusing on what was done and what was learned
    - Produce 3-8 index terms for retrieval
    - NOT include system-reminder wrapper text in the summary
  - Return `{ summary: string, indexTerms: string[] }`
  - On any error: throw (caller catches and returns error string to LLM —
    never let exceptions propagate to the plugin framework)
- **Required**: Filter out parts where `synthetic === true` before passing to
  the summarization LLM. `insertReminders()` runs before clone, so
  `ctx.messages` contains plan-mode and build-switch reminder text baked into
  parts. Without filtering, summaries would include boilerplate like "The user
  sent the following message:" wrapped in `<system-reminder>` tags.
  Note: gauge text is NOT in `ctx.messages` (it's injected on the clone by the
  transform hook), so no gauge filtering is needed.

### Phase 2: Input Validation

- Create validation helpers in `src/tools/prune.ts`:
  - `findMessageIndex(messages, id)` — returns index or null
  - `isInPrunedRange(messages, id, pluginID)` — checks if ID falls within an
    existing archive range
  - `validatePruneInput(messages, fromId, toId, pluginID)` — returns error
    string or null

### Phase 3: Tool Definition

- Create `src/tools/prune.ts` using `tool()` helper:
  ```typescript
  tool({
    description: "Archive a range of conversation messages...",
    args: {
      from_id: tool.schema.string().optional().describe("..."),
      to_id: tool.schema.string().optional().describe("..."),
      reason: tool.schema.string().optional().describe("..."),
    },
    async execute(args, ctx) {
      // Phase detection: no args = phase 1, args present = phase 2
      if (!args.from_id && !args.to_id) {
        // Phase 1: enable ID visibility
        setIdVisibility(ctx.sessionID, true)
        return "Message IDs are now visible..."
      }
      // Phase 2: validate, summarize, write
    }
  })
  ```

### Phase 4: Phase 2 Implementation

- Validate inputs (both IDs required for phase 2, validation checks)
- Extract messages in range from `ctx.messages`
- Call `summarizeRange()` with `ctx.languageModel`
- On success: write anchor metadata via `ctx.updateMessage(fromId, ...)`
- Record anchor in same-step prune set
- Clear ID-visibility flag
- Return notification string
- On failure: return error string (no metadata written)

### Phase 5: Wire into Plugin

- Update `src/index.ts`: add prune tool to the `tool` hook's tool map
- Ensure tool name is `context-bonsai:prune` (namespaced to avoid collisions)

### Phase 6: Tests

- Unit tests for validation helpers (each validation check)
- Unit tests for summarization prompt construction
- Integration test with mocked `ctx`: full phase 1 → phase 2 flow
- Error case tests: invalid IDs, overlapping ranges, summarization failure

## Step-by-Step Tasks

1. Create `src/summarize.ts` with summarization prompt and LLM call wrapper
2. Write summarization tests with mocked languageModel (`src/summarize.test.ts`)
3. Implement input validation helpers in `src/tools/prune.ts`
4. Implement phase 1 (ID visibility toggle)
5. Implement phase 2 (validate → summarize → write metadata → notify)
6. Wire prune tool into plugin's tool hook in `src/index.ts`
7. Write comprehensive prune tool tests (`src/tools/prune.test.ts`)
8. Run `bun test` and `bun run build`

## Testing Strategy

- Mock `ctx.languageModel` to return controlled summarization output
- Mock `ctx.updateMessage` to capture write calls and verify metadata structure
- Mock `ctx.messages` with synthetic conversation arrays
- Test each validation path independently
- Test summarization failure path (mock throws)
- Test phase detection logic (no args → phase 1, args → phase 2)

## Validation Commands

- `bun test`
- `bun run build`

## Completion Checklist

- [ ] All acceptance criteria met
- [ ] Validation commands pass
- [ ] User-model ambiguities resolved or escalated
