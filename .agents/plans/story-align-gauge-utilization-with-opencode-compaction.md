# Story: Align Gauge Utilization With OpenCode Compaction

## Goal

Align plugin gauge utilization calculations with OpenCode auto-compaction budget semantics so gauge percentages better reflect when compaction pressure actually occurs.

## User Model

### User Gamut
- Operators relying on gauge text to decide when to prune context manually.
- Maintainers comparing plugin behavior against OpenCode core compaction behavior.
- Contributors debugging token-pressure edge cases across providers with different limit shapes.

### User-Needs Gamut
- Gauge percentages should match the same usable-budget logic OpenCode compaction uses.
- Input-limit models should reserve output headroom before utilization is computed.
- Fallback behavior should be deterministic when token totals or limits are partially missing.

### Ambiguities From User Model
- Whether gauge should mirror compaction semantics exactly or only approximately is resolved for this story: mirror core semantics for usable budget and token counting rules while keeping existing cadence/injection behavior unchanged.

## Context References

- `/home/basil/projects/opencode_context_management/opencode/packages/opencode/src/session/compaction.ts:32` - core overflow token counting and usable-budget logic.
- `/home/basil/projects/opencode_context_management/opencode/packages/opencode/src/provider/transform.ts:729` - `maxOutputTokens` semantics used by compaction.
- `src/gauge.ts:16` - current token capture and total calculation.
- `src/gauge.ts:46` - current model-limit caching (`input || context`).
- `src/gauge.ts:75` - current used/percent calculation before gauge text formatting.
- `src/state.ts:2` - model-limit cache shape (currently single number).
- `src/gauge.test.ts:79` - current tests for model limit preference and gauge percentages.

## Acceptance Criteria

- [ ] Gauge uses compaction-aligned usable budget math:
  - usable = `model.limit.input - reserved` when input limit exists;
  - else usable = `model.limit.context - maxOutputTokens`.
- [ ] Reserved headroom behavior mirrors compaction defaults:
  - reserved = `min(20000, maxOutputTokens)` (config-free plugin equivalent).
- [ ] Plugin defines `maxOutputTokens` consistently with OpenCode compaction path:
  - use `min(model.limit.output, 32000)` when output limit exists;
  - fallback to `32000` when output limit is missing.
- [ ] Token count behavior mirrors compaction semantics exactly:
  - `count = tokens.total || (input + output + cache.read + cache.write)` with missing fields treated as `0`.
- [ ] Gauge percentage uses `used / usable` denominator (not raw input/context limit).
- [ ] Gauge display text denominator is aligned to usable budget (`used / usable`).
- [ ] Usable-budget precedence is explicit and deterministic:
  - if `input` limit exists, use input path only (`input - reserved`), no fallback to context path;
  - if `input` is absent, use context path (`context - maxOutputTokens`).
- [ ] If computed `usable <= 0`, gauge injection is skipped for that turn.
- [ ] Existing cadence and reminder injection behavior remains unchanged.
- [ ] Tests cover input-limit path, context-limit fallback path, and missing-field token fallbacks.
- [ ] Full test suite passes.

## Implementation Tasks

1. Add a small helper in `src/gauge.ts` to compute compaction-aligned token count from message tokens.
2. Add a helper in `src/gauge.ts` to compute usable budget from model limits and max output tokens.
3. Update `handleChatParams` and session cache shape in `src/state.ts` to store sufficient limit data for budget computation (`input`, `context`, resolved `maxOutputTokens`).
4. Apply deterministic chat-params cache policy:
   - if `input` exists: cache `{ input, context, maxOutputTokens }` and use input path;
   - else if `context` exists: cache `{ context, maxOutputTokens }` and use context path;
   - else: clear model-limit cache for the session (insufficient limits).
5. Update gauge percentage computation in `injectGauge` to use usable budget and skip injection when `usable <= 0`.
6. Keep cadence, synthetic part injection, and wording tiers unchanged.
7. Update `src/gauge.test.ts` with explicit cases for:
   - input-limit minus reserved,
   - context-limit minus max-output fallback,
   - token fallback from structured fields when `total` is absent and missing fields default to `0`,
   - `usable <= 0` skip behavior,
   - text denominator using usable budget.
8. Run focused tests and full suite.

## Testing Strategy

- Focused: `bun test src/gauge.test.ts src/state.test.ts`
- Regression: `bun test`

## Validation Commands

- `bun test src/gauge.test.ts src/state.test.ts`
- `bun test`

## Validation Loop Results

- Missing details check: PASS after clarifying plugin `maxOutputTokens` contract and edge-case cache/usable behavior.
- Ambiguity check: PASS after pinning exact token-count operator semantics (`||`), usable-budget precedence, and deterministic chat-params cache policy.
- Iterations run: 3
