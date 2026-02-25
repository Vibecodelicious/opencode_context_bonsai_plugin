# Epic: Review Findings Fixes

**Goal:** Address confirmed issues from the Story 3 adversarial review that the
judge incorrectly rejected. Two findings were validated by independent
investigation: C2 (unsafe metadata cast with no integration test coverage) and
H1 (dead defensive Math.min/max code obscuring an ordering invariant).

**Depends on:** Epic Context Bonsai Plugin (all 6 stories complete)
**Parallel with:** None
**Complexity:** Low

## User Model

### User Gamut

- Plugin maintainers reading the codebase months later who need to understand
  why `as any` casts exist and what invariants the code relies on
- Contributors adding new archive creation paths (e.g., bulk prune, auto-prune)
  who might not enforce the same ordering constraint
- CI/CD pipelines that need the integration test to catch regressions if the
  upstream `@opencode-ai/plugin` SDK changes its Message shape
- Developers debugging silent archive detection failures caused by metadata
  being absent at runtime

### User-Needs Gamut

- Code clarity: dead defensive code and undocumented casts make the codebase
  harder to reason about
- Regression safety: the message conversion path is the only bridge between
  plugin framework types and internal types — it must be tested
- Invariant visibility: if anchor-before-rangeEnd is a system invariant, it
  should be stated explicitly in the code, not hidden behind Math.min/max

### Ambiguities From User Model

- **Should Math.min/max be removed or kept as defensive code?** Investigation
  concluded removal is correct — the prune tool enforces ordering, and keeping
  Math.min/max obscures the invariant. If a future code path violates the
  invariant, it's better to fail visibly than silently produce wrong results.

## Stories

### Story 1: Message Conversion Integration Test and Cast Documentation
**Size:** Small
**Description:** Add an integration test that exercises the actual
plugin-framework-to-WithParts message conversion in `src/index.ts`, verifying
archive metadata flows through correctly. Add a code comment at the `as any`
cast site explaining the upstream type gap.
**Implementation Plan:** `.agents/plans/epic-review-findings-fixes/story-review-findings-fixes.1-conversion-test-and-cast-docs.md`

### Story 2: Remove Dead Defensive Range Code
**Size:** Small
**Description:** Replace `Math.min/Math.max` range calculation in
`src/transform.ts` with direct assignment, add a comment documenting the
ordering invariant enforced by the prune tool.
**Implementation Plan:** `.agents/plans/epic-review-findings-fixes/story-review-findings-fixes.2-remove-dead-range-code.md`

## Dependencies and Integration

- Prerequisites: Epic Context Bonsai Plugin complete (all 6 stories)
- Stories 1 and 2 are fully independent and can run in parallel
- Integration points:
  - Story 1 touches `src/index.ts` (comment only) and adds a new test file
  - Story 2 touches `src/transform.ts` (2-line code change + comment)
  - No shared modifications — no merge conflict risk

## Investigation Reference

Full investigation report with evidence:
`.agents/reviews/story-3-rejected-findings-report.md`
