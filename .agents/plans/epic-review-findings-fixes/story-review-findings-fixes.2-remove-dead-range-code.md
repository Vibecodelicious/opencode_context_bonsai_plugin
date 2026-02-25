# Story: Remove Dead Defensive Range Code

**Epic:** Review Findings Fixes
**Size:** Small
**Dependencies:** None

## Story Description

The `transformMessages()` function in `src/transform.ts` uses
`Math.min(index, rangeEndIndex)` and `Math.max(index, rangeEndIndex)` to
calculate the follower removal range. This implies the anchor could appear after
rangeEnd in the messages array — but the prune tool (`src/prune.ts`) explicitly
validates `fromIndex < toIndex` and rejects out-of-order ranges.

The Math.min/max is dead defensive code that:
- Obscures the ordering invariant (anchor always precedes rangeEnd)
- Could silently produce wrong results if a future code path violates the
  invariant (collecting the wrong messages instead of failing)

Replace with direct assignment and document the invariant.

## User Model

### User Gamut

- Contributors adding new archive creation paths who need to know the ordering
  contract
- Maintainers reading the transform logic who shouldn't have to wonder "can
  rangeEnd come before anchor?"

### User-Needs Gamut

- Explicit invariants: if the system depends on ordering, say so in the code
- Fail-fast over fail-silent: if the invariant is violated, direct assignment
  will produce visibly wrong behavior, which is better than silently collecting
  the wrong messages

### Design Implications

- This is a 2-line code change + 1 comment. No new logic, no new tests needed
  (existing tests already cover the normal path where anchor < rangeEnd).

## Acceptance Criteria

- [ ] Line 49 of `src/transform.ts`: `const start = Math.min(index, rangeEndIndex)`
  replaced with `const start = index`
- [ ] Line 50 of `src/transform.ts`: `const end = Math.max(index, rangeEndIndex)`
  replaced with `const end = rangeEndIndex`
- [ ] Comment added on the line before the assignments:
  `// Prune tool guarantees anchor precedes rangeEnd (fromIndex < toIndex validation in prune.ts)`
- [ ] All existing tests pass (`bun test`)
- [ ] Build succeeds (`bun run build`)

## Context References

### Relevant Codebase Files (must read)

- `src/transform.ts:47-53` — The Math.min/max lines and surrounding context:
  ```typescript
  if (rangeEndIndex !== -1 && rangeEndIndex !== index) {
    const start = Math.min(index, rangeEndIndex)    // line 49
    const end = Math.max(index, rangeEndIndex)      // line 50
    
    // Collect indices between anchor and rangeEnd (exclusive of anchor, inclusive of rangeEnd)
    for (let i = start + 1; i <= end; i++) {
  ```
- `src/prune.ts` — The ordering validation. Find the line with
  `fromIndex >= toIndex` that returns an error message about chronological
  ordering.
- `src/transform.test.ts` — Existing tests that verify the normal-order path
  (anchor before rangeEnd). No test has rangeEnd before anchor.

### New Files to Create

- None

### Relevant Documentation

- `.agents/reviews/story-3-rejected-findings-report.md` — Finding H1 details

## Implementation Plan

### Phase 1: Code Change

- In `src/transform.ts`, replace lines 49-50:
  ```typescript
  // Before:
  const start = Math.min(index, rangeEndIndex)
  const end = Math.max(index, rangeEndIndex)
  
  // After:
  // Prune tool guarantees anchor precedes rangeEnd (fromIndex < toIndex validation in prune.ts)
  const start = index
  const end = rangeEndIndex
  ```

### Phase 2: Validate

- Run `bun test` — all tests pass
- Run `bun run build` — build succeeds

## Step-by-Step Tasks

1. Open `src/transform.ts`
2. Find lines 49-50 (`Math.min` / `Math.max`)
3. Add comment on line before: `// Prune tool guarantees anchor precedes rangeEnd (fromIndex < toIndex validation in prune.ts)`
4. Replace `Math.min(index, rangeEndIndex)` with `index`
5. Replace `Math.max(index, rangeEndIndex)` with `rangeEndIndex`
6. Run `bun test`
7. Run `bun run build`
8. Commit with message `[Story RF.2] Replace dead Math.min/max with direct assignment`

## Testing Strategy

- No new tests needed — existing tests already cover the anchor-before-rangeEnd
  path, which is the only valid path
- Regression: all existing tests must continue to pass

## Validation Commands

- `bun test`
- `bun run build`

## Completion Checklist

- [ ] All acceptance criteria met
- [ ] Validation commands pass
- [ ] Comment accurately describes the invariant and where it's enforced
