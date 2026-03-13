# Story: Add Ambiguity Tie-Break for Retry Stability

**Epic:** Prune Guidance and Pattern Retry Stability
**Size:** Medium
**Dependencies:** Story 1

## Story Description

Pattern matching should continue to include tool-call corpus so tool-heavy messages remain prune-able. However, failed prune attempts currently add prune-call text that can create extra matches and block corrected retries. This story introduces a narrow deterministic exception: when a boundary pattern matches multiple messages and exactly one candidate is non-prune, select that non-prune candidate; otherwise keep strict ambiguity failure behavior.

## User Model

### User Gamut
- Users iteratively refining prune boundary patterns after an ambiguity error.
- Operators pruning sessions with repeated `context-bonsai-prune` attempts and large tool logs.
- Reliability-focused maintainers who want strict matching but predictable retry behavior.

### User-Needs Gamut
- Tool calls remain in corpus to preserve prune-ability of tool-heavy content.
- Retrying with corrected patterns should not be sabotaged by earlier failed prune calls.
- Tie-break rules must be explicit, narrow, and easy to reason about in tests.

### Design Implications
- Keep existing corpus inclusion model intact unless evidence requires additional change.
- Implement tie-break at boundary resolution stage where ambiguity is decided.
- Preserve strict failure for all ambiguous cases that do not meet the single non-prune exception.
- Lock classification rule for ambiguity tie-break:
  - prune candidate: message with at least one completed tool part where `part.type === "tool"` and `part.tool === "context-bonsai-prune"`.
  - non-prune candidate: any matched message not satisfying the prune candidate rule.
  - if multiple matched messages and exactly one is non-prune, select that non-prune message.

## Acceptance Criteria

- [ ] Pattern resolution still includes completed tool-call input/output in searchable corpus.
- [ ] For ambiguous matches, resolver selects the boundary when exactly one candidate is a non-prune message.
- [ ] Resolver still errors when ambiguous set has multiple non-prune candidates.
- [ ] Resolver still errors when ambiguous set has only prune-call candidates.
- [ ] Regression test covers retry flow where an earlier failed prune call would previously poison a subsequent boundary match.
- [ ] Tie-break behavior is deterministic and covered for both `from_pattern` and `to_pattern` resolution paths.

## Context References

### Relevant Codebase Files (must read)
- `src/prune-pattern.ts:53` - message corpus composition, including tool input/output serialization.
- `src/prune-pattern.ts:85` - current boundary resolution logic and ambiguity error behavior.
- `src/prune.ts:178` - boundary resolution invocation and error precedence.
- `src/prune.test.ts:199` - pattern-mode end-to-end tests.
- `src/prune.test.ts:247` - current ambiguity tests validating strict multi-match failure.
- `src/prune-pattern.test.ts:6` - matcher and resolver utility tests where tie-break unit coverage should be added.

### New Files to Create
- None.

### Relevant Documentation
- `.llm-conductor/planning_guidance.md:59` - explicit duplication/coupling risk handling principles.
- `.llm-conductor/planning_guidance.md:135` - use user-model impacts to shape acceptance criteria.

## Implementation Plan

### Phase 1: Foundation
- Use fixed candidate classification criteria for prune-call vs non-prune message based on completed tool parts with tool name `context-bonsai-prune`.
- Define tie-break precedence and confirm it applies only in ambiguous-match branch.

### Phase 2: Core Implementation
- Update pattern boundary resolver to compute candidate set and apply narrow tie-break.
- Keep existing no-match and non-qualifying ambiguity error surfaces unchanged.

### Phase 3: Integration
- Verify prune execution path receives resolved IDs without additional behavior change.
- Ensure compatibility with existing deterministic serializer and matcher chain.

### Phase 4: Testing and Validation
- Add/extend unit tests in `src/prune-pattern.test.ts` for all tie-break branches.
- Add end-to-end regression in `src/prune.test.ts` simulating failed prune attempt followed by corrected retry.

## Step-by-Step Tasks

1. Implement message-level prune-call classification helper in resolver scope.
2. Update ambiguity branch in `resolvePatternBoundary` to apply single non-prune tie-break.
3. Add unit tests for ambiguous branches: one non-prune, many non-prune, all prune.
4. Add retry regression test in prune integration tests covering from/to boundary correction after failed attempt.
5. Run focused resolver and prune tests, then full suite.

## Testing Strategy

- Resolver-focused tests in `src/prune-pattern.test.ts` validate deterministic tie-break behavior.
- End-to-end tests in `src/prune.test.ts` validate real prune flow behavior with repeated calls.
- Full-suite regression run ensures no collateral behavior changes.

## Validation Commands

- `bun test src/prune-pattern.test.ts src/prune.test.ts`
- `bun test`
- `bun run build`

## Completion Checklist

- [ ] All acceptance criteria met
- [ ] Validation commands pass
- [ ] User-model ambiguities resolved or escalated
