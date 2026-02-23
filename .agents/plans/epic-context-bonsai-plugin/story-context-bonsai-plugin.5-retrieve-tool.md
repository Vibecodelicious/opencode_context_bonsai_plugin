# Story: Retrieve Tool

**Epic:** Context Bonsai Plugin
**Size:** Small
**Dependencies:** Story 3 (Archive Schema and Transform Hook)

## Story Description

Implement the `context-bonsai:retrieve` tool that restores previously pruned
content by clearing archive metadata from the anchor message. The tool returns a
short status message; actual content restoration happens through the transform
hook on the next turn (which no longer sees archive metadata and passes messages
through unmodified).

## User Model

### User Gamut

- LLMs that need to recall earlier pruned content for the current task
- Users who see the retrieve notification

### User-Needs Gamut

- Quick, reliable restoration of pruned content
- Clear feedback on what was restored
- Safe handling of edge cases (invalid ID, no archive, same-step conflict)

### Design Implications

- The retrieve tool does NOT return the archived content as output (that would
  hit the 2000-line / 50KB truncation cap). It clears metadata and lets the
  transform hook handle restoration on the next turn.
- Same-step guard: if the anchor was pruned in the current step, the retrieve
  sees stale `ctx.messages` without the prune's metadata. The tool must detect
  this and return a clear error.

## Acceptance Criteria

- [ ] Tool registered as `context-bonsai:retrieve` via the `tool` hook
- [ ] Takes `anchor_id` as required string parameter
- [ ] Validates `anchor_id` exists in `ctx.messages`
- [ ] Validates anchor has archive metadata in `metadata[ctx.pluginID]`
- [ ] Same-step guard: if `anchor_id` is in the current step's prune set,
      returns error: "This archive was created in the current step. Call
      context-bonsai:retrieve on the next turn."
- [ ] Clears archive metadata via single `ctx.updateMessage()` call
- [ ] Returns short status message (e.g., "Restored N messages from range
      msg_abc to msg_xyz. Original content is now visible.")
- [ ] Unit tests for validation and same-step guard
- [ ] Integration test with mocked ctx: full retrieve flow

## Context References

### Relevant Codebase Files (must read)

- `packages/plugin/src/tool.ts` — `tool()` helper, `ToolContext` type
- PROJECT_PROPOSAL.md Feature 2 (Retrieve Tool) — full specification

### New Files to Create

- `src/tools/retrieve.ts` — Retrieve tool definition
- `src/tools/retrieve.test.ts` — Retrieve tool tests

### Relevant Documentation

- PROJECT_PROPOSAL.md Feature 2 — validation, same-step guard, timing,
  truncation avoidance
- PROJECT_PROPOSAL.md "Lifecycle and Ordering Concerns" — within-step
  snapshot behavior

## Implementation Plan

### Phase 1: Tool Definition

- Create `src/tools/retrieve.ts` using `tool()` helper:
  ```typescript
  tool({
    description: "Restore previously pruned conversation content...",
    args: {
      anchor_id: tool.schema.string().describe("The ID of the anchor message to restore"),
    },
    async execute(args, ctx) {
      // 1. Validate anchor_id exists in ctx.messages
      // 2. Check archive metadata exists
      // 3. Same-step guard check
      // 4. Clear metadata via ctx.updateMessage
      // 5. Return status message
    }
  })
  ```

### Phase 2: Validation Logic

- Find anchor in `ctx.messages` by ID
- Parse `metadata[ctx.pluginID]` through ArchiveSchema
- If no archive data: return error "No archive found for message {anchor_id}"
- Check same-step prune set from state module

### Phase 3: Metadata Clearing

- Call `ctx.updateMessage(anchorId, (draft) => { delete draft.metadata[ctx.pluginID] })`
- Count messages in restored range (anchor to rangeEnd) for the status message

### Phase 4: Wire into Plugin

- Update `src/index.ts`: add retrieve tool to the `tool` hook's tool map

### Phase 5: Tests

- Unit test: anchor not found → error message
- Unit test: anchor has no archive metadata → error message
- Unit test: same-step guard triggers → specific error message
- Integration test: mock ctx with archived anchor, verify metadata cleared
- Integration test: verify short status message format

## Step-by-Step Tasks

1. Create `src/tools/retrieve.ts` with tool definition
2. Implement validation (anchor exists, has archive, same-step guard)
3. Implement metadata clearing via `ctx.updateMessage`
4. Wire retrieve tool into plugin's tool hook in `src/index.ts`
5. Write tests (`src/tools/retrieve.test.ts`)
6. Run `bun test` and `bun run build`

## Testing Strategy

- Mock `ctx.messages` with synthetic data including archived anchors
- Mock `ctx.updateMessage` to capture and verify the mutation
- Mock same-step prune set (from state module) for guard testing
- Test each error path independently

## Validation Commands

- `bun test`
- `bun run build`

## Completion Checklist

- [ ] All acceptance criteria met
- [ ] Validation commands pass
- [ ] User-model ambiguities resolved or escalated
