# Story: Make Summary and Index Terms Required Tool Parameters

**Epic:** Caller-Provided Summaries
**Size:** Medium
**Dependencies:** None (first story in epic)

## Story Description

Change the prune tool's Phase 2 to accept `summary` and `index_terms` as
required parameters (required for Phase 2, optional in the Zod schema since
Phase 1 takes no args). Remove the `summarizeRange()` call and delete
`src/summarize.ts`. Update `src/prune.test.ts` to pass summary/index_terms
as tool args instead of mocking `summarizeRange`.

## User Model

### User Gamut

- LLMs calling the tool — must now provide summary and index terms as args
- Plugin maintainers — simpler code path, no LLM call wrapper to maintain

### User-Needs Gamut

- Tool must clearly communicate via its description and arg descriptions that
  Phase 2 requires summary and index_terms
- Error messages must guide the LLM if it omits required Phase 2 args

### Design Implications

- All tool parameters remain optional in the Zod schema (Phase 1 takes none)
- Phase 2 validation checks for `summary` and `index_terms` alongside
  `from_id` and `to_id`

## Acceptance Criteria

- [ ] `summary` parameter added: `tool.schema.string().optional().describe(...)`
- [ ] `index_terms` parameter added: `tool.schema.array(tool.schema.string()).optional().describe(...)`
- [ ] Phase 2 validation requires `summary` and `index_terms` when `from_id`
      and `to_id` are present — returns specific error per missing param
- [ ] Phase 2 validates `summary` is non-empty string and `index_terms` is
      non-empty array — returns actionable error if empty
- [ ] Phase 2 writes `summary: args.summary` and `indexTerms: args.index_terms`
      (note snake_case→camelCase mapping) to archive metadata — no
      `summarizeRange()` call
- [ ] `src/summarize.ts` deleted
- [ ] `src/prune.ts` no longer imports from `./summarize`
- [ ] `src/prune.test.ts` updated: remove `mock.module('./summarize', ...)`
      block, remove `mockSummarizeRange` variable, remove
      `import * as summarizeModule`, update test args
- [ ] All existing validation tests still pass (ID checks, chronological order,
      pruned range overlap, incomplete tool calls)
- [ ] `bun test` passes
- [ ] `bun run build` passes

## Context References

### Relevant Codebase Files (must read)

- `src/prune.ts` — current prune tool, calls `summarizeRange()` at line ~97
- `src/summarize.ts` — to be deleted
- `src/prune.test.ts` — mocks `summarizeRange`, needs update
- `src/schema.ts` — `ArchiveSchema` defines `summary`, `indexTerms`, `rangeEnd`
- `src/test/fixtures.ts` — `WithParts` type, test helpers

### Files to Modify

- `src/prune.ts` — add params, remove summarize call, update Phase 2 flow
- `src/prune.test.ts` — remove mock, pass args directly

### Files to Delete

- `src/summarize.ts`

## Implementation Plan

### Phase 1: Update Tool Parameters

In `src/prune.ts`, add to the `args` object:
```typescript
summary: tool.schema.string().optional().describe(
  'Concise summary (1-3 sentences) of the archived content (Phase 2)'
),
index_terms: tool.schema.array(tool.schema.string()).optional().describe(
  'Keywords for retrieval, 3-8 terms (Phase 2)'
),
```

### Phase 2: Update Phase 2 Validation and Flow

In the `execute` function, after the existing `from_id`/`to_id` check:
- Add validation: if Phase 2 args present but `summary` or `index_terms`
  missing, return actionable error
- Remove the `summarizeRange()` call
- Write `args.summary` and `args.index_terms` directly to archive metadata

### Phase 3: Delete summarize.ts

- Delete `src/summarize.ts`
- Remove the import from `src/prune.ts`

### Phase 4: Update Tests

In `src/prune.test.ts`:
- Remove the `summarizeRange` mock and `mock.module('./summarize', ...)`
- Remove the `import * as summarizeModule` line
- Update the "successful archiving" test to pass `summary` and `index_terms`
  as tool args
- Update the "handles summarization failure" test — this test no longer applies
  (there's no summarization call to fail). Replace with a test for missing
  `summary`/`index_terms` validation.
- Verify all other tests still pass unchanged

## Step-by-Step Tasks

1. Add `summary` and `index_terms` to tool args in `src/prune.ts`
2. Add Phase 2 validation for missing `summary`/`index_terms`
3. Replace `summarizeRange()` call with direct metadata write from args
4. Remove `import { summarizeRange } from './summarize'`
5. Delete `src/summarize.ts`
6. Update `src/prune.test.ts`: remove mock, update test args
7. Replace summarization failure test with missing-args validation test
8. Run `bun test` and `bun run build`

## Testing Strategy

- "Successful archiving" test passes `summary` and `index_terms` as args,
  verifies metadata written correctly with camelCase `indexTerms`
- New test: Phase 2 without `summary` returns specific error
- New test: Phase 2 without `index_terms` returns specific error
- New test: Phase 2 with empty `summary` string returns error
- New test: Phase 2 with empty `index_terms` array returns error
- Phase 1 test unchanged (no args → ID visibility)

## Validation Commands

- `bun test`
- `bun run build`

## Completion Checklist

- [ ] All acceptance criteria met
- [ ] Validation commands pass
- [ ] No references to `summarize.ts` remain in codebase
