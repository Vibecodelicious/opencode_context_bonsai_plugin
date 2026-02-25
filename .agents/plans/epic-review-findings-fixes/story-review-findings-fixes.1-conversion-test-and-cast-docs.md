# Story: Message Conversion Integration Test and Cast Documentation

**Epic:** Review Findings Fixes
**Size:** Small
**Dependencies:** None

## Story Description

The `experimental.chat.messages.transform` hook in `src/index.ts` converts
plugin framework messages (`{ info: Message; parts: Part[] }`) into the internal
`WithParts` format. This conversion uses `(msg.info as any).metadata || {}` to
extract metadata — an unsafe cast that bypasses TypeScript's type system.

The current test suite creates `WithParts` objects directly via fixture builders,
completely bypassing this conversion. If the upstream SDK changes the shape of
`Message` or the `metadata` field is absent at runtime, archive detection would
silently fail with no test catching it.

This story adds integration-level test coverage for the conversion path and
documents the cast with a code comment.

## User Model

### User Gamut

- Maintainers who encounter the `as any` cast and need to understand why it
  exists and when it can be removed
- CI pipelines that should catch regressions if the SDK Message type changes
- Developers debugging "archives not detected" issues

### User-Needs Gamut

- Test coverage of the actual runtime code path, not just the internal function
- Clear documentation of known type gaps and their upstream dependency

### Design Implications

- The test must simulate what the plugin framework actually passes to the hook:
  `{ info: Message; parts: Part[] }` objects — NOT pre-built `WithParts`
- The test should verify that metadata flows through to archive detection

## Acceptance Criteria

- [ ] Extract the message conversion logic (lines 26-33 of `src/index.ts`, the
  `output.messages.map(...)` block) into a separate exported function so it can
  be tested directly. Suggested name: `convertPluginMessages` in a new file or
  in `src/index.ts`.
- [ ] Add integration test(s) to the existing `src/index.test.ts` that:
  - Construct messages in the plugin framework shape (`{ info: { id, sessionID,
    role, metadata: { [PLUGIN_ID]: { archive: {...} } } }, parts: [...] }`)
  - Call the extracted conversion function
  - Pass the result to `transformMessages()`
  - Assert that archive messages have placeholder parts with expected content
- [ ] Code comment added above the metadata extraction (line 31 of
  `src/index.ts`) explaining:
  - Why the `as any` cast is needed (SDK types define `Message` without
    `metadata`; the hook input is typed as `{}` without `sessionID`)
  - That `metadata` exists at runtime (added in Phase 1 upstream changes)
  - When this cast can be removed (when `@opencode-ai/plugin` types are updated)
- [ ] All existing tests still pass (`bun test`)
- [ ] Build succeeds (`bun run build`)

## Context References

### Relevant Codebase Files (must read)

- `src/index.ts:21-35` — The transform hook with conversion logic at lines
  26-33 and metadata cast at line 31
- `src/index.test.ts` — **Existing test file** with 3 tests (plugin factory,
  hooks structure, system transform). Add new tests here.
- `src/transform.ts:6-92` — `transformMessages()` that receives converted messages
- `src/schema.ts` — `getArchive()` reads `msg.metadata[pluginID].archive`
- `src/test/fixtures.ts` — `WithParts` type definition and fixture builders
- `src/constants.ts` — `PLUGIN_ID = "opencode-context-bonsai"`
- `node_modules/@opencode-ai/plugin/dist/index.d.ts` — The `Hooks` type:
  ```typescript
  "experimental.chat.messages.transform"?: (input: {}, output: {
      messages: { info: Message; parts: Part[] }[];
  }) => Promise<void>;
  ```
  Note: `input` is typed as `{}` — no `sessionID`. At runtime, `sessionID`
  exists on `input`.

### New Files to Create

- None (add tests to existing `src/index.test.ts`; conversion function can be
  added to `src/index.ts` or extracted to a small helper)

### Relevant Documentation

- `.agents/reviews/story-3-rejected-findings-report.md` — Finding C2 details

## Implementation Plan

### Phase 1: Extract Conversion Function

- Extract the `output.messages.map(...)` block (lines 26-33 of `src/index.ts`)
  into a separate exported function, e.g.:
  ```typescript
  export function convertPluginMessages(
    messages: { info: Message; parts: Part[] }[]
  ): WithParts[]
  ```
- The hook body calls this function instead of inline mapping
- This is a pure refactor — no behavior change

### Phase 2: Add Code Comment

- Add a multi-line comment above `(msg.info as any).metadata || {}` explaining
  the type gap, runtime reality, and removal condition

### Phase 3: Write Integration Test

- In `src/index.test.ts`, add a `describe("message conversion")` block
- Build messages shaped like the plugin framework provides them:
  ```typescript
  const pluginMessages = [{
    info: { id: "msg1", sessionID: "s1", role: "assistant",
            metadata: { [PLUGIN_ID]: { archive: { summary: "...", indexTerms: [...], rangeEnd: "msg2" } } } },
    parts: [{ id: "p1", sessionID: "s1", messageID: "msg1", type: "text", text: "original" }]
  }]
  ```
- Call `convertPluginMessages(pluginMessages)`
- Pass result to `transformMessages()`
- Assert placeholder rendering

### Phase 4: Validate

- Run `bun test` — all tests pass including new ones
- Run `bun run build` — build succeeds

## Step-by-Step Tasks

1. Read `src/index.ts` lines 21-35 to understand the exact conversion code
2. Extract the conversion into an exported function
3. Update the hook to call the extracted function
4. Add a code comment above the `(msg.info as any).metadata` line
5. Add integration test(s) to `src/index.test.ts`
6. Run `bun test` to verify all tests pass
7. Run `bun run build` to verify build succeeds
8. Commit with message `[Story RF.1] Add conversion integration test and cast documentation`

## Testing Strategy

- Integration test: verify the conversion path preserves metadata for archive
  detection end-to-end (plugin framework shape → WithParts → transformMessages
  → placeholder rendered)
- Regression: all existing tests must continue to pass

## Validation Commands

- `bun test`
- `bun run build`

## Completion Checklist

- [ ] All acceptance criteria met
- [ ] Validation commands pass
- [ ] Code comment is accurate and references the upstream type gap
- [ ] Test exercises the real conversion path, not fixture shortcuts
- [ ] Extracted function is used by the hook (no duplication)
