# Debugging Journal — Transform Hook Fails to Replace Pruned Message Content

## Instructions for the LLM

**READ THIS FILE FIRST** before attempting any fix.

After each attempt (code change, test run, investigation), UPDATE this file by
appending to the "What's Been Tried" section with:
- What was attempted and why
- The exact result (error message, log output, or success)
- What was learned

Do NOT repeat approaches already listed below. Build on what's known.

## How to Start

If you're a fresh agent with no prior context, follow this sequence:

1. Read this entire file first.
2. Read the source files listed in "Relevant Code Locations" below.
3. Read `/tmp/failed_compaction.json` — the session export showing the failure.
4. **Fix Bug 1** (trivial): In `src/prune.ts`, `validatePruneInput()` uses
   `fromIndex >= toIndex` — change to `fromIndex > toIndex`. Update the
   corresponding test in `src/prune.test.ts`.
5. **Investigate and fix Bug 2**: Trace why `transformMessages()` in
   `src/transform.ts` isn't hiding pruned content from the LLM. The "Open
   Questions" and "Current Understanding" sections below describe what's
   known and where to look. Start with the output mapping in `src/index.ts`.
6. Run `bun test` and `bun run build` to verify no regressions.
7. Run the e2e test in `.agents/e2e-transform-and-single-range.md` to verify
   both fixes work end-to-end.
8. Record results in this file (append to "What's Been Tried") and in the
   e2e test file (append to "Test Runs").

## How to Know You're Done

- `bun test` passes
- `bun run build` passes
- E2e test: single-message prune (`from_id === to_id`) is accepted
- E2e test: LLM cannot recall the pruned content after archiving

## Goal

The transform hook must replace pruned message content with placeholders so
the LLM never sees the original text of archived messages. After a prune,
subsequent turns should only see the summary placeholder — not the original
message parts.

## Symptom

In a real session (`/tmp/failed_compaction.json`), the LLM was able to recall
the exact content of a pruned message ("neutrino") after the prune had
completed. The archive metadata was correctly written to the anchor message
(message 2), but the LLM still saw the original text on the next turn.

The session flow:
- Message 2 (user): "The secret word is neutrino" — becomes the prune anchor
- Message 3 (assistant): acknowledgment — becomes the range end
- Messages 5-7: prune tool calls (phase 1, failed single-message attempt,
  successful range prune of messages 2-3)
- Message 9 (user): "What is the secret word?"
- Message 10 (assistant): "The secret word is `neutrino`." — should not know this

The summary and index terms do NOT contain "neutrino" — the leak is from the
original message content, not the summary.

## Two Known Issues

### Issue 1: Single-message range rejected

`validatePruneInput` uses `fromIndex >= toIndex`, rejecting `from_id === to_id`.
Should be `fromIndex > toIndex`. The LLM's first attempt (message 6) to prune
just message 2 was rejected with "from_id must precede to_id chronologically".

### Issue 2: Transform hook not replacing pruned content

The transform hook in `src/transform.ts` should replace the anchor message's
parts with a placeholder and remove follower messages. Either:
- The transform isn't running
- The transform runs but the output mapping in `src/index.ts` discards the
  transformed parts
- The transform runs but something else overwrites the result

Prompt caching rules out KV cache retention as an explanation: mutating an
early message invalidates the cache from that point forward, forcing full
reprocessing with the new content. If the transform ran correctly, the model
would only see the placeholder.

## Constraints

- Must keep existing tests passing (`bun test`)
- Must build cleanly (`bun run build`)
- Transform must operate in-place on the messages array (current design)
- Must not break prompt caching more than necessary (this is context for the
  future redesign, not this bugfix)

## How to Reproduce / Test

### Setup
```bash
cd /home/basil/projects/opencode_context_bonsai_plugin
```

### Reproduce the Bug
The bug is observable in `/tmp/failed_compaction.json` — a session export
where the LLM recalled pruned content. For live reproduction, use the E2E
test protocol in `context-bonsai-summarization-e2e-testing.md`.

### Verify the Fix
```bash
bun test
```

### Check for Regressions
```bash
bun test && bun run build
```

## Relevant Code Locations

- `src/transform.ts` — `transformMessages()`: replaces anchor parts with
  placeholder, removes followers
- `src/index.ts` — `experimental.chat.messages.transform` hook: calls
  `transformMessages()`, maps results back to `output.messages`
- `src/schema.ts` — `getArchive()` / `hasArchive()`: reads archive metadata
- `src/prune.ts` — `validatePruneInput()`: the `>=` vs `>` bug
- `src/state.ts` — ephemeral per-session state (ID visibility, same-step prunes)
- `src/convert.ts` — `convertPluginMessages()`: converts plugin message format
  to `WithParts`
- `/tmp/failed_compaction.json` — the session export showing the failure

---

## Current Understanding / Root Cause

### Issue 1 (single-message range): Confirmed
`fromIndex >= toIndex` in `validatePruneInput` rejects equal indices. Fix is
changing to `fromIndex > toIndex`.

### Issue 2 (transform not working): Suspected
The transform hook converts `output.messages` to `WithParts[]` via
`convertPluginMessages()`, runs `transformMessages()` which mutates the array
in place, then maps back to `output.messages`. The mapping uses:
```typescript
output.messages = messages.map(msg => ({
  info: {
    ...output.messages.find(m => m.info.id === msg.id)?.info!,
    metadata: msg.metadata
  },
  parts: msg.parts
}))
```

Potential failure points:
- `convertPluginMessages()` may not carry metadata correctly (uses
  `(msg.info as any).metadata || {}`)
- The `output.messages.find()` lookup after splice may fail for removed messages
  (but those are already filtered out since we map over the spliced `messages`)
- The `getArchive()` call in transform may fail to parse the metadata

## Open Questions

1. Does `convertPluginMessages()` correctly transfer the archive metadata from
   the raw plugin message format to `WithParts`?
2. Is the `output.messages` reference the same array the LLM actually receives,
   or does OpenCode snapshot it before the hook runs?
3. Does the hook actually fire on every turn, or only on certain message types?

## Next Steps

1. Add logging/tracing to the transform hook to confirm it fires and processes
   the archive metadata
2. Write a focused test that simulates the exact message sequence from the
   failed session and verifies the transform output
3. Inspect `convertPluginMessages()` to verify metadata passthrough

---

## What's Been Tried

### Attempt 1: Fixed Bug 1 (single-message range validation)
**What:** Changed `fromIndex >= toIndex` to `fromIndex > toIndex` in `src/prune.ts:43`
**Result:** ✅ Success - single-message ranges (`from_id === to_id`) are now accepted
**Test:** Added test case "allows single-message range (from_id === to_id)" - passes

### Attempt 2: Investigated Bug 2 root cause
**What:** Added debug logging to transform hook, ran e2e test, checked session export
**Result:** Discovered that transform hook was running and replacing parts correctly in memory, but the LLM still recalled pruned content. Session export showed original text still stored.
**Learning:** The transform was modifying a copy, not the actual messages sent to the LLM.

### Attempt 3: Tried updating parts in prune tool
**What:** Modified prune tool to call `updateMessage()` and set `draft.parts` to placeholder
**Result:** ❌ Failed - parts weren't persisted. `updateMessage()` appears to only support metadata updates, not parts updates.
**Learning:** The persistence layer doesn't support updating message parts.

### Attempt 4: Identified the copy problem
**What:** Analyzed `convertPluginMessages()` - it uses `.map()` which creates a new array
**Result:** Found the root cause: `transformMessages()` was modifying the converted copy's parts, not `output.messages[i].parts`
**Learning:** The shallow copy preserved the parts reference, but when we assigned `msg.parts = [placeholder]`, we replaced the reference on the copy, not the original.

### Attempt 5: Transform output.messages directly
**What:** Rewrote the transform hook in `src/index.ts` to operate directly on `output.messages` instead of converting to `WithParts[]` first
**Result:** ✅ Success - LLM can no longer recall pruned content
**Test:** E2E test with secret word "zebra" - after pruning, LLM correctly states it cannot see the archived content

---

## Notes

- Session export: `/tmp/failed_compaction.json`
- The plugin ID is `opencode-context-bonsai` (in `src/constants.ts`)
- The metadata key in the export matches: `"opencode-context-bonsai"`
- E2E testing protocol: `context-bonsai-summarization-e2e-testing.md`
- Related diagnosis: `context-bonsai-summarization-diagnosis.md`
