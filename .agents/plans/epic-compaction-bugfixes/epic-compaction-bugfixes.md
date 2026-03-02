# Epic: Compaction Bugfixes

**Goal:** Fix two bugs discovered during E2E testing that prevent compaction
from working correctly: single-message ranges are rejected, and transformed
messages don't propagate to the LLM.

**Depends on:** Epic: Caller-Provided Summaries (complete)
**Parallel with:** None
**Complexity:** Low

## Background

E2E testing with `/tmp/failed_compaction.json` revealed two bugs:

1. The LLM tried to compact a single message (`from_id === to_id`) and got
   `"from_id must precede to_id chronologically"` because `validatePruneInput`
   uses `>=` instead of `>`.

2. After successfully compacting a 2-message range, the original content was
   still visible to the LLM. Root cause: the transform hook in `src/index.ts`
   reassigns `output.messages` to a new array, but OpenCode's `prompt.ts`
   continues using the original `sessionMessages` local variable (which was
   passed as the `messages` property of the output object). Reassigning the
   property doesn't update the local variable. The fix is to mutate the array
   in-place.

## User Model

### User Gamut

- LLMs compacting single messages (e.g., a single sensitive message, a single
  large tool output)
- LLMs compacting multi-message ranges (the common case)
- Users relying on compaction to actually remove content from LLM context
  (privacy, token savings, correctness)

### User-Needs Gamut

- Single-message compaction must work — it's a natural operation when one
  message contains sensitive or large content
- Compacted content must actually be invisible to the LLM — the entire point
  of compaction is context reduction
- Placeholder summaries must replace original content in what the LLM sees

### Ambiguities From User Model

- None. Both bugs have clear, unambiguous fixes.

## Stories

### Story 1: Allow Single-Message Prune Ranges
**Size:** Small
**Description:** Change `validatePruneInput` to allow `from_id === to_id`
(single-message ranges). Update the error message and add a test.
**Implementation Plan:** `.agents/plans/epic-compaction-bugfixes/story-compaction-bugfixes.1-single-message-range.md`

### Story 2: Fix Transform Hook In-Place Mutation
**Size:** Small
**Description:** Change the transform hook in `src/index.ts` to mutate
`output.messages` in-place instead of reassigning it, so transformed messages
propagate to OpenCode's LLM pipeline.
**Implementation Plan:** `.agents/plans/epic-compaction-bugfixes/story-compaction-bugfixes.2-transform-in-place.md`

## Validation Loop Results

### Iteration 1

**Missing Details Check:**
- Line numbers in Story 1 are approximate (off by 1) — non-blocking, developer
  reads the actual file.
- Concern raised about `origById.get(msg.id)!` in Story 2 for synthetic
  messages — resolved: `transformMessages` doesn't create new messages, only
  modifies parts on existing ones. All message IDs in the transformed array
  exist in the original array. The `!` assertion is safe.

**Ambiguity Check:**
- Error message wording change: only the test depends on exact string. Low risk.
- In-place mutation approach (`length = 0` + push) confirmed correct. Splice
  alternative works but is less readable.
- Single-message range in transform: already handled and tested
  (`transform.test.ts` has "single-message range: anchor replaced, no
  followers" test).
- Parallel execution: safe — stories modify different files with no shared
  code paths.

No blocking gaps. No unresolved high-impact ambiguity. Stopping validation.

- Iterations run: 1

## Dependencies and Integration

- Prerequisites: Caller-Provided Summaries epic complete (it is)
- Story dependency chain: 1 and 2 are independent — can run in parallel
- Integration points:
  - `src/prune.ts` — validation fix (Story 1)
  - `src/index.ts` — transform hook fix (Story 2)
