# Story 3 — Rejected Critical & High Findings Report

**Story**: 3 - Archive Schema and Transform Hook
**Date**: 2026-02-25
**Purpose**: Document rejected reviewer findings, investigation outcomes, and
remaining items needing investigation. An LLM continuing this work should read
the referenced files, complete the uninvestigated items, and update story plans
with fixes for any confirmed issues.

## Project Context

- **Repo**: `/home/basil/projects/opencode_context_bonsai_plugin`
- **Story plan**: `.agents/plans/epic-context-bonsai-plugin/story-context-bonsai-plugin.3-archive-schema-and-transform-hook.md`
- **Epic plan**: `.agents/plans/epic-context-bonsai-plugin/epic-context-bonsai-plugin.md`
- **Plugin type definitions**: `node_modules/@opencode-ai/plugin/` (check `package.json` `types` field for entry point)
- **Key source files**:
  - `src/index.ts` — Plugin factory, hook wiring, message format conversion
  - `src/transform.ts` — `transformMessages()` implementation
  - `src/transform.test.ts` — Transform unit tests
  - `src/schema.ts` — `ArchiveSchema`, `getArchive()`, `hasArchive()`
  - `src/test/fixtures.ts` — Shared test fixture builders
  - `src/state.ts` — Per-session state management

## Background

During the develop-review-judge loop for Story 3, the adversarial reviewer
raised 5 Critical/High findings. The judge approved 2 (both fixed in iteration
2, commit `b9b1ea5`) and rejected 3. Two of the rejected findings were
subsequently investigated by independent agents. One remains uninvestigated.

---

## Finding C1 — Incorrect sessionID Extraction

- **Severity**: CRITICAL
- **Judge ruling**: APPROVED (must fix)
- **Status**: ✅ Fixed in commit `b9b1ea5`

**Issue**: The `experimental.chat.messages.transform` hook in `src/index.ts`
extracted sessionID from `output.messages[0]?.info.sessionID` instead of using
`input.sessionID`. The story context explicitly states the hook receives
`{ sessionID, model }` as input.

**Resolution**: Changed to `(input as any).sessionID` with fallback chain. The
`as any` cast is needed because the `@opencode-ai/plugin` TypeScript types
define the transform hook input as `{}` (empty object), but `sessionID` is
available at runtime.

---

## Finding C2 — Unsafe Metadata Cast in Message Format Conversion

- **Severity**: CRITICAL
- **Judge ruling**: REJECTED (not valid)
- **Investigation outcome**: **Reviewer was correct (partially)**

### What the reviewer claimed

The message format conversion in `src/index.ts` uses
`(msg.info as any).metadata || {}` to extract metadata from plugin framework
messages. The `@opencode-ai/plugin` Message type has no `metadata` field in its
type definitions, making this an unsafe cast.

### What the judge said

"Code correctly maps output.messages to WithParts format with proper fallbacks.
Tests pass, indicating format conversion works."

### Investigation findings

1. **The type gap is real.** The `@opencode-ai/plugin` Message type
   (`UserMessage | AssistantMessage`) does NOT include a `metadata` field in its
   TypeScript definitions. The `as any` cast bypasses type safety entirely.

2. **The `|| {}` fallback prevents crashes but masks failures.** If `metadata`
   is absent at runtime, archives are silently never detected (metadata is
   always `{}`, `getArchive()` always returns null).

3. **Tests do NOT exercise the real conversion path.** Test fixtures
   (`src/test/fixtures.ts`) create `WithParts` objects directly with metadata
   baked in. The actual plugin-framework-to-WithParts mapping in `src/index.ts`
   is never tested.

4. **It's a documented workaround.** The story context explicitly mentions
   `(draft as any).metadata` as a "known temporary type gap until the SDK is
   regenerated." The `metadata` field was added in Phase 1 upstream OpenCode
   changes and exists at runtime — the types just haven't caught up.

### Verdict

The judge was too dismissive. The reviewer correctly identified a real type
safety gap and a test coverage hole. However, the severity is mitigated by the
fact that this is a known, documented workaround and `metadata` does exist at
runtime.

### Recommended actions

- [ ] Add at least one integration test in `src/transform.test.ts` (or a new
  file) that exercises the actual message conversion path in `src/index.ts` —
  pass in messages shaped like the plugin framework's real Message type and
  verify archive detection works end-to-end.
- [ ] Add a code comment at the conversion site in `src/index.ts` explaining
  why the `as any` cast is needed and linking to the upstream type gap.

---

## Finding C3 — Follower Removal Index Corruption

- **Severity**: CRITICAL
- **Judge ruling**: REJECTED (not valid)
- **Investigation outcome**: **Judge was correct**

### What the reviewer claimed

"Follower removal logic corrupted by index shifting — collects removal indices
during anchor processing, but anchor replacement happens first. After anchor
replacement, subsequent rangeEnd lookups use stale indices."

### What the judge said

"Code correctly collects ALL indices first, then removes in reverse order using
`sort((a, b) => b - a)`. No index corruption possible."

### Investigation findings

The reviewer confused two fundamentally different operations:

- **Parts replacement** (`msg.parts = [placeholder]`): Modifies the content
  *inside* a message object. Does NOT change the messages array length or shift
  any indices. The message remains at the same index in the array.

- **Message removal** (`messages.splice(i, 1)`): Removes a message from the
  array, shifting all subsequent indices.

The code's execution order is:
1. Scan for anchors (messages with archive metadata)
2. For each anchor: replace its `parts` array with a placeholder (no array
   length change)
3. For each anchor: find rangeEnd by ID, collect follower indices between
   anchor and rangeEnd
4. After processing ALL anchors: sort collected indices in reverse, splice
   each one

Since step 2 only modifies message *content* (not the array structure), indices
remain valid for steps 3 and 4. No corruption is possible.

### Verdict

No action needed. The code is correct.

---

## Finding H1 — Range Calculation Math.min/max Logic

- **Severity**: HIGH (downgraded to MEDIUM after investigation)
- **Judge ruling**: REJECTED (not valid)
- **Investigation outcome**: **Reviewer was correct, judge was wrong**

### What the reviewer claimed

"Range calculation uses `Math.min/max` assuming rangeEnd could be before anchor.
Story says 'between anchor and rangeEnd' — anchor is always start."

### What the judge said

"Logic is sound: `start = min, end = max` handles cases where rangeEnd comes
before anchor in the array. This is correct bidirectional handling."

### Investigation findings

1. **The disputed code** in `src/transform.ts` (lines ~42-43):
   ```typescript
   const start = Math.min(index, rangeEndIndex)
   const end = Math.max(index, rangeEndIndex)
   ```

2. **Prune tool enforces ordering.** In `src/prune.ts` (line ~44), there is
   explicit validation: `if (fromIndex >= toIndex)` → return error
   `"from_id must precede to_id chronologically"`. This guarantees the anchor
   always precedes rangeEnd in the messages array.

3. **Math.min/max is dead defensive code.** Since the prune tool guarantees
   `anchorIndex < rangeEndIndex`, `Math.min(index, rangeEndIndex)` will ALWAYS
   equal `index`, and `Math.max(index, rangeEndIndex)` will ALWAYS equal
   `rangeEndIndex`.

4. **Story plan supports the reviewer.** The story says "between anchor and
   rangeEnd" implying a directional relationship, not bidirectional.

5. **No test coverage** of the out-of-order case (because it cannot happen
   given the prune tool's validation).

### Verdict

The reviewer was correct. The judge incorrectly assumed bidirectional handling
was needed — it isn't, because the prune tool enforces ordering upstream.
The code works correctly but contains unnecessary complexity that obscures the
actual invariant (anchor always precedes rangeEnd).

**Severity: MEDIUM** — not a bug, but dead code that could mask future issues
if the ordering constraint were ever removed.

### Recommended actions

- [ ] Replace Math.min/max with direct assignment in `src/transform.ts`:
  ```typescript
  const start = index
  const end = rangeEndIndex
  ```
  This makes the ordering assumption explicit.
- [ ] Optionally add a comment: `// Prune tool guarantees anchor precedes rangeEnd`

---

## Finding H2 — Missing Reverse-Index Splice Comment

- **Severity**: HIGH
- **Judge ruling**: APPROVED (should fix)
- **Status**: ✅ Fixed in commit `b9b1ea5`

**Issue**: The reverse-order splice logic lacked an explanatory comment.

**Resolution**: Added comment: "Remove followers in reverse order to avoid index
shifting during splice."

---

## Summary

| # | Finding | Severity | Judge | Investigation | Action needed |
|----|---------|----------|-------|---------------|---------------|
| C1 | sessionID extraction | CRITICAL | Approved | N/A | ✅ Fixed |
| C2 | Unsafe metadata cast | CRITICAL | Rejected | Reviewer partially correct | Add integration test + code comment |
| C3 | Index corruption | CRITICAL | Rejected | Judge correct | None |
| H1 | Math.min/max range logic | HIGH→MEDIUM | Rejected | Reviewer correct | Replace with direct assignment |
| H2 | Missing splice comment | HIGH | Approved | N/A | ✅ Fixed |

## Instructions for Continuing Agent

1. **Implement C2 recommended actions**: Add an integration test for the message
   conversion path in `src/index.ts` and a code comment at the cast site
   explaining the `as any` workaround.
2. **Implement H1 recommended action**: Replace Math.min/max with direct
   assignment in `src/transform.ts` and add a comment noting the ordering
   invariant.
3. Commit fixes with message `[Story 3] Fix: <description>`.
4. Run `bun test` to verify no regressions.
