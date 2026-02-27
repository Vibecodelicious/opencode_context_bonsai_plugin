# Story: Update System Prompt for Caller-Provided Summaries

**Epic:** Caller-Provided Summaries
**Size:** Small
**Dependencies:** Story 1 (tool interface must be finalized first)

## Story Description

Update the system prompt guidance in `src/prompt.ts` to reflect the new
Phase 2 interface: the LLM must provide `summary` and `index_terms` as tool
arguments. Add guidance on summary quality and index term selection. Update
`src/prompt.test.ts`.

## User Model

### User Gamut

- LLMs reading the system prompt — must understand the new tool calling
  convention and produce quality summaries
- Different model families (GPT, Claude, Gemini, etc.) — guidance must be
  clear enough for any model to follow

### User-Needs Gamut

- Clear instructions on what constitutes a good summary
- Explicit parameter list for Phase 2 so the LLM doesn't omit args
- Index term guidance: what makes good retrieval keywords

### Design Implications

- Keep prompt concise — every token counts in the context window
- Be prescriptive about Phase 2 args to minimize tool call failures

## Acceptance Criteria

- [ ] System prompt documents Phase 2 required args: `from_id`, `to_id`,
      `summary`, `index_terms`, and optional `reason`
- [ ] Current incorrect parameter names (`startMessageID`, `endMessageID`)
      corrected to match actual tool params (`from_id`, `to_id`)
- [ ] Summary quality guidance: 1-3 sentences, focus on decisions made,
      outcomes reached, and key learnings — not play-by-play
- [ ] Index term guidance: 3-8 keywords covering topics, tools used, files
      touched, and outcomes
- [ ] No references to "LLM-generated summary" or automatic summarization
      (the LLM IS the summarizer now)
- [ ] `src/prompt.test.ts` updated to check for new keywords
- [ ] `bun test` passes

## Context References

### Relevant Codebase Files (must read)

- `src/prompt.ts` — current system prompt, references "startMessageID,
  endMessageID, and summary" in Phase 2 description
- `src/prompt.test.ts` — tests for prompt content
- `src/prune.ts` — tool description and arg descriptions (after Story 1)

### Files to Modify

- `src/prompt.ts` — update guidance text
- `src/prompt.test.ts` — update assertions

## Implementation Plan

### Phase 1: Update Prompt Text

In `src/prompt.ts`, update `getSystemPromptGuidance()`:

- Update the "Two-Phase Prune Flow" section:
  - Phase 2 now takes `from_id`, `to_id`, `summary`, `index_terms`, and
    optionally `reason`
  - The LLM writes the summary itself based on the content being pruned
- Add a "Summary Quality" section with brief guidance
- Add an "Index Terms" section with brief guidance
- Remove any language implying automatic/separate summarization

### Phase 2: Update Tests

In `src/prompt.test.ts`:
- Update assertions to match new prompt content

## Step-by-Step Tasks

1. Update `getSystemPromptGuidance()` in `src/prompt.ts`
2. Update `src/prompt.test.ts` assertions
3. Run `bun test`

## Testing Strategy

- `src/prompt.test.ts` verifies key phrases appear in the prompt output
- Manual review of prompt text for clarity and completeness

## Validation Commands

- `bun test`
- `bun run build`

## Completion Checklist

- [ ] All acceptance criteria met
- [ ] Validation commands pass
- [ ] Prompt reads naturally and is concise
