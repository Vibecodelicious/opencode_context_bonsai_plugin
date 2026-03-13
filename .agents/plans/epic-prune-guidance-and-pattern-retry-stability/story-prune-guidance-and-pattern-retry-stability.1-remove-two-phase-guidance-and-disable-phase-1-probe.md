# Story: Remove Two-Phase Guidance and Disable Phase-1 Probe

**Epic:** Prune Guidance and Pattern Retry Stability
**Size:** Small
**Dependencies:** None

## Story Description

The prune flow migrated to pattern selectors, but model-visible instructions and no-arg prune behavior still imply a two-phase process. This story removes that mismatch by updating guidance and disabling the no-arg phase-1 probe path. The runtime must reject unsupported/legacy invocation paths with clear, deterministic error text.

## User Model

### User Gamut
- Model-driven users who depend on system prompt guidance for correct tool usage.
- Engineers running automated prune workflows where no-arg probe calls should never be part of normal flow.
- New contributors reading tests as executable behavior documentation.

### User-Needs Gamut
- Documentation and behavior must be aligned to avoid self-induced tool-call failures.
- Unsupported invocation paths should fail fast with clear remediation.
- Migration away from ID-based phase flow should be explicit and test-protected.

### Design Implications
- Remove or hard-disable behavior paths that advertise legacy mode.
- Preserve required `summary` and `index_terms` contract for real prune calls.
- Ensure tests assert new contract so future prompt/behavior drift is caught.

## Acceptance Criteria

- [ ] `src/prompt.ts` no longer instructs a phase-1 no-arg call as part of the prune flow.
- [ ] `src/prune.ts` tool description and argument descriptions no longer describe phase-1/two-phase behavior.
- [ ] `context-bonsai-prune` no-arg calls do not enable ID visibility and instead return a deterministic validation/help error.
- [ ] ID-mode invocation (`from_id` / `to_id`) is explicitly unsupported (or removed from accepted selector modes) with deterministic error behavior.
- [ ] Mixed selector payloads that include any ID selector (`from_id` or `to_id`) deterministically return the ID-unsupported error (ID rejection precedence over mixed-mode wording).
- [ ] Existing pattern-mode success behavior remains intact.
- [ ] `README.md` prune usage section is updated to pattern-only flow and does not reference phase-1/ID-mode usage.
- [ ] Tests are updated to assert the new pattern-only invocation contract and the disabled phase-1 behavior.

## Context References

### Relevant Codebase Files (must read)
- `src/prompt.ts:6` - current two-phase guidance text that still instructs phase-1 call.
- `src/prompt.test.ts:11` - key guidance assertions that currently validate two-phase framing.
- `src/prune.ts:131` - current phase detection and no-arg branch behavior.
- `src/prune.ts:147` - selector-mode validation currently still mentions ID mode.
- `src/prune.ts:107` - tool metadata/description text still advertises phase-based behavior.
- `src/prune.test.ts:15` - tests that currently expect phase-1 ID visibility behavior.
- `src/prune.test.ts:28` - tests that currently expect ID-mode partial validation behavior.

### New Files to Create
- None.

### Relevant Documentation
- `.llm-conductor/planning_guidance.md:144` - planning process and implementation-readiness expectations.
- `.llm-conductor/planning_guidance.md:212` - mandatory post-plan validation loop requirements.
- `README.md:23` - current prune call guidance that still references phase-1 + IDs.

## Implementation Plan

### Phase 1: Foundation
- Define and document the new prune invocation contract: pattern selectors only, no phase-1 probe.
- Pin exact error strings for no-arg and legacy-ID invocations to keep behavior deterministic:
  - no-arg: `Phase 2 requires from_pattern and to_pattern (pattern-only mode).`
  - ID args present: `ID selectors are no longer supported; use from_pattern and to_pattern.`

### Phase 2: Core Implementation
- Update prompt guidance to single-phase pattern flow.
- Update README prune usage guidance to single-phase pattern flow.
- Update prune tool metadata text (description and arg help) to match pattern-only contract.
- Update prune execution input validation to reject no-arg and ID-mode calls.
- Apply deterministic validation precedence: if any ID selector is present, return ID-unsupported error before any mixed/partial pattern checks.

### Phase 3: Integration
- Align prune success and failure response text to avoid contradictory guidance.
- Ensure no state mutation (`setIdVisibility`) occurs on no-arg calls.

### Phase 4: Testing and Validation
- Update prompt and prune tests to reflect pattern-only contract.
- Add/adjust tests that directly verify no-arg calls do not flip ID-visibility state.
- Add explicit tests for no-arg rejection and legacy-ID rejection paths.

## Step-by-Step Tasks

1. Replace two-phase wording in `src/prompt.ts` with pattern-only instructions.
2. Update `src/prompt.test.ts` assertions to enforce pattern-only guidance.
3. Update prune usage documentation in `README.md` to match pattern-only flow.
4. Update prune tool metadata text in `src/prune.ts` to remove phase wording.
5. Adjust prune input-phase validation in `src/prune.ts` so no-arg calls return deterministic error/help response instead of toggling ID visibility.
6. Disable ID-mode path in `src/prune.ts` validation and responses, with precedence rule: any ID selector present returns ID-unsupported error.
7. Update `src/prune.test.ts` to remove obsolete phase-1/ID-mode expectations and add replacement contract tests, including ID-visibility state non-mutation and mixed-selector precedence.
8. Run focused and full tests.

## Testing Strategy

- Unit coverage in `src/prompt.test.ts` for guidance text contract.
- Behavior coverage in `src/prune.test.ts` for no-arg and ID-mode rejection plus pattern-mode success path.
- Full suite run to catch interaction regressions.

## Validation Commands

- `bun test src/prompt.test.ts src/prune.test.ts`
- `bun test`
- `bun run build`

## Completion Checklist

- [ ] All acceptance criteria met
- [ ] Validation commands pass
- [ ] User-model ambiguities resolved or escalated
