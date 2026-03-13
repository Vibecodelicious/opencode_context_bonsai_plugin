# Story: Bundle Introspection Target Discovery

## Goal

Discover real in-bundle symbol/module paths used by stock OpenCode so plugin monkeypatch injection can target callable runtime surfaces instead of unresolved package-style imports.

## Validation Baseline

- Baseline evidence shows current matrix misses stock runtime targets (`/tmp/runtime-discovery-stock.json`).
- Discovery tooling exists and is approved (`scripts/discover-runtime-targets.ts`, `src/discover-runtime-targets.test.ts`).
- This story is capability-driven and introduces no runtime version gate.

## User Model

### User Gamut
- Plugin users on stock OpenCode installs who need prune/retrieve writes to work without custom forks.
- Maintainers debugging bundle/runtime compatibility drift across local and packaged binaries.
- Teams running mixed environments that need deterministic diagnostics and clear go/no-go outcomes.

### User-Needs Gamut
- Evidence-backed target discovery from actual bundle contents/runtime objects.
- Minimal false positives: discovered targets must be callable and contract-compatible.
- Actionable outputs that directly feed next implementation story.
- Explicit failure mode when no safe target exists.

### Ambiguities From User Model
- Bundled runtime may expose symbols only through loader tables/closures, not importable modules.
- Some symbol names may be minified/obfuscated; plan resolves this with multi-method correlation (bundle strings + runtime object inspection + contract probes).

## Context References

- `scripts/discover-runtime-targets.ts` - current probe worker and artifact format.
- `src/discover-runtime-targets.test.ts` - current discovery helper tests.
- `/tmp/runtime-discovery-stock.json` - current stock artifact (all probe entries missing).
- `/tmp/runtime-discovery-local.json` - local artifact showing callable updater entries only.
- `src/runtime-compat.ts` - current injector/diagnostic contracts to preserve.

## Acceptance Criteria

- [ ] Discovery workflow identifies bundle format/mechanism for stock binary and records reproducible extraction/inspection steps.
- [ ] Artifact schema is extended in-place to `schemaVersion: "2"` with in-bundle findings: candidate symbol paths, confidence, and evidence source.
- [ ] Stock runtime candidate outcomes are evidence-complete: each required class (`registry`, `updater`) is either validated or rejected with explicit reason.
- [ ] Candidate list distinguishes: `bundle-symbol`, `runtime-object-path`, and `import-resolvable` sources.
- [ ] Go/no-go decision gate is documented: proceed-to-implementation vs additional discovery required.
- [ ] Existing discovery tests remain passing and new tests cover added parsing/classification logic.

## Locked Decisions

- Artifact strategy: bump to in-place `schemaVersion: "2"` (no companion artifact file).
- Decision gate threshold (stock runtime):
  - `READY_FOR_INJECTION_IMPL` requires at least:
    - one `registry` candidate with `validationState=validated` and `confidence >= 0.8`
    - one `updater` candidate with `validationState=validated` and `confidence >= 0.8`
  - otherwise emit `DISCOVERY_INCOMPLETE` with explicit blocker codes.
- Safe validation policy:
  - wrapper-like registry candidates may be invoked for contract checks (`fromPlugin` style),
  - updater candidates are never invoked directly; validate by callable shape + adapter simulation only.
- Canonical source precedence for dedupe and ranking:
  - `runtime-object-path` > `import-resolvable` > `bundle-symbol`.
- Runtime-object-path discovery scope is bounded and deterministic:
  - targeted roots only: plugin init input object, plugin init client object, tool-execute context object,
  - targeted key families only: `tool`, `registry`, `session`, `message`, `update`, `plugin`,
  - traversal limits: max depth `5`, max visited nodes `2000`, max candidates emitted per class `100`.
- Runtime-object root acquisition mechanism is explicit:
  - add opt-in diagnostics hook in plugin entry (`CONTEXT_BONSAI_DISCOVERY_DUMP=1`),
  - capture and serialize key summaries from:
    - plugin init input object (`contextBonsai` input),
    - plugin init client object (`input.client`),
    - tool-execute context object (inside prune/retrieve execute path),
  - write summaries to deterministic JSON file path provided by `CONTEXT_BONSAI_DISCOVERY_OUT`.
- Schema v2 must include reproducibility fields for bundle inspection:
  - `inspectionCommands` (ordered list of executed commands),
  - `inspectionEnvironment` (cwd/runtime name/runtime binary),
  - `inspectionEvidence` (normalized snippets or file refs used for extracted candidates).
  - `inspectionEvidence` normalized record shape:
    - `{ source: 'command'|'file'|'runtime', ref: string, snippet: string, order: number }`
    - `snippet` max length `240` chars, whitespace-collapsed, stable key ordering.
- Discovery output-to-runtime mapping is explicit:
  - `runtime-object-path` and `bundle-symbol` map to compat source `object-path`,
  - `import-resolvable` maps to compat source `module`.

## Confidence Rubric (Locked)

- Base score by strongest evidence source for a candidate:
  - `runtime-object-path` callable shape match: `0.9`
  - `import-resolvable` callable shape match: `0.8`
  - `bundle-symbol` textual match only: `0.5`
- Additive adjustments:
  - `+0.05` if contract adapter simulation passes
  - `-0.2` if evidence requires fuzzy/minified name inference (detected when no exact token match exists and candidate created from regex/substring heuristic)
  - `-0.1` if only partial path match exists (detected when terminal function token matches but one or more parent namespace tokens are unresolved)
- Clamp final confidence to `[0.0, 1.0]`.
- Gate threshold uses this exact rubric and is deterministic.
- Confidence is computed after dedupe on canonical `logicalTargetKey`, using strongest retained source evidence.
- Multi-source corroboration: add `+0.05` once when at least one lower-precedence source independently confirms same canonical key.

## Implementation Tasks

1. Add bundle introspection research workflow.
   - Determine stock binary packaging style (embedded JS/chunks/snapshot/etc.).
   - Add non-destructive inspection command set and log outputs in artifact.

2. Extend discovery data model.
   - Bump artifact to schema v2 with bundle finding records:
     - `sourceType` (`bundle-symbol|runtime-object-path|import-resolvable`)
     - `logicalTargetKey`
     - `identifier`
     - `evidence`
     - `confidence` (0.0-1.0)
     - `validationState` (`validated|rejected|inconclusive`)
     - `validationReason`
    - Add stable `decisionGate` block with status + blocker codes.
    - Required classes (`registry`, `updater`) must end in terminal state `validated` or `rejected` (not `inconclusive`).
    - If a required class has zero discovered candidates, emit synthetic rejected record:
      - `logicalTargetKey=<class>:none-found`
      - `validationState=rejected`
      - `validationReason=no_candidates_discovered`

3. Implement symbol candidate extraction.
   - Parse inspectable bundle text/metadata for deterministic matcher families:
     - exact identifier strings (`fromPlugin`, `updateMessageAtomic`, `updateMessage`, `patchUpdateMessage`)
     - nearby namespace/object clues (`ToolRegistry`, `Session`, `MessageRoute`)
     - runtime object traversal key hits from init context and tool context.
   - Canonicalize to `logicalTargetKey` and dedupe by locked precedence order.

4. Validate candidates against runtime contracts.
    - Probe candidates for callable shape and contract (`fromPlugin`-like wrapper / updater-like function).
    - Mark required-class candidates as `validated` or `rejected` with reason; `inconclusive` allowed only for non-required auxiliary candidates.

5. Produce decision gate output.
  - Emit explicit recommendation:
    - `READY_FOR_INJECTION_IMPL` when callable stock targets exist.
    - `DISCOVERY_INCOMPLETE` when no safe callable targets are found.
  - Emit deterministic blocker codes from this finite set only:
    - `missing_registry_target`
    - `missing_updater_target`
    - `registry_confidence_below_threshold`
    - `updater_confidence_below_threshold`
    - `registry_rejected`
    - `updater_rejected`
  - Multiple blocker codes may be emitted together, sorted lexicographically.
  - Precedence for emission conditions per class:
    1. `missing_*_target` if no candidate record exists (should only occur before synthetic rejection safeguard)
    2. `*_rejected` if no validated candidate exists and at least one terminal rejected candidate exists
    3. `*_confidence_below_threshold` if validated candidate exists but best confidence < threshold

6. Add tests and docs.
   - Unit tests for new extraction/classification logic.
   - Update discovery docs with repeatable commands and interpretation guidance.

## Testing Strategy

- Run discovery unit tests plus new extraction/classification tests.
- Re-generate stock/local artifacts and verify schema + decision gate output.
- Ensure no regressions in existing runtime-compat tests.

## Validation Commands

- `bun test src/discover-runtime-targets.test.ts`
- `bun test src/runtime-compat.test.ts`
- `bun scripts/discover-runtime-targets.ts --runtime stock --out /tmp/runtime-discovery-stock.json`
- `bun scripts/discover-runtime-targets.ts --runtime local --out /tmp/runtime-discovery-local.json`

## Validation Loop Results

- Missing details check (iteration 1): identified blockers in schema evolution choice, gate measurability, extraction determinism, and safe validation boundaries. Resolved by locking schema v2 in-place, hard gate thresholds, deterministic matcher families, and non-invocation policy for updater probes.
- Ambiguity check (iteration 1): identified unresolved policy choices (artifact strategy and go/no-go threshold). Resolved in-plan with explicit locked decisions and dedupe precedence.
- Missing details check (iteration 2): no blocking gaps after locking required-class terminal states and finite blocker-code taxonomy.
- Ambiguity check (iteration 2): resolved AC/task mismatch around `inconclusive` and confidence computation ordering by adding canonical post-dedupe scoring rules.
- Missing details check (iteration 3): identified blockers for runtime-object-path acquisition mechanics, schema reproducibility fields, zero-candidate terminal handling, and source mapping. Resolved by locking bounded traversal rules, schema v2 inspection fields, synthetic rejected records, and explicit source mapping to compat types.
- Ambiguity check (iteration 3): identified under-specified fuzzy/partial scoring detection and blocker emission semantics. Resolved by adding deterministic detection rules, multi-code emission policy, and class-level precedence.
- Missing details check (iteration 4): identified remaining blocker around runtime-object root acquisition method and evidence normalization shape. Resolved by locking env-flag-based runtime dumps and normalized `inspectionEvidence` record schema.
- Ambiguity check (iteration 4): no unresolved high-impact ambiguity.
- Iterations run: 4
