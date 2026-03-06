# Story: Add Pattern-Based Prune Selection

## Goal

Add an optional pattern-based boundary selection mode for `context-bonsai-prune` that resolves `from`/`to` to stored message IDs using replicated OpenCode edit-style string matching heuristics, while preserving the current two-phase ID workflow as the canonical path.

## User Model

### User Gamut
- CLI users pruning long, tool-heavy sessions where IDs are cumbersome.
- Safety-sensitive users trying to prune potentially sensitive content quickly and correctly.
- Determinism-focused users who prefer explicit `from_id`/`to_id` control.
- Users across model variability where tool args are inconsistently presented in UI.

### User-Needs Gamut
- Lower prune-selection friction without sacrificing correctness.
- Preserve auditable, deterministic archive behavior.
- Prevent accidental over-pruning under ambiguous matches.
- Keep existing ID-based behavior and tests backward compatible.

### Ambiguities From User Model
- Convenience vs strictness conflict is resolved by dual-mode support: pattern mode for convenience, ID mode retained as canonical fallback.

## Context References

- `src/prune.ts:102` - current prune args and execute flow.
- `src/prune.ts:123` - current phase-1 ID visibility logic.
- `src/prune.ts:150` - existing validation+archive backend path.
- `src/prompt.ts:6` - two-phase guidance currently encoded in prompt.
- `src/prune.test.ts:14` - existing phase/validation behavior tests.
- `src/test/prune-resolution.test.ts:5` - synthetic ID resolution tests.
- `src/index.ts:46` - synthetic placeholder content (summary/index).
- `../opencode_context_management/opencode/packages/opencode/src/tool/edit.ts:184` - upstream matcher functions.
- `../opencode_context_management/opencode/packages/opencode/src/tool/edit.ts:618` - upstream matcher chain order.

## Acceptance Criteria

- [ ] Phase 2 accepts exactly one selector mode:
  - ID mode: `from_id` + `to_id`
  - Pattern mode: `from_pattern` + `to_pattern`
  Mixed-mode or partial-mode inputs return explicit validation errors.
- [ ] Pattern mode resolves each boundary to exactly one stored message ID before entering existing backend validation/archive logic.
- [ ] Per-message pattern matching uses first-successful-heuristic semantics: a heuristic is only successful when at least one produced candidate exists in that message corpus.
- [ ] Pattern resolution uses locally replicated heuristic chain pinned to OpenCode commit `f1ca1dec67f68e318604ada235ea6e4f3782f4b0`.
- [ ] Pattern ambiguity errors are exact and deterministic:
  - `No messages match "<pattern>"`
  - `N messages match "<pattern>"; use a more precise pattern`
- [ ] Existing `summary` and `index_terms` requirements remain unchanged for all Phase-2 modes.
- [ ] Existing ID mode behavior (including synthetic wrapper ID resolution) remains backward compatible.
- [ ] System prompt guidance documents dual mode without removing explicit ID flow guidance.
- [ ] Test suite includes mode matrix, ambiguity handling, tool-output matching, and regression coverage for current behavior.

## Implementation Tasks

1. Add local pure matcher module (no runtime/tool coupling) replicating required OpenCode edit heuristics.
2. Add prune mode contract in `src/prune.ts`:
   - valid: `(from_id,to_id)` XOR `(from_pattern,to_pattern)`
   - invalid: mixed or partial mode
   - keep phase-1 no-arg behavior unchanged.
3. Implement message searchable corpus builder:
   - include non-synthetic/non-ignored text parts
   - include tool name + deterministic serialized `state.input` + completed `state.output`
   - exclude synthetic helper text and pending/running tool outputs
   - define deterministic concatenation delimiters/order.
4. Implement pattern boundary resolver:
   - evaluate each message corpus with matcher chain
   - enforce exactly-one-match per boundary
   - return deterministic boundary error strings.
5. Reuse existing backend path unchanged after resolution:
   - `validatePruneInput` checks
   - archive metadata write
   - same-step prune tracking
   - ID visibility clearing
   - success response path.
6. Update `src/prompt.ts` and `src/prompt.test.ts` to describe dual mode.
7. Add/extend tests for mode matrix, ambiguity paths, tool-output cases, precedence ordering, and regressions.

## Design Details (Locked)

### Heuristic Source and Scope
- Upstream source of truth: OpenCode `packages/opencode/src/tool/edit.ts` at commit `f1ca1dec67f68e318604ada235ea6e4f3782f4b0`.
- Replicate only pure matching logic and keep explicit comment links in local matcher module to manage non-DRY coupling.

### Heuristic Order (Exact)
1. `SimpleReplacer`
2. `LineTrimmedReplacer`
3. `BlockAnchorReplacer`
4. `WhitespaceNormalizedReplacer`
5. `IndentationFlexibleReplacer`
6. `EscapeNormalizedReplacer`
7. `TrimmedBoundaryReplacer`
8. `ContextAwareReplacer`
9. `MultiOccurrenceReplacer`

### Per-Message Match Decision Rule
- For each message corpus string, run heuristics in order.
- For each heuristic, generate candidate(s).
- A heuristic counts as successful only if at least one candidate is present in that message corpus.
- Mark message as matched.
- Stop evaluating later heuristics for that message.
- If no heuristic is successful, message is not matched.

### Reviewer/Judge Verification Notes
- Confirm implementation does not treat candidate generation alone as a match.
- Confirm first-successful-heuristic short-circuiting is preserved per message.
- Confirm tests include a negative case where `SimpleReplacer` yields `find` but corpus containment fails.
- Candidate generation alone is not a match; corpus containment is required.

### Deterministic Tool Input Serialization
- Recursively sort object keys lexicographically.
- Preserve array order.
- Serialize primitives with JSON semantics.
- Handle non-JSON values safely:
  - `BigInt` => string representation
  - `undefined`/`function`/`symbol` dropped in objects
  - `undefined`/`function`/`symbol` => `null` in arrays
- No pretty-print whitespace.

### Error Precedence
1. Mode contract / required-arg errors.
2. `from_pattern` boundary-resolution errors.
3. `to_pattern` boundary-resolution errors.
4. Existing `validatePruneInput` errors.

## Testing Strategy

- Extend `src/prune.test.ts` for end-to-end prune behavior across both selector modes.
- Add matcher-focused tests for deterministic heuristic behavior and serialization edge cases.
- Add precedence tests proving short-circuit order.
- Keep and rerun regression tests for ID mode and synthetic wrapper resolution.

## Validation Commands

- `bun test src/prune.test.ts src/test/prune-resolution.test.ts`
- `bun test`
- `bun run build`

## Validation Loop Results

- Missing details check (iteration 1): identified mode-contract, matcher-scope, and serialization gaps.
- Ambiguity check (iteration 1): identified upstream source pinning ambiguity.
- Validation recheck (iteration 2): narrowed to matcher scope + serialization specificity.
- Final validation (iteration 3): **No blocking gaps**, **No unresolved high-impact ambiguities**.
- Iterations run: 3
