# Epic: Prune Guidance and Pattern Retry Stability

**Goal:** Align prune instructions and runtime behavior with pattern-only pruning, and prevent failed prune attempts from poisoning later pattern retries.
**Depends on:** None
**Parallel with:** None
**Complexity:** Medium

**Supersedes:** `.agents/plans/story-prune-pattern-selection.md` where it conflicts on two-phase/ID-mode guidance.

## User Model

### User Gamut
- CLI users with long mixed conversations (text plus many tool calls) who need reliable pruning under time pressure.
- Maintainers debugging pruning behavior through repeated retries and boundary refinement workflows.
- Safety-focused users who need deterministic prune boundary selection and clear error outcomes.
- Contributors running automated tests where instruction text and tool behavior must stay consistent.

### User-Needs Gamut
- Instructions the model sees must match true supported behavior to avoid invalid tool calls.
- Failed prune attempts must not reduce success probability of the next corrected attempt.
- Tool calls remain searchable/prune-able so sessions with heavy tool usage are still manageable.
- Ambiguity handling stays strict except for explicit, explainable tie-break cases.

### Ambiguities From User Model
- Strict ambiguity rejection improves safety, but retry UX requires one narrow exception; this epic resolves that by adding a deterministic non-prune tie-break only when exactly one non-prune match exists.

## Stories

### Story 1: Remove Two-Phase Guidance and Disable Phase-1 Probe
**Size:** Small
**Description:** Replace two-phase prompt guidance with pattern-only instructions and disable no-arg phase-1 prune calls so behavior matches the documented path.
**Implementation Plan:** `.agents/plans/epic-prune-guidance-and-pattern-retry-stability/story-prune-guidance-and-pattern-retry-stability.1-remove-two-phase-guidance-and-disable-phase-1-probe.md`

### Story 2: Add Ambiguity Tie-Break for Retry Stability
**Size:** Medium
**Description:** Keep tool calls searchable while adding a deterministic exception: when ambiguity exists and exactly one candidate is non-prune, resolve to that candidate.
**Implementation Plan:** `.agents/plans/epic-prune-guidance-and-pattern-retry-stability/story-prune-guidance-and-pattern-retry-stability.2-add-ambiguity-tie-break-for-retry-stability.md`

## Dependencies and Integration

- Prerequisites:
  - Story 1 should land before Story 2 to avoid test overlap on obsolete two-phase wording.
- Enables:
  - Reliable orchestration prompts for prune usage.
  - Stable retry behavior in tool-heavy sessions.
- Integration points:
  - `src/prompt.ts`
  - `src/prompt.test.ts`
  - `src/prune.ts`
  - `src/prune.test.ts`
  - `src/prune-pattern.ts`
  - `src/prune-pattern.test.ts`
