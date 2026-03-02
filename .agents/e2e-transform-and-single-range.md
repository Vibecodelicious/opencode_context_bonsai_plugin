# Context Bonsai Plugin — E2E: Transform Hook & Single-Message Range

## Purpose

Validate two bugs found in `/tmp/failed_compaction.json`:
1. Single-message prune ranges are rejected (`from_id === to_id`)
2. The transform hook doesn't hide pruned content from the LLM

## Project Locations

- Plugin source: `/home/basil/projects/opencode_context_bonsai_plugin/`
- OpenCode repo: `/home/basil/projects/opencode_context_management/opencode/`
- OpenCode binary: `./packages/opencode/dist/opencode-linux-x64/bin/opencode`
- OpenCode config: `.opencode/opencode.jsonc` (in OpenCode repo root)

The plugin is loaded from source via `file://` — no rebuild needed after editing plugin files.

## Pre-flight Checks

```bash
# Verify plugin config is present
grep -A2 '"plugin"' /home/basil/projects/opencode_context_management/opencode/.opencode/opencode.jsonc

# Verify unit tests pass
cd /home/basil/projects/opencode_context_bonsai_plugin && bun test
```

Expected: All tests pass.

## E2E Test Protocol

### Step 1: Create a session with a known marker word

```bash
cd /home/basil/projects/opencode_context_management/opencode

timeout 120 ./packages/opencode/dist/opencode-linux-x64/bin/opencode run \
  "I'm going to tell you a secret code word. Do not say it back unless I explicitly ask 'what is the code word'. The code word is: flamingo. Just acknowledge that you've noted it." \
  --print-logs --log-level DEBUG 2>/tmp/opencode-bonsai-e2e-transform-step1.log

echo "EXIT: $?"
```

Verify: The assistant acknowledges without repeating "flamingo".

### Step 2: Ask the LLM to prune just that one message

This tests both bugs: single-message range (bug 1) and whether the content
is hidden after pruning (bug 2).

```bash
timeout 120 ./packages/opencode/dist/opencode-linux-x64/bin/opencode run --continue \
  "Use context-bonsai-prune to archive the message where I told you the code word. Only that single message needs to be pruned — not your response." \
  --print-logs --log-level DEBUG 2>/tmp/opencode-bonsai-e2e-transform-step2.log

echo "EXIT: $?"
```

Expected behavior:
- Phase 1: LLM calls prune with no args (enable ID visibility)
- Phase 2: LLM calls prune with `from_id === to_id` targeting the user message
- **Bug 1 check**: If single-message range is still broken, the tool returns
  "from_id must precede to_id chronologically" and the LLM may expand the
  range or give up
- **If bug 1 is fixed**: Tool should return success for the single-message range

### Step 3: Ask the LLM to recall the code word

```bash
timeout 120 ./packages/opencode/dist/opencode-linux-x64/bin/opencode run --continue \
  "What is the code word?" \
  --print-logs --log-level DEBUG 2>/tmp/opencode-bonsai-e2e-transform-step3.log

echo "EXIT: $?"
```

Expected behavior:
- **If transform works**: The LLM should NOT know the code word. It should
  say it doesn't have that information or reference the pruned summary.
- **If transform is broken (current state)**: The LLM will say "flamingo".

### Step 4: Check results

**Bug 1 — single-message range:**
```bash
# Check if the single-message prune was rejected
grep "must precede" /tmp/opencode-bonsai-e2e-transform-step2.log
```
If this matches, bug 1 is still present.

**Bug 2 — content leak:**
```bash
# Check if the LLM revealed the code word
grep -i "flamingo" /tmp/opencode-bonsai-e2e-transform-step3.log
```
If this matches in the assistant's response, bug 2 is still present.

**Check for errors:**
```bash
grep -i "error\|failed\|exception" /tmp/opencode-bonsai-e2e-transform-step2.log | grep -i "context-bonsai"
```

## Recording Results

### How to verify via session export

```bash
cd /home/basil/projects/opencode_context_management/opencode

./packages/opencode/dist/opencode-linux-x64/bin/opencode export 2>/dev/null | python3 -c "
import json, sys
data = json.load(sys.stdin)
for msg in data['messages']:
    role = msg['info']['role']
    mid = msg['info']['id']
    metadata = msg['info'].get('metadata', {})
    bonsai = metadata.get('opencode-context-bonsai', {})
    for part in msg['parts']:
        if part['type'] == 'text':
            print(f'--- {role} ({mid}) ---')
            if bonsai:
                print(f'[HAS BONSAI METADATA: {json.dumps(bonsai)[:150]}]')
            print(part['text'][:300])
            print()
        elif part['type'] == 'tool':
            tool_name = part.get('tool', '?')
            if 'bonsai' in tool_name:
                print(f'--- {role} tool: {tool_name} ---')
                print(f'Input: {json.dumps(part.get(\"state\",{}).get(\"input\",{}), indent=2)[:300]}')
                print(f'Output: {str(part.get(\"state\",{}).get(\"output\",\"\"))[:300]}')
                print()
"
```

Look for:
- The prune tool's output: did it accept or reject the single-message range?
- The anchor message: does it have bonsai archive metadata?
- The assistant's final response: does it contain "flamingo"?

## What Success Looks Like

- Single-message prune (`from_id === to_id`) is accepted by the tool
- After pruning, the LLM cannot recall "flamingo"
- The export shows archive metadata on the anchor message
- No errors in the bonsai plugin logs

## What Failure Looks Like

- `"from_id must precede to_id chronologically"` → bug 1 still present
- LLM says "flamingo" after pruning → bug 2 still present
- Both can be present simultaneously (as in the original failed session)

---

## Test Runs

(Record results here after each run)


### Test Run 1 - 2026-03-02

**Setup:** Fresh session, secret word "zebra"

**Step 1:** User message with secret word
- Result: ✅ LLM acknowledged without repeating

**Step 2:** Prune the message
- Result: ✅ Single-message prune accepted (Bug 1 fixed)
- Tool output: "Done. The message is now archived."

**Step 3:** Recall test
- User: "What was the secret code?"
- LLM: "That message was archived. I can no longer see its contents - only the summary that you shared a secret code."
- Result: ✅ LLM cannot recall "zebra" (Bug 2 fixed)

**Verification:**
- Both bugs confirmed fixed
- All unit tests pass
- Build succeeds

**Root Cause (Bug 2):**
The transform hook was calling `convertPluginMessages()` which used `.map()` to create a new array. When `transformMessages()` replaced `msg.parts`, it was modifying the copy, not the original `output.messages` that gets sent to the LLM.

**Solution:**
Rewrote the transform hook to operate directly on `output.messages` without creating an intermediate copy.
