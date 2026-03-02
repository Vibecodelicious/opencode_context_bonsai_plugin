# Story: Allow Single-Message Prune Ranges

**Epic:** Compaction Bugfixes
**Size:** Small
**Dependencies:** None

## Story Description

`validatePruneInput` in `src/prune.ts` rejects `from_id === to_id` because
line 43 uses `fromIndex >= toIndex`. This prevents compacting a single message.
Change `>=` to `>` so equal indices are allowed. Update the error message to
say "from_id must precede or equal to_id" and add a test for single-message
archiving.

## User Model

### User Gamut

- LLMs compacting a single sensitive message, a single large tool output, or
  a single completed discussion turn

### User-Needs Gamut

- Single-message compaction is a natural operation that should just work
- Error messages should guide the LLM when IDs are actually reversed

### Design Implications

- Minimal change: one operator and one test addition

## Acceptance Criteria

- [ ] `validatePruneInput` allows `fromIndex === toIndex` (single-message range)
- [ ] `validatePruneInput` still rejects `fromIndex > toIndex` (reversed order)
- [ ] Error message updated: `from_id must precede or equal to_id chronologically`
- [ ] New test: single-message archiving (`from_id === to_id`) succeeds and
      writes correct metadata with `rangeEnd === from_id`
- [ ] Existing chronological order test updated to match new error message
- [ ] `bun test` passes
- [ ] `bun run build` passes

## Context References

### Relevant Codebase Files (must read)

- `src/prune.ts:43` — the `>=` comparison to change
- `src/prune.test.ts` — existing "validates chronological order" test, and
  "successful archiving" test as template for the new single-message test

## Implementation Plan

### Phase 1: Fix Validation

In `src/prune.ts` line 43, change:
```typescript
if (fromIndex >= toIndex) {
```
to:
```typescript
if (fromIndex > toIndex) {
```

Update the error message on line 44 to:
```
from_id must precede or equal to_id chronologically
```

### Phase 2: Update Tests

In `src/prune.test.ts`:
- Update the "validates chronological order" test assertion to match new error
  message wording
- Add a new test: "successful single-message archiving" where `from_id === to_id`,
  verify it succeeds and metadata has `rangeEnd === from_id`

## Step-by-Step Tasks

1. Change `>=` to `>` in `validatePruneInput`
2. Update error message
3. Update chronological order test assertion
4. Add single-message archiving test
5. Run `bun test` and `bun run build`

## Testing Strategy

- Existing reversed-order test verifies rejection still works
- New test verifies single-message range succeeds
- All other prune tests remain unchanged

## Validation Commands

- `bun test`
- `bun run build`

## Completion Checklist

- [ ] All acceptance criteria met
- [ ] Validation commands pass
