# Epic: Caller-Provided Summaries

**Goal:** Eliminate the plugin's out-of-band `generateText()` call by making
`summary` and `indexTerms` required parameters of the prune tool's Phase 2.
The main LLM — which already has a working pipeline with proper provider
options — generates the summary itself and passes it to the tool.

**Depends on:** Epic: Context Bonsai Plugin (all 6 stories complete)
**Parallel with:** None
**Complexity:** Medium

## Background

The plugin's `summarizeRange()` in `src/summarize.ts` calls `generateText()`
with a `LanguageModelV2` from the tool context. This fails with
`{"detail":"Instructions are required"}` because:

1. The model (`gpt-5.3-codex`) uses the OpenAI Responses API which requires a
   top-level `instructions` field in the request body.
2. OpenCode's main pipeline injects this field for codex models, but the raw
   `LanguageModelV2` passed to plugins has no such injection.
3. Seven attempts to work around this (bare prompt, system messages,
   providerOptions, Proxy wrappers, zod upgrades) all failed. The
   `providerOptions` don't survive the cross-package boundary between the
   plugin's `ai` SDK instance and the model's `doGenerate`.

Full diagnosis: `context-bonsai-summarization-diagnosis.md`

The fix: don't make a separate LLM call. The main LLM already has the
conversation context and a working pipeline. Make it produce the summary and
pass it as a tool argument.

## User Model

### User Gamut

- LLMs calling the prune tool — must understand they need to provide a summary
  and index terms as arguments, not just message IDs
- Users on any model/provider — the approach is inherently model-agnostic since
  the main LLM's pipeline handles all provider-specific concerns
- Users on expensive models — summary generation now uses main conversation
  tokens rather than a separate call, but the cost is comparable (the LLM was
  reading the context anyway)

### User-Needs Gamut

- Summary quality: the LLM has full conversation context and can produce better
  summaries than a separate call with extracted text snippets
- Reliability: no cross-package boundary issues, no provider-specific option
  injection, no separate API call that can fail
- Simplicity: fewer moving parts, easier to debug

### Ambiguities From User Model

- **Summary quality without enforcement**: The LLM might produce low-quality
  summaries if not guided. Resolution: the system prompt already provides
  pruning guidance; Story 2 updates it with explicit summary quality
  requirements and the expected format.
- **Index terms naming**: The current codebase uses `indexTerms` in the schema
  and `INDEX:` in the summarization prompt. The tool parameter will use
  `index_terms` (snake_case, matching `from_id`/`to_id` convention).

## Stories

### Story 1: Make Summary and Index Terms Required Tool Parameters
**Size:** Medium
**Description:** Change the prune tool's Phase 2 to require `summary` and
`index_terms` as input parameters instead of calling `summarizeRange()`.
Remove `src/summarize.ts`. Update tests.
**Implementation Plan:** `.agents/plans/epic-caller-provided-summaries/story-caller-provided-summaries.1-tool-parameters.md`

### Story 2: Update System Prompt for Caller-Provided Summaries
**Size:** Small
**Description:** Update the system prompt guidance to instruct the LLM on
summary quality, format, and the new required parameters for Phase 2.
Update prompt tests.
**Implementation Plan:** `.agents/plans/epic-caller-provided-summaries/story-caller-provided-summaries.2-system-prompt.md`

### Story 3: Cleanup and Dependency Removal
**Size:** Small
**Description:** Remove the `ai` SDK dependency (no longer needed — the plugin
doesn't make LLM calls), revert zod to v3 (the v4 upgrade was part of the
failed fix attempt), and clean up any dead code.
**Implementation Plan:** `.agents/plans/epic-caller-provided-summaries/story-caller-provided-summaries.3-cleanup.md`

## Dependencies and Integration

- Prerequisites: All 6 original stories complete (they are)
- Story dependency chain: 1 → 2 → 3
  - Story 2 depends on Story 1 (prompt must match new tool interface)
  - Story 3 depends on Stories 1 and 2 (cleanup after functional changes)
- Integration points:
  - `src/prune.ts` — tool definition changes
  - `src/prompt.ts` — system prompt changes
  - `src/summarize.ts` — deleted
  - `package.json` — dependency removal

## Validation Loop Results

### Iteration 1: Missing Details Check

Findings:

- **`ai` SDK usage elsewhere**: Checked all source files. Only `src/summarize.ts`
  imports from `ai`. The `@opencode-ai/plugin` peer dependency provides the
  `tool()` helper and types. Removing `ai` from `dependencies` is safe.
- **zod v3 vs v4**: `src/schema.ts` currently imports from `zod/v4` (from
  attempt #7). Reverting to `zod` (v3) requires changing this import back.
  The `tool.schema` used in tool args comes from `@opencode-ai/plugin`, not
  from the plugin's own zod — so the plugin's zod version only matters for
  `src/schema.ts`.
- **Test mocks**: `src/prune.test.ts` mocks `summarizeRange` from
  `./summarize`. After Story 1, this mock is removed and tests pass `summary`
  and `index_terms` as tool args directly.
- **`WithParts` type**: Used by `summarizeRange` signature. After deletion,
  `src/summarize.ts` is the only file that imports `WithParts` for
  summarization. Other files import it for their own purposes — no cascade.

### Iteration 1: Ambiguity Check

Findings:

- **Phase 2 parameter naming**: `from_id`, `to_id`, `reason` use snake_case.
  New params follow suit: `summary`, `index_terms`. No ambiguity.
- **Should `reason` remain?**: Yes. It's a separate concern (why the LLM chose
  to prune) vs. the summary (what was in the pruned content). Both are useful.
- **Minimum summary length**: Not enforced in code. The system prompt provides
  guidance ("1-3 sentences"). Runtime validation would be brittle and
  model-dependent. Relying on prompt guidance is the right call.

### Iteration 2: Sub-agent Validation

Findings incorporated into story updates:

- **Empty summary/index_terms**: Added validation for non-empty string and
  non-empty array. Story 1 acceptance criteria and test strategy updated.
- **Metadata field mapping**: Made explicit that `args.index_terms` (snake_case)
  maps to `indexTerms` (camelCase) in the archive schema. Story 1 updated.
- **Mock cleanup**: Story 1 now explicitly lists removing `mock.module` block,
  `mockSummarizeRange` variable, and the import. Not just "remove mock".
- **Prompt parameter names**: Current prompt says `startMessageID, endMessageID`
  but actual tool params are `from_id, to_id`. Story 2 now includes fixing
  this pre-existing mismatch.
- **Phase 2 validation strategy**: Fail fast with specific error per missing
  param (not a single generic error). Consistent with existing validation
  pattern in `validatePruneInput`.

### Iteration 3

No blocking gaps remain. All sub-agent findings addressed in story updates.

- Iterations run: 3
