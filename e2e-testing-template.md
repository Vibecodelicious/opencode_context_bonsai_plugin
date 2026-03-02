# Context Bonsai Plugin — E2E Testing Template

## Purpose

[Describe what functionality you're testing and why. Example: "Validate that the plugin's prune tool correctly archives messages" or "Test that the expand tool retrieves archived content"]

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

[Describe the feature being tested and how it works. Example: "The prune tool works in two phases..." or "The expand tool retrieves archived messages..."]

### Step 1: [First test step description]

```bash
cd /home/basil/projects/opencode_context_management/opencode

timeout 120 ./packages/opencode/dist/opencode-linux-x64/bin/opencode run \
  "[Your test prompt here]" \
  --print-logs --log-level DEBUG 2>/tmp/opencode-bonsai-e2e-step1.log

echo "EXIT: $?"
```

Verify: [What should happen in stdout/logs]

### Step 2: [Second test step description]

```bash
timeout 120 ./packages/opencode/dist/opencode-linux-x64/bin/opencode run --continue \
  "[Your continuation prompt here]" \
  --print-logs --log-level DEBUG 2>/tmp/opencode-bonsai-e2e-step2.log

echo "EXIT: $?"
```

Expected behavior: [What the LLM should do]

### Step 3: Check results

**Success indicators:**
```bash
# Check for success patterns
grep -i "[success pattern]" /tmp/opencode-bonsai-e2e-step2.log

# Check for absence of errors
grep "[error pattern]" /tmp/opencode-bonsai-e2e-step2.log
```

**If failing, check detailed error:**
```bash
grep -A 20 'context-bonsai.*[error keyword]' /tmp/opencode-bonsai-e2e-step2.log | head -40
```

## What Success Looks Like

- [Success criterion 1]
- [Success criterion 2]
- [Success criterion 3]

## What Failure Looks Like

- [Failure pattern 1 and what it means]
- [Failure pattern 2 and what it means]

## Recording Results

### How to verify via session export

The most reliable way to check results is exporting the conversation. Log output can be misleading — always verify with the export.

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
- [What to look for in tool-result parts]
- [What to look for in assistant's final text]
- [Other verification points]

After running the test, update this file with:
- Date/time of the test
- Whether it passed or failed
- The relevant log output (success message or error details)
- Any observations

---

## Test Runs

### Test Run: [Date/Time]

**Result: [SUCCESS/FAILED]** [✅/❌]

**Key findings:**
- [Finding 1]
- [Finding 2]
- [Finding 3]

**Log evidence:**
```
[Paste relevant log excerpts here]
```

**Observations:**
- [Observation 1]
- [Observation 2]
