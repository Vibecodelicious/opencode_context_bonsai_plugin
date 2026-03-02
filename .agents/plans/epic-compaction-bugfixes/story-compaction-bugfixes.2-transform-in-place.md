# Story: Fix Transform Hook In-Place Mutation

**Epic:** Compaction Bugfixes
**Size:** Small
**Dependencies:** None

## Story Description

The transform hook in `src/index.ts` reassigns `output.messages` to a new
array. OpenCode's `prompt.ts` passes `{ messages: sessionMessages }` as the
output object, then uses the `sessionMessages` local variable to build the
LLM request. Reassigning `output.messages` creates a new array reference that
`sessionMessages` doesn't see — so the LLM receives untransformed messages.

Fix: mutate `output.messages` in-place. Clear the array and push the
transformed elements back into it.

## User Model

### User Gamut

- All users of the plugin — every transform operation (archive placeholders,
  follower removal, ID prefixing, gauge injection) is broken without this fix

### User-Needs Gamut

- Compacted content must actually disappear from LLM context
- Placeholder summaries must appear in place of original content
- ID prefixing must be visible to the LLM during Phase 1

### Design Implications

- The fix must preserve the existing mapping logic (spreading original `info`
  fields, overriding `metadata` and `parts`)
- Must handle the case where `transformMessages` splices out followers —
  the output array must shrink accordingly
- The `output.messages.find()` lookup for original info must happen before
  clearing the array

## Acceptance Criteria

- [ ] Transform hook mutates `output.messages` in-place (no reassignment)
- [ ] After transform, `output.messages.length` matches the transformed count
      (followers removed)
- [ ] Anchor messages have placeholder parts (not original content)
- [ ] Original `info` fields (except `metadata`) preserved on remaining messages
- [ ] `bun test` passes
- [ ] `bun run build` passes

## Context References

### Relevant Codebase Files (must read)

- `src/index.ts:35-41` — the transform hook output mapping (the bug)
- `src/transform.ts` — `transformMessages()` mutates the array via splice
- `src/convert.ts` — `convertPluginMessages()` creates WithParts from output
- OpenCode `packages/opencode/src/session/prompt.ts:629,650,666` — shows
  `sessionMessages` is a local variable, `output.messages` reassignment
  doesn't propagate
- OpenCode `packages/opencode/src/plugin/index.ts:106-121` — `trigger()`
  passes output object by reference

## Implementation Plan

### Phase 1: Fix the Output Mapping

In `src/index.ts`, replace the reassignment:
```typescript
output.messages = messages.map(msg => ({
  info: {
    ...output.messages.find(m => m.info.id === msg.id)?.info!,
    metadata: msg.metadata
  },
  parts: msg.parts
}))
```

With in-place mutation:
```typescript
// Build lookup from original messages before clearing
const origById = new Map(output.messages.map(m => [m.info.id, m.info]))

// Mutate in-place: clear and refill so the original array reference updates
output.messages.length = 0
for (const msg of messages) {
  output.messages.push({
    info: { ...origById.get(msg.id)!, metadata: msg.metadata },
    parts: msg.parts
  })
}
```

Key points:
- Build a Map of original info objects before clearing (O(1) lookup vs O(n)
  find per message)
- `output.messages.length = 0` clears the array in-place (same reference)
- Push transformed messages back into the same array

### Phase 2: Verify

Run `bun test` and `bun run build`.

## Step-by-Step Tasks

1. Build `origById` Map from `output.messages`
2. Clear `output.messages` in-place with `.length = 0`
3. Push transformed messages back
4. Run `bun test` and `bun run build`

## Testing Strategy

- All existing transform tests pass (they test `transformMessages` directly,
  not the hook)
- All existing tests pass (no behavioral change in test-observable surface)
- The real validation is E2E: after this fix, compacted messages should not
  be visible to the LLM

## Validation Commands

- `bun test`
- `bun run build`

## Completion Checklist

- [ ] All acceptance criteria met
- [ ] Validation commands pass
- [ ] `output.messages` is never reassigned (only mutated in-place)
