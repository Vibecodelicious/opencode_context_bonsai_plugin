# Story: Severity-Scaled Gauge Compaction Nudges

**Epic:** Context Bonsai Plugin
**Size:** Small
**Dependencies:** Story 2 (system prompt exists), Story 6 (gauge injection exists)

## Story Description

Replace the bare `[CONTEXT GAUGE: X / Y tokens (Z%)]` data readout with
severity-scaled messages that actively instruct the LLM to compact completed
context and continue working. Each severity tier adds progressively stronger
reassurance that compaction is safe and teaches the pre-summary technique.

Simultaneously, remove the gauge-based escalation policy from the system prompt
(`src/prompt.ts`). Threshold-based behavioral instructions now live at the point
of observation (the gauge itself) rather than in a separate system prompt the
LLM may not recall when it encounters a gauge.

## User Model

### User Gamut

- LLM agents (the direct consumer of gauge text — Claude, GPT, etc.)
- Human developers reading conversation history who see gauge artifacts
- Users on small context models (32K) where compaction urgency is higher
- Users on large context models (200K) where low-severity gauges fire often

### User-Needs Gamut

- LLMs need unambiguous instructions embedded at the point of observation, not
  in a separate system prompt they may not recall
- Humans need gauge text to remain scannable — not a wall of text on every
  checkpoint
- Small-context users need aggressive compaction early; large-context users need
  it less urgently at the same percentage
- All users need the LLM to continue working after compaction, not stall
  waiting for approval

### Design Implications

- **Token cost**: Longer gauge messages consume tokens. Keep messages concise
  (1-3 sentences per tier). The cost of ~50-100 tokens per gauge is trivial
  compared to the context savings from a single compaction.
- **Single source of truth**: Gauge text IS the escalation policy. The system
  prompt retains proactive triggers (completed tasks, project switches, multiple
  gauges) and quality guidance (content detection, quality gate), but NOT the
  threshold tiers.
- **`<system-reminder>` wrapper ownership**: `formatGaugeText()` returns the
  COMPLETE string including the `<system-reminder>...</system-reminder>` wrapper.
  `injectGauge()` assigns the return value directly to `gaugePart.text` with no
  additional wrapping. This differs from the reference implementation (which
  wrapped at the callsite) but is simpler for a single-callsite plugin.
  **Do not add the wrapper in both places.**
- **Number formatting**: Use plain integers in the gauge text (e.g.,
  `128000 / 200000`), NOT `toLocaleString()`. Plain integers are parseable,
  test-stable, and consistent with the existing `injectGauge()` behavior.

## Acceptance Criteria

- [ ] New `src/gauge-text.ts` exports `formatGaugeText(tokenCount, contextLimit, percentage)` returning the full gauge string including `<system-reminder>` wrapper
- [ ] Four severity tiers implemented based on percentage:
  - Low (`< 30%`): data readout + compact completed context + continue working
  - Medium (`30-59%`): adds "compaction is not destructive — summary is left behind, original content can be retrieved"
  - High (`60-79%`): adds pre-summary technique ("state what you need to remember in a new message before compacting")
  - Critical (`>= 80%`): adds `— COMPACT NOW` suffix to readout + "failure to compact immediately will lead to significantly degraded performance"
- [ ] All tiers include "continue your work" instruction
- [ ] All tiers include the `[CONTEXT GAUGE: X / Y tokens (Z%)]` prefix for parseability
- [ ] `src/gauge.ts` `injectGauge()` updated to use `formatGaugeText()` instead of inline template
- [ ] `src/prompt.ts` "Gauge-Based Escalation Policy" section (lines 22-26) removed
- [ ] System prompt retains: proactive pruning triggers (including "Multiple
      gauge readings without pruning action" — retained as a backstop for cases
      where the LLM ignored inline gauge instructions), content detection
      patterns, quality gate, loop/iteration detection, range partitioning
- [ ] Unit tests for `formatGaugeText()` covering all four tier boundaries
- [ ] `gauge.test.ts:153` exact `.toBe()` assertion replaced with
      content-based assertions
- [ ] `prompt.test.ts:16` assertion on "Gauge-Based Escalation" updated
- [ ] `bun test` passes
- [ ] `bun run build` succeeds

## Context References

### Relevant Codebase Files (must read)

- `src/gauge.ts:64` — current inline gauge text template:
  `` `<system-reminder>\n[CONTEXT GAUGE: ${used} / ${modelLimit} tokens (${percent}%)]\n</system-reminder>` ``
- `src/gauge.ts:39-76` — `injectGauge()` function that will call `formatGaugeText()`
- `src/prompt.ts:22-26` — "Gauge-Based Escalation Policy" section to remove
- `src/prompt.ts:1-43` — full system prompt (to verify what's kept vs. removed)
- `src/gauge.test.ts:153` — exact `.toBe()` assertion that will break:
  `expect(gaugePart.text).toBe("<system-reminder>\n[CONTEXT GAUGE: 130 / 4000 tokens (3%)]\n</system-reminder>")`
- `src/gauge.test.ts:135` — prefix-only `.toContain("[CONTEXT GAUGE:")` assertion (safe, no change needed)
- `src/prompt.test.ts:16` — assertion that will break:
  `expect(guidance).toContain("Gauge-Based Escalation")`

### New Files to Create

- `src/gauge-text.ts` — `formatGaugeText()` function with severity tiers
- `src/gauge-text.test.ts` — tier boundary tests

### Relevant Documentation

- Reference implementation: `/home/basil/projects/opencode_context_management/opencode_backup/.agents/plans/story-severity-scaled-gauge-compaction-nudges.md`
  — the upstream-native version of this story (adapted here for the plugin
  architecture). Note: the reference puts the `<system-reminder>` wrapper at
  the callsite, not in `formatGaugeText()`. This story deliberately differs —
  the wrapper is inside `formatGaugeText()` for single-callsite simplicity.

## Implementation Plan

### Phase 1: Create `src/gauge-text.ts`

Pure function with zero imports from the plugin's module graph. Takes raw
numbers, returns the complete formatted string including `<system-reminder>`
wrapper.

```typescript
export function formatGaugeText(
  tokenCount: number,
  contextLimit: number,
  percentage: number,
): string
```

Severity tiers at thresholds 30 / 60 / 80:

- **Low (`< 30`):**
  ```
  <system-reminder>
  [CONTEXT GAUGE: X / Y tokens (Z%)] Compact any completed, no-longer-useful context now and then continue your work.
  </system-reminder>
  ```

- **Medium (`30-59`):**
  ```
  <system-reminder>
  [CONTEXT GAUGE: X / Y tokens (Z%)] Compact any completed, no-longer-useful context now and then continue your work. Compaction is not destructive — a summary is left behind and the original content can be retrieved later.
  </system-reminder>
  ```

- **High (`60-79`):**
  ```
  <system-reminder>
  [CONTEXT GAUGE: X / Y tokens (Z%)] Compact any completed, no-longer-useful context now and then continue your work. Compaction is not destructive — a summary is left behind and the original content can be retrieved later. Before compacting, you can preserve key details by stating what you need to remember in a new message (e.g., "I'm going to compact the messages from the previous debugging session, but I need to remember X"). This message persists separately from the compaction summary.
  </system-reminder>
  ```

- **Critical (`>= 80`):**
  ```
  <system-reminder>
  [CONTEXT GAUGE: X / Y tokens (Z%) — COMPACT NOW] Compact any completed, no-longer-useful context now and then continue your work. Compaction is not destructive — a summary is left behind and the original content can be retrieved later. Before compacting, you can preserve key details by stating what you need to remember in a new message (e.g., "I'm going to compact msg_abc through msg_def but I need to remember X"). This message persists separately from the compaction summary. Failure to compact immediately will lead to significantly degraded performance.
  </system-reminder>
  ```

**Number formatting**: Emit raw integers for `tokenCount` and `contextLimit` —
do not use `toLocaleString()`. This matches the existing behavior in
`injectGauge()` and is test-stable.

### Phase 2: Update `src/gauge.ts`

Replace the inline template in `injectGauge()` (line 64):

```typescript
// Before:
const gaugeText = `<system-reminder>\n[CONTEXT GAUGE: ${used} / ${modelLimit} tokens (${percent}%)]\n</system-reminder>`

// After:
import { formatGaugeText } from "./gauge-text"
const gaugeText = formatGaugeText(used, modelLimit, percent)
```

No other changes to `injectGauge()` — the function still finds the last user
message, checks cadence, and appends the part. The `<system-reminder>` wrapper
is now inside `formatGaugeText()`, so `injectGauge()` no longer adds it.

### Phase 3: Update `src/prompt.ts`

Remove the "Gauge-Based Escalation Policy" section (lines 22-26):

```
## Gauge-Based Escalation Policy
- <30%: No action needed
- 30-50%: Consider pruning if natural breakpoint exists
- 50-80%: Actively seek pruning opportunities
- >80%: Aggressively prune to prevent context overflow
```

Keep everything else:
- Two-Phase Prune Flow
- Summary Quality
- Index Terms
- Proactive Pruning Triggers (including "Multiple gauge readings without pruning
  action" — this is a backstop for LLM non-compliance, not a duplicate of the
  inline gauge instructions)
- Content Detection Patterns
- Quality Gate
- Loop/Iteration Detection
- Range Partitioning

After removal, the flow reads: ...Proactive Pruning Triggers → Content
Detection Patterns → Quality Gate...

### Phase 4: Update Existing Tests

**`src/gauge.test.ts:153`** — exact `.toBe()` assertion will break. Replace:

```typescript
// Before:
expect(gaugePart.text).toBe("<system-reminder>\n[CONTEXT GAUGE: 130 / 4000 tokens (3%)]\n</system-reminder>")

// After:
expect(gaugePart.text).toContain("[CONTEXT GAUGE: 130 / 4000 tokens (3%)]")
expect(gaugePart.text).toContain("Compact any completed")
expect(gaugePart.text).toContain("continue your work")
expect(gaugePart.text).toContain("<system-reminder>")
```

This validates the data readout is correct, the Low-tier instruction is present,
and the wrapper exists — without being brittle to exact wording changes.

**`src/prompt.test.ts:16`** — assertion on removed section. Replace:

```typescript
// Before:
expect(guidance).toContain("Gauge-Based Escalation")

// After:
expect(guidance).not.toContain("Gauge-Based Escalation")
expect(guidance).toContain("Proactive Pruning Triggers")
```

This verifies the escalation policy was removed AND that retained sections are
still present.

**`src/gauge.test.ts:135`** — prefix-only `.toContain("[CONTEXT GAUGE:")`
assertion. No change needed.

### Phase 5: Create New Tests

Create `src/gauge-text.test.ts`:
- Boundary values for each tier: 0%, 15%, 29% (low), 30%, 45%, 59% (medium),
  60%, 70%, 79% (high), 80%, 95%, 100% (critical)
- Verify each tier contains expected instruction text
- Verify critical tier contains `— COMPACT NOW`
- Verify all tiers contain "continue your work"
- Verify medium+ tiers contain "not destructive"
- Verify high+ tiers contain "preserve key details"
- Verify all tiers contain `<system-reminder>` wrapper
- Verify all tiers contain `[CONTEXT GAUGE:` prefix
- Verify numbers are plain integers (no commas from locale formatting)

### Phase 6: Validation

- Run `bun test`
- Run `bun run build`
- Review each tier for clarity and conciseness

## Step-by-Step Tasks

1. Create `src/gauge-text.ts` with `formatGaugeText()` and four severity tiers
2. Write `src/gauge-text.test.ts` with tier boundary tests
3. Update `src/gauge.ts:64` to use `formatGaugeText()` instead of inline template
4. Remove "Gauge-Based Escalation Policy" section from `src/prompt.ts`
5. Update `src/gauge.test.ts:153` — replace `.toBe()` with content-based assertions
6. Update `src/prompt.test.ts:16` — replace with `.not.toContain()` + retained section checks
7. Run `bun test` and `bun run build`

## Testing Strategy

- Unit tests for `formatGaugeText()` covering all tier boundaries and
  content assertions
- Existing gauge injection test (line 153) updated from exact match to
  content-based assertions
- Existing prompt test (line 16) updated to verify removal
- Prefix-based assertions (line 135) pass without modification

## Validation Commands

- `bun test`
- `bun run build`

## Validation Loop Results

### Iteration 1: Missing Details Check

Findings incorporated:

- **`gauge.test.ts:153` exact assertion**: Uses `.toBe()` which will break.
  Added explicit replacement assertions in Phase 4 with before/after code.
- **`prompt.test.ts:16` assertion**: Asserts presence of "Gauge-Based
  Escalation" which will break after removal. Added explicit replacement in
  Phase 4 with both negative and positive assertions.
- **Blast radius confirmed**: Only 4 files reference gauge text or escalation
  policy in `src/` — `gauge.ts:64`, `gauge.test.ts:135,153`, `prompt.ts:22-26`,
  `prompt.test.ts:16`. No other files affected.

### Iteration 1: Ambiguity Check

Findings incorporated:

- **`<system-reminder>` wrapper location**: Story explicitly states Path A
  (wrapper inside `formatGaugeText()`). Added to Design Implications with bold
  warning not to double-wrap. Noted divergence from reference implementation.
- **`toLocaleString()` vs plain integers**: Explicitly prohibited. Added to
  Design Implications and Phase 1. Consistent with existing `injectGauge()`
  behavior.
- **"Multiple gauges without action" trigger retention**: Retained as backstop
  for LLM non-compliance. Added rationale to Phase 3 and acceptance criteria.
- **Tier threshold justification**: Thresholds 30/60/80 are not derived from
  any existing constant in this plugin (unlike the reference implementation
  which had `CONTEXT_GAUGE_THRESHOLDS`). Stated flatly without citing
  non-existent constants.
- **Dependency satisfaction**: Stories 2 and 6 are both complete — `src/prompt.ts`
  and `src/gauge.ts` exist in the working tree. Dependencies are sequencing
  guards, satisfied in the current codebase state.

### Iteration 2: Missing Details Check (sub-agent)

Sub-agent confirmed:
- Phase 4 test replacement assertions are correct (130 tokens / 4000 limit =
  3% → Low tier, all four `.toContain()` assertions match)
- No other breaking tests found beyond the two identified in iteration 1
- `formatGaugeText()` return format (`\n`-delimited wrapper) is consistent
  with existing `gauge.ts:64` template
- Minor: `prompt.test.ts` replacement had a duplicate `"Quality Gate"`
  assertion (already at line 17) — removed

Result: **No blocking gaps found.**

### Iteration 2: Ambiguity Check (sub-agent)

Sub-agent confirmed:
- `formatGaugeText()` return value is fully specified — verbatim text for all
  four tiers, wrapper structure matches existing `\n`-delimited pattern
- Tier boundaries are unambiguous — 30% is Medium, 60% is High, 80% is
  Critical. AC and Phase 1 use consistent notation, test cases include all
  boundary values
- Newline structure is unambiguous — single `\n` after open tag and before
  close tag, matching existing behavior
- No other high-impact ambiguities: `id` generation, `percent` rounding,
  em dash, `synthetic: true`, and `prompt.ts` removal range all explicit

Result: **No unresolved high-impact ambiguity.**

- Iterations run: 2
