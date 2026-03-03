# Epic: Use v2 SDK Types for Gauge Token Tracking

**Goal:** Import v2 SDK types in `gauge.ts` to get proper TypeScript types for `tokens.total` field, eliminating the need for `as any` cast.

**Depends on:** None
**Parallel with:** None
**Complexity:** Low

## Background

The gauge feature tracks token usage by listening to `message.updated` events and reading `event.properties.info.tokens`. At runtime, OpenCode sends `tokens.total`, but the v1 SDK types don't include this field. The code currently casts to `any` and falls back to `sumTokens()` when `total` is missing.

The v2 SDK types include `tokens.total?: number` in both `AssistantMessage` and `StepFinishPart` types. By importing v2 types for gauge-related code, we get proper type safety without changing runtime behavior.

## User Model

### User Gamut
- Plugin developers maintaining gauge.ts
- LLMs seeing gauge messages in context
- Users relying on accurate token counts
- Future contributors reading gauge code

### User-Needs Gamut
- Type safety: no `as any` casts
- Correctness: accurate token totals from OpenCode
- Maintainability: clear code without workarounds
- Compatibility: no breaking changes to plugin API or behavior
- Performance: no runtime overhead from type changes

### Ambiguities From User Model
- None identified - this is a pure type-level change with no runtime impact

## Stories

### Story 1: Import v2 Types in gauge.ts
**Size:** Small
**Description:** Change `gauge.ts` to import `Event` and related types from `@opencode-ai/sdk/v2`, remove `as any` cast, update type references to use `tokens.total` safely.
**Implementation Plan:** `.agents/plans/epic-gauge-v2-types/story-gauge-v2-types.1-import-v2-types.md`

## Dependencies and Integration

- Prerequisites: None
- Integration points:
  - `src/gauge.ts` — type imports and token handling
  - `src/gauge.test.ts` — test fixtures may need type updates

## Validation Loop Results

### Iteration 1

**Missing Details Check (smart_subagent):**
- ✅ File paths correct: `src/gauge.ts` exists
- ✅ Line numbers accurate: imports at lines 1-2, `as any` cast at line 21
- ✅ v2 types exist in SDK package
- ⚠️ **Additional file needs updating**: `src/test/fixtures.ts` also imports from v1 SDK

**Ambiguity Check (smart_subagent):**
- Initial concern about TypeScript module resolution was based on `tsc` testing
- **Verified**: Project uses bun, not tsc - `bun build` and `bun test` both work with v2 imports
- Alternative approaches (type augmentation, local types) are inferior - they duplicate type definitions

### Iteration 2

**Completeness Check (smart_subagent):**
- ✅ All files requiring updates identified: `src/gauge.ts` and `src/test/fixtures.ts`
- ✅ Other files checked (`src/convert.ts`, `src/transform.ts`) - do NOT need updates (use identical types)
- ✅ Type compatibility verified: TextPart, Message, Part core interfaces unchanged
- ✅ Current build and tests pass
- ✅ No blocking gaps remaining
- ✅ No unresolved high-impact ambiguities

**Status:** Plan approved and ready for execution.

- Iterations run: 2
