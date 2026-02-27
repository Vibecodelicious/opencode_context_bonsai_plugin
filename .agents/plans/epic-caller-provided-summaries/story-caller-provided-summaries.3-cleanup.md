# Story: Cleanup and Dependency Removal

**Epic:** Caller-Provided Summaries
**Size:** Small
**Dependencies:** Stories 1 and 2

## Story Description

Remove the `ai` SDK from `dependencies` (no longer needed — the plugin makes
no LLM calls). Revert zod from v4 to v3 (the v4 upgrade was part of failed
attempt #7 and is unnecessary). Clean up any remaining dead code or imports
related to the old summarization approach.

## User Model

### User Gamut

- Plugin consumers installing via npm — fewer dependencies means smaller
  install, fewer version conflicts
- Plugin maintainers — cleaner dependency surface

### User-Needs Gamut

- Plugin must still build and pass all tests after dependency changes
- No runtime breakage from zod downgrade

### Design Implications

- `src/schema.ts` imports `z` from `zod/v4` — must change to `zod`
- `@opencode-ai/plugin` provides `tool.schema` (its own zod instance) for
  tool args — the plugin's own zod is only used in `src/schema.ts`
- The `LanguageModel` type was imported from `ai` in `src/summarize.ts` which
  is now deleted. Verify no other file imports from `ai`.

## Acceptance Criteria

- [ ] `ai` removed from `dependencies` in `package.json`
- [ ] `zod` reverted to `"^3.23.0"` in `package.json`
- [ ] `src/schema.ts` imports from `"zod"` (not `"zod/v4"`)
- [ ] No source file imports from `ai` package
- [ ] No source file imports from `./summarize`
- [ ] `bun install` succeeds
- [ ] `bun test` passes (51+ tests)
- [ ] `bun run build` passes

## Context References

### Relevant Codebase Files (must read)

- `package.json` — current dependencies
- `src/schema.ts` — imports `z` from `zod/v4`
- All `src/*.ts` files — verify no `ai` imports remain

### Files to Modify

- `package.json` — remove `ai`, downgrade `zod`
- `src/schema.ts` — change import path

## Implementation Plan

### Phase 1: Verify No Other ai Imports

Search all `src/**/*.ts` for `from 'ai'` or `from "ai"`. After Story 1
deleted `src/summarize.ts`, there should be zero matches.

### Phase 2: Update package.json

- Remove `"ai": "^5.0.0"` from `dependencies`
- Change `"zod": "^4.0.0"` to `"zod": "^3.23.0"`

### Phase 3: Update schema.ts Import

Change `import { z } from "zod/v4"` to `import { z } from "zod"`.

### Phase 4: Reinstall and Test

- `bun install`
- `bun test`
- `bun run build`

## Step-by-Step Tasks

1. Grep for `ai` imports across `src/` — confirm none remain
2. Remove `ai` from `package.json` dependencies
3. Change zod version to `^3.23.0` in `package.json`
4. Change `src/schema.ts` import to `from "zod"`
5. Run `bun install`
6. Run `bun test`
7. Run `bun run build`

## Testing Strategy

- All existing tests must pass — this is a dependency-only change with one
  import path fix
- No new tests needed

## Validation Commands

- `grep -r "from ['\"]ai['\"]" src/` (should return nothing)
- `grep -r "from ['\"]zod/v4['\"]" src/` (should return nothing)
- `bun install`
- `bun test`
- `bun run build`

## Completion Checklist

- [ ] All acceptance criteria met
- [ ] Validation commands pass
- [ ] `ai` package no longer in dependency tree
