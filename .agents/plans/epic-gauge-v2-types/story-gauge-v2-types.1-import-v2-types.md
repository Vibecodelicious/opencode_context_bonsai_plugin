# Story: Import v2 Types in gauge.ts

**Epic:** Use v2 SDK Types for Gauge Token Tracking
**Size:** Small
**Dependencies:** None

## Story Description

Update `src/gauge.ts` to import types from `@opencode-ai/sdk/v2` instead of `@opencode-ai/sdk`. Remove the `as any` cast on `tokens` and use `tokens.total` with proper type safety.

## User Model

### User Gamut
- Plugin developers reading gauge.ts
- TypeScript compiler checking types
- Future maintainers understanding token handling

### User-Needs Gamut
- Type safety without casts
- Clear code showing `total` is optional
- No runtime behavior changes
- Tests continue passing

### Design Implications
- Import path changes from `@opencode-ai/sdk` to `@opencode-ai/sdk/v2`
- Remove `as any` cast since types are correct
- Keep fallback logic (`tokens.total ?? sumTokens(tokens)`) since `total` is optional

## Acceptance Criteria

- [ ] `src/gauge.ts` imports `Event` from `@opencode-ai/sdk/v2`
- [ ] `src/gauge.ts` imports `TextPart` from `@opencode-ai/sdk/v2`
- [ ] `as any` cast removed from `tokens` variable
- [ ] `tokens.total` accessed with proper optional chaining
- [ ] `bun test` passes
- [ ] `bun run build` succeeds
- [ ] No runtime behavior changes

## Context References

### Relevant Codebase Files (must read)
- `src/gauge.ts:1-2` — current v1 imports
- `src/gauge.ts:21-26` — token handling with `as any` cast
- `src/gauge.test.ts` — tests that may need fixture updates
- `/home/basil/projects/opencode_context_management/opencode/packages/sdk/js/src/v2/gen/types.gen.ts:230-250` — v2 AssistantMessage with `tokens.total`
- `/home/basil/projects/opencode_context_management/opencode/packages/sdk/js/src/gen/types.gen.ts:125-145` — v1 AssistantMessage without `tokens.total`

### Files to Modify
- `src/gauge.ts`
- `src/test/fixtures.ts` — also imports TextPart from v1 SDK

## Implementation Plan

### Phase 1: Update Imports
- Change `import type { Event } from "@opencode-ai/sdk"` to `import type { Event } from "@opencode-ai/sdk/v2"`
- Change `import type { TextPart } from "@opencode-ai/sdk"` to `import type { TextPart } from "@opencode-ai/sdk/v2"`

### Phase 2: Remove Type Cast
- Remove `as any` from line 21: `const tokens = event.properties.info.tokens`
- Verify TypeScript recognizes `tokens.total` as `number | undefined`

### Phase 3: Testing
- Run `bun test src/gauge.test.ts`
- Fix any type errors in test fixtures
- Run full test suite
- Verify build succeeds

## Step-by-Step Tasks

1. Update `src/gauge.ts:1` to import from `@opencode-ai/sdk/v2`
2. Update `src/gauge.ts:2` to import from `@opencode-ai/sdk/v2`
3. Update `src/test/fixtures.ts:1` to import from `@opencode-ai/sdk/v2`
4. Remove `as any` cast from `src/gauge.ts:21`
5. Run `bun test src/gauge.test.ts`
6. Run `bun test` (full suite)
7. Run `bun run build`
8. Verify no errors

## Testing Strategy

- Unit tests: `bun test src/gauge.test.ts` must pass
- Type checking: no TypeScript errors
- Build verification: `bun run build` succeeds
- Behavioral verification: tests confirm same runtime behavior

## Validation Commands

- `bun test src/gauge.test.ts`
- `bun test`
- `bun run build`
- `grep -n "as any" src/gauge.ts` (should return nothing)

## Completion Checklist

- [ ] All acceptance criteria met
- [ ] Tests pass
- [ ] Build succeeds
- [ ] No `as any` casts in gauge.ts
- [ ] Code is clearer and more type-safe
