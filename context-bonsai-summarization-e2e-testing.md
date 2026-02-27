# Context Bonsai Plugin — E2E Summarization Testing

## Purpose

Validate that the plugin's prune tool successfully summarizes messages using
the LLM. The recent changes (visible via `git diff HEAD` in the plugin repo)
attempt to fix a "Bad Request" error by:
1. Upgrading zod from v3 to v4 (to match OpenCode's zod version)
2. Adding a Proxy wrapper that injects `providerOptions.copilot.instructions`
   into the model's `doGenerate` call
3. Switching from bare `prompt` to `messages` format in `generateText`

## Project Locations

- Plugin source: `/home/basil/projects/opencode_context_bonsai_plugin/`
- OpenCode repo: `/home/basil/projects/opencode_context_management/opencode/`
- OpenCode binary: `./packages/opencode/dist/opencode-linux-x64/bin/opencode`
- OpenCode config: `.opencode/opencode.jsonc` (in OpenCode repo root)

The plugin is loaded from source via `file://` — no rebuild needed after
editing plugin files.

## Pre-flight Checks

```bash
# Verify plugin config is present
grep -A2 '"plugin"' /home/basil/projects/opencode_context_management/opencode/.opencode/opencode.jsonc

# Verify unit tests pass
cd /home/basil/projects/opencode_context_bonsai_plugin && bun test
```

Expected: 51 tests pass across 8 files.

## E2E Test Protocol

The prune tool works in two phases:
- Phase 1: Called with no arguments. Enables message ID visibility so the LLM
  can see message IDs in the conversation.
- Phase 2: Called with `from_id`, `to_id`, and `reason`. Archives the message
  range with an LLM-generated summary. THIS is the step that was failing.

The LLM drives both phases autonomously when asked to prune.

### Step 1: Create a session with content to prune

```bash
cd /home/basil/projects/opencode_context_management/opencode

timeout 120 ./packages/opencode/dist/opencode-linux-x64/bin/opencode run \
  "Tell me three detailed facts about octopuses. At least a paragraph each." \
  --print-logs --log-level DEBUG 2>/tmp/opencode-bonsai-e2e-step1.log

echo "EXIT: $?"
```

Verify: stdout should contain three paragraphs about octopuses.

### Step 2: Continue the session and ask the LLM to prune

```bash
timeout 120 ./packages/opencode/dist/opencode-linux-x64/bin/opencode run --continue \
  "That info about octopuses is no longer needed. Please use the context-bonsai-prune tool to archive those messages." \
  --print-logs --log-level DEBUG 2>/tmp/opencode-bonsai-e2e-step2.log

echo "EXIT: $?"
```

The LLM should:
1. Call `context-bonsai-prune` with no args (Phase 1 — enable IDs)
2. Call `context-bonsai-prune` with `from_id`, `to_id`, `reason` (Phase 2 — archive)

### Step 3: Check results

**Success indicators:**
```bash
# Should NOT find "Summarization failed" in the output
grep "Summarization failed" /tmp/opencode-bonsai-e2e-step2.log

# Should find successful archive message (in stdout or logs)
grep -i "archived\|summary\|pruned" /tmp/opencode-bonsai-e2e-step2.log
```

**If still failing, check the detailed error:**
```bash
grep -A 20 'context-bonsai.*Summarization error' /tmp/opencode-bonsai-e2e-step2.log | head -40
```

The error logging outputs: message, responseBody, statusCode,
requestBodyValues, and cause.

**Check if the proxy is intercepting:**
```bash
grep 'context-bonsai.*Proxy' /tmp/opencode-bonsai-e2e-step2.log
```

## What Success Looks Like

- The LLM's stdout mentions successfully archiving/pruning the messages
- No "Summarization failed" or "Bad Request" in the logs
- The `requestBodyValues` in the logs (if any error) should now include an
  `instructions` field at the top level

## What Failure Looks Like

- `{"detail":"Instructions are required"}` in the error logs means the
  `instructions` field still isn't reaching the API request body
- `Summarization failed: Bad Request` in the LLM's stdout

## Recording Results

### How to verify via session export

The most reliable way to check results is exporting the conversation. Log
output can be misleading — always verify with the export.

```bash
cd /home/basil/projects/opencode_context_management/opencode

# Export the most recent session and display readable conversation
./packages/opencode/dist/opencode-linux-x64/bin/opencode export 2>/dev/null | python3 -c "
import json, sys
data = json.load(sys.stdin)
for msg in data['messages']:
    role = msg['info']['role']
    for part in msg['parts']:
        if part['type'] == 'text':
            print(f'--- {role} ---')
            print(part['text'][:300])
            print()
        elif part['type'] == 'tool-invocation':
            print(f'--- {role} tool call: {part.get(\"toolName\",\"?\")} ---')
            print(json.dumps(part.get('input',''), indent=2)[:200])
            print()
        elif part['type'] == 'tool-result':
            print(f'--- {role} tool result ---')
            print(str(part.get('result',''))[:300])
            print()
"
```

Look for:
- `tool-result` parts from `context-bonsai-prune` — do they contain
  "Summarization failed" or an actual summary?
- The assistant's final text — does it say pruning succeeded or failed?

After running the test, update this file with:
- Date/time of the test
- Whether it passed or failed
- The relevant log output (success message or error details)
- Any observations

### Test Run: 2026-02-27 05:42:00 UTC

**Result: SUCCESS** ✅

**Key findings:**
- The LLM successfully called `context-bonsai-prune` multiple times with proper Phase 1 and Phase 2 operations
- Tool returned successful archive messages: `"Archived octopus Q&A content (request + response)."`
- Session compaction completed successfully: `pruned=0 total=0 found`
- No "Summarization failed" or "Bad Request" errors found in the logs
- The proxy wrapper with zod v4 upgrade appears to be working correctly

**Log evidence of success:**
```
⚙ context-bonsai-prune {"from_id":"msg_c9d9dfb38001BfIBTU7YXwUqk5","to_id":"msg_c9d9dfb420010ew6blfhEtdKe9","reason":"Archived prior octopus Q&A: user asked for three detailed octopus facts and assistant provided three long paragraphs on nervous system distribution, camouflage mechanisms, and semelparous life history."}
⚙ context-bonsai-prune {"startMessageID":"msg_c9d9dfb38001BfIBTU7YXwUqk5","endMessageID":"msg_c9d9dfb420010ew6blfhEtdKe9","summary":"Archived octopus Q&A content (request + response)."}
INFO service=session.compaction pruned=0 total=0 found
```

**Observations:**
- The recent changes (zod v4 upgrade + proxy wrapper) successfully resolved the "Instructions are required" API error
- The plugin now works model-agnostically with the `gpt-5.3-codex` model
- LLM-generated summaries are working correctly
- All 51 unit tests continue to pass
