# Debugging Journal — [Brief Issue Description]

## Instructions for the LLM

**READ THIS FILE FIRST** before attempting any fix.

After each attempt (code change, test run, investigation), UPDATE this file by
appending to the "What's Been Tried" section with:
- What was attempted and why
- The exact result (error message, log output, or success)
- What was learned

Do NOT repeat approaches already listed below. Build on what's known.

## Goal

[Describe what needs to be fixed or achieved. Be specific about the desired end state.]

## Symptom

[Describe the observable problem. Include error messages, unexpected behavior, or missing functionality.]

## Constraints

[List any requirements or limitations that must be respected:]
- [e.g., Must maintain backward compatibility]
- [e.g., Cannot modify external dependencies]
- [e.g., Must keep existing tests passing]
- [e.g., Performance requirements]

## How to Reproduce / Test

[Provide exact steps to reproduce the issue and verify fixes:]

### Setup
```bash
# Commands to set up the environment
```

### Reproduce the Bug
```bash
# Exact commands that trigger the issue
```

### Verify the Fix
```bash
# Commands to confirm the issue is resolved
```

### Check for Regressions
```bash
# Commands to ensure nothing else broke
```

## Relevant Code Locations

[List key files and their roles:]
- `path/to/file.ts` — [what this file does]
- `path/to/other.ts` — [what this file does]

---

## Current Understanding / Root Cause

[Start with "Unknown" or initial hypothesis. Update this section as investigation reveals more information. Include:]
- What's confirmed vs. suspected
- Key technical details discovered
- API/system behavior observed

## Open Questions

[List what's still unknown. Update as questions get answered:]
1. [Question about system behavior?]
2. [Question about implementation approach?]
3. [Question about root cause?]

## Next Steps

[Based on current understanding, what should be tried next:]
1. [Most promising approach based on learnings]
2. [Alternative if #1 doesn't work]
3. [Investigation needed if both fail]

---

## What's Been Tried

### 1. [Approach Name]
**What was attempted:** [Describe the approach and reasoning]

**Result:** [SUCCESS/FAILED + exact error message or outcome]

**What was learned:**
- [Key insight 1]
- [Key insight 2]
- [Any new questions raised]

### 2. [Next Approach Name]
**What was attempted:** [Describe the approach and reasoning]

**Result:** [SUCCESS/FAILED + exact error message or outcome]

**What was learned:**
- [Key insight 1]
- [Key insight 2]

[Continue numbering for each attempt...]

---

## Notes

[Any additional context, links to documentation, related issues, etc.]
