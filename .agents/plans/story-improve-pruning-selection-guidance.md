# Story: Improve Pruning Selection Guidance

## Goal

Improve instruction surfaces so the model selects safer prune ranges under pressure: preserve governance and active-task context, prefer older completed contiguous blocks, and execute prune in one turn without user-facing deliberation.

As an LLM agent managing long sessions,
I want explicit pruning safeguards and contiguous-block selection guidance,
So that I reduce context usage without removing rules, current goals, or unfinished task instructions.

## User Model

### User Gamut
- Agents operating under strict system/developer rules in long coding sessions.
- Human operators relying on the agent to preserve project intent and process constraints.
- Users on small and large context windows where pruning urgency differs.
- Sessions with layered work (primary task, sub-tasks, side-quests, verification).

### User-Needs Gamut
- Protect instruction-bearing context that governs behavior (operational rules and overarching goals).
- Preserve unresolved task hierarchy context until completion criteria are met.
- Prefer reclaiming stale, completed, low-reuse context first.
- Keep pruning autonomous and low-friction (single-turn internal decision + immediate execution).
- Avoid accidental loss of currently active intent when urgency reminders escalate.

### Ambiguities From User Model
- Drift override threshold is subjective unless constrained. Resolution: define explicit "significant drift" criteria in guidance with deterministic signals and minimum count.
- Recency is usually correlated with relevance but not always. Resolution: default protect recent context, allow documented exceptions for clearly completed/redundant recent blocks.
- Prompt-only safeguards are probabilistic. Resolution: strengthen all instruction surfaces (system prompt, gauge wording, tool metadata) and tests that lock language contract.

## Policy Definitions (Implementation Contract)

- `usable budget`: the same denominator already used by gauge text in `src/gauge.ts` (`getUsableBudget(...)` output shown in `[CONTEXT GAUGE: used / modelLimit]`).
- `significant drift`: true only when 2 of 3 signals are met, where signal (c) means either (1) projected post-prune gauge remains above 60% after pruning all non-protected completed blocks, or (2) reclaimed tokens from those blocks are less than 15% of usable budget while current gauge is above 60%.
- `protected anchors`: operational-rule instructions and overarching session-goal statements. Default keep.
- `unresolved task instructions`: any message defining open parent tasks, pending sub-tasks/side-quests, unmet acceptance criteria, or pending validation/fix loops.
- `contiguous block`: a chronologically adjacent message range that does not cross a protected anchor or unresolved-task marker.
- `candidate tie-break scoring`: prefer higher completion certainty, then lower dependency risk, then older age, then larger estimated reclaim size.
- completion certainty rule: `high` when block includes explicit closure signals (e.g., "done", "fixed", "completed", "resolved", merged/closed test result); otherwise `low`.
- dependency risk rule: `high` when newer unresolved-task messages reference decisions/constraints inside the block; otherwise `low`.
- drift signal (a) comparison rule: compute normalized keyword sets from current objective and prior overarching goal (lowercase, punctuation removed, words length >= 4, exclude stop words). Treat as different only when overlap count is 0 and deliverable noun differs.
- drift signal (b) dependency rule: treat unresolved tasks as dependent when they explicitly reference, quote, or rely on decisions/constraints defined in the protected anchor block.
- drift signal (c) single-turn rule: evaluate projected reclaim using one internal candidate sweep in the same turn over all safe non-protected completed blocks (max possible reclaim in-turn), with no multi-turn probing or user-visible intermediate reporting.

## Context References

- `src/prompt.ts:1` - Primary system guidance content injected each turn.
- `src/gauge.ts:48` - Severity-scaled reminder text that triggers pruning behavior.
- `src/prune.ts:105` - Prune tool description and arg help text seen by the model.
- `src/prompt.test.ts:11` - Guidance contract assertions.
- `src/gauge.test.ts:317` - Gauge wording assertions for pruning behavior.
- `src/prune.test.ts:15` - Guardrails and error-ordering behavior for prune invocation.

## Acceptance Criteria

- [ ] Guidance explicitly protects governance context and overarching session goals from pruning by default.
- [ ] Guidance explicitly protects unresolved task hierarchy context (parent tasks, open sub-tasks, unresolved side-quests, pending validation steps).
- [ ] Guidance defines deterministic protected-context detection rules with examples for governance anchors and unresolved task instructions.
- [ ] Guidance explicitly states "oldest completed contiguous blocks first" as default selection strategy.
- [ ] Guidance defines deterministic tie-break order for candidate blocks: completion certainty, dependency risk, age, then estimated token reclaim.
- [ ] Guidance explicitly states recency protection (newest content is default keep) with narrow exceptions.
- [ ] Guidance defines significant drift as true only when at least 2 of 3 signals are present: (a) current objective differs from earlier overarching goal text using the comparison rule, (b) no unresolved tasks still depend on protected anchor content using the dependency rule, (c) one-turn candidate sweep cannot free enough context from non-protected older completed ranges.
- [ ] Guidance defines "enough context" for drift signal (c) as reclaiming enough to move below 60% gauge utilization, or reclaiming at least 15% of usable budget when currently above 60%.
- [ ] Guidance specifies that governance and overarching-goal anchors remain default keep; pruning them is allowed only under significant drift and only when unresolved tasks do not depend on them.
- [ ] Guidance specifies single-turn internal partition/ranking and immediate prune execution when pruning is chosen.
- [ ] Guidance forbids intermediate user-facing ranking/partition reports before prune.
- [ ] Prompt, gauge, and prune metadata language are aligned using explicit contract text: required phrases and forbidden phrases are asserted in tests.
- [ ] Tests lock the new guidance contract and fail on regression.

## Implementation Tasks

1. Update `src/prompt.ts` with a deterministic pruning decision order:
   - identify protected anchors,
   - identify unresolved task-hierarchy blocks,
   - partition into contiguous candidate blocks,
   - rank safe candidates (old/completed/redundant first) with tie-breaks: completion certainty > dependency risk > age > reclaim size,
   - execute prune immediately in-turn if a safe range exists.
   - Detection contract to encode in guidance text:
     - governance anchor examples: system/developer operational rules, planning/workflow constraints, session-level objective statements.
     - unresolved task examples: messages that define pending tasks, acceptance criteria not yet met, open verification/fix loops.
     - resolved/completed examples: completed investigations, closed side-quests, obsolete logs/large outputs with outcomes captured.
2. Add explicit recency and drift policy text to `src/prompt.ts`:
   - newest context default keep,
   - earliest context usually low relevance except governance/goal anchors,
   - protected-anchor pruning allowed only when 2-of-3 significant-drift signals are met,
   - drift signal (c) uses gauge usable budget thresholds (below-60% target or >=15% reclaim while above 60%).
3. Update `src/gauge.ts` reminder wording so escalating urgency reinforces the same selection hierarchy, rather than only "prune now" pressure.
   - remove/replace wording that suggests adding an intermediate user-facing message before pruning,
   - preserve single-turn internal partition/ranking then immediate prune behavior.
4. Update `src/prune.ts` tool description/arg descriptions to mirror contiguous-range and one-turn execution expectations without adding multi-step UX.
5. Update tests (`src/prompt.test.ts`, `src/gauge.test.ts`, `src/prune.test.ts`) to assert contract phrases and absence of conflicting guidance.
   - required phrases:
     - `oldest completed contiguous blocks first`
     - `protect unresolved task instructions`
     - `single turn`
     - `do not output partitions or rankings`
     - `significant drift requires 2 of 3 signals`
   - forbidden phrases:
     - wording that implies a two-turn flow (`first report candidates`, `then prune`)
     - wording that implies creating an intermediate user message before pruning (`state what you need to remember in a new message before pruning`)
   - assertion strategy: `toContain`/`not.toContain` phrase contracts (not exact full-string equality) to reduce brittleness while preserving behavioral guarantees.

## Testing Strategy

- Contract-focused unit assertions for prompt and gauge language (presence/absence checks).
- Prune tool metadata tests for aligned description text.
- Regression check that no guidance suggests two-turn ranking/reporting workflow.
- Full test run to detect side effects outside text-contract tests.

## Validation Commands

- `bun test src/prompt.test.ts src/gauge.test.ts src/prune.test.ts`
- `bun test`

## Validation Evidence Record

| Command | Baseline Result | Post-Change Result | Delta | Evidence |
|---------|------------------|--------------------|-------|----------|
| `bun test src/prompt.test.ts src/gauge.test.ts src/prune.test.ts` | `Pass (45 pass, 0 fail)` | `Pass (47 pass, 0 fail)` | `Pass -> Pass (stable)` | `Baseline exit code 0; post-change exit code 0; failing identifiers: none in both runs; baseline expect count 102, post-change expect count 130.` |
| `bun test` | `Pass (108 pass, 0 fail)` | `Pass (110 pass, 0 fail)` | `Pass -> Pass (stable)` | `Baseline exit code 0; post-change exit code 0; failing identifiers: none in both runs; baseline expect count 234, post-change expect count 262.` |

## Validation Exception Ledger

| Story | Iteration Scope | Command Set | Reason | Requesting User | Approval Citation | Timestamp | Expiry/Validity |
|-------|------------------|-------------|--------|-----------------|-------------------|-----------|-----------------|
| `improve-pruning-selection-guidance` | `N/A` | `N/A` | `No exceptions requested during planning` | `Basil` | `N/A` | `2026-04-15T00:00:00Z` | `N/A` |

## Validation Loop Results

- Missing details check: `Pass after iteration 2 (no blocking implementation gaps).`
- Ambiguity check: `Resolved with requesting-user decision: use pragmatic heuristic contract (explicit phrase/tie-break guidance), not strict parser-style deterministic rules.`
- Iterations run: `3`

## Decision Log

- 2026-04-15: Requesting user selected pragmatic heuristic contract over strict parser rules for drift/dependency/reclaim behavior encoding.
