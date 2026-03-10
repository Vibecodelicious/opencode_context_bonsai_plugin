# Story: Harden Runtime Compatibility Probing

## Goal

Strengthen the plugin runtime compatibility layer so monkeypatch-based message-update injection works across a broader range of stock OpenCode versions and internal API drift, while preserving deterministic behavior and current user-facing error contracts.

## User Model

### User Gamut
- Users on stock OpenCode builds with shifting internal module layouts.
- Teams running mixed OpenCode versions across local and CI environments.
- Plugin maintainers shipping npm versions without pinning to one OpenCode commit.
- Reliability-focused users who need prune/retrieve to fail clearly when unsupported.

### User-Needs Gamut
- Broad compatibility with reasonable internal API variation.
- Stable behavior with deterministic probing and explicit unsupported-runtime messaging.
- Fast diagnosis when monkeypatch target probing fails.
- Minimal ongoing maintenance burden as internals evolve.

### Ambiguities From User Model
- Different OpenCode versions may expose different internal import paths/object layouts for monkeypatch targets; resolve this with ordered structural probing of injector routes.

## Context References

- `src/runtime-compat.ts:68` - current injected updater probe is too narrow.
- `src/index.ts:13` - compat layer is constructed once from plugin init input.
- `src/prune.ts:207` - prune returns exact compat errors.
- `src/retrieve.ts:64` - retrieve returns exact compat errors.
- `src/runtime-compat.test.ts` - existing compatibility matrix tests to extend.
- `README.md:56` - compatibility documentation section.

## Acceptance Criteria

- [ ] Monkeypatch target probing supports multiple candidate internal import/object routes via ordered injectors rather than a single hardcoded route.
- [ ] Probing and injection are deterministic; first successful injector wins and is cached for plugin instance lifetime.
- [ ] Existing exact compatibility error strings remain unchanged:
  - `Compatibility error: unable to load session messages in this runtime.`
  - `Compatibility error: message updates are unsupported in this runtime.`
- [ ] No fallback-on-throw after selected injected updater invocation.
- [ ] Debug diagnostics reveal probe decisions without changing user-facing tool outputs.
- [ ] Tests cover injector selection, absent targets, native passthrough, missing-sessionID preconditions, and throw-path behavior.
- [ ] README documents compatibility strategy, injector families, and troubleshooting cues.

## Compatibility Contract (Locked)

### Injector Interface
- `UpdateInjector` must define:
  - `name: string`
  - `isAvailable(runtime: any): boolean` (construction-time structural check; must never throw)
  - `inject(runtime: any): InjectedUpdater`
- Availability is structural only (import path resolves, required objects/functions exist).
- Injection/invocation errors are propagated unchanged; they are never converted into compatibility fallback.
- If `isAvailable` internally encounters an exception, implementation must catch it, emit `injector_probe_error`, treat injector as unavailable, and continue probing.

### Ordered Injector Registry (v1)
1. Injector using internal `Session.updateMessageAtomic` + tool-context bridge wiring.
2. Injector using internal `Session.updateMessage` wrapped as mutate bridge.
3. Injector using internal message-route client patching if bridge symbol exists.

### Locked Probe Matrix (v1)
- Implementation must define a single ordered `INJECTOR_CANDIDATES` table in code with explicit per-injector entries:
  - `name`
  - `candidatePaths: string[]` (internal import/module/object paths attempted in order)
  - `requiredSymbols: string[]`
  - `injectShape` description
- The table itself is the canonical compatibility surface and must be covered by tests (one test per injector family proving selection when that family is the first available candidate).
- Tests must verify that probe failures on earlier candidate paths do not block later candidates.

Note: these are monkeypatch routes into internals, not assumptions about stock public client update methods.

### Invocation Preconditions (Locked)
- `ctx.sessionID` is call-time data and must not be used by construction-time `isAvailable` checks.
- Injected updater must reject missing/empty `ctx.sessionID` at call-time and surface the exact unsupported-runtime compatibility error.
- When selected injected updater throws, propagate original exception and emit `injector_invoke_error`.

### Deterministic Resolution Rules
- Resolve injector once at compat construction time.
- Evaluate injectors in fixed order above.
- First `isAvailable === true` injector is selected and cached for plugin instance lifetime.
- If no injector is available, injected updater is treated as unavailable.
- No re-probing at call time.
- No fallback-on-throw after a selected injected updater is invoked.

### Error Contract
- Compatibility fallback errors remain exactly:
  - `Compatibility error: unable to load session messages in this runtime.`
  - `Compatibility error: message updates are unsupported in this runtime.`
- These errors are used only when capability is absent.
- For this contract, missing/empty `ctx.sessionID` is treated as capability absent at call time.
- Non-compat exceptions (native updater or selected injected updater invocation failures) propagate unchanged.

### Observability Contract
- Compat constructor accepts optional `onCompatDiagnostic(event)` callback.
- `onCompatDiagnostic` is optional; default behavior is no-op.
- Diagnostic events:
  - `injector_probe` (injector name + available boolean)
  - `injector_probe_error` (injector name + error message)
  - `injector_selected` (injector name)
  - `injector_none_selected`
  - `injector_invoke_error` (injector name + error message)
- Diagnostics must not include message content, summaries, index terms, or tool output payloads.
- Diagnostics must not alter tool result strings.
- Event naming migration rule is locked: diagnostics use only `injector_*` events (no `adapter_*` aliases).

## Implementation Tasks

1. Define injector-based monkeypatch probing contract.
   - Add local `UpdateInjector` abstraction with `name`, `isAvailable`, and `inject`.
   - Implement locked v1 injector registry and `INJECTOR_CANDIDATES` probe matrix.
2. Implement deterministic injector resolution.
   - Resolve injectors in fixed order at compat construction.
   - Cache selected injector metadata for diagnostics.
3. Expand injected updater behavior.
   - Use selected injected updater for tier-2 update path.
   - Preserve native `ctx.updateMessage` as tier-1 path.
4. Add compatibility observability.
   - Implement debug-only diagnostics callback and locked event schema.
   - Ensure no user-facing tool output mutation.
5. Extend and harden tests.
   - Add matrix tests for ordered injector selection and monkeypatch target reachability, including probe-error-then-continue behavior.
   - Add tests for probe exceptions, selected-injector throws with no fallback, and exact error invariants.
   - Add tests for missing `ctx.sessionID` preconditions in injected updater path.
6. Update README compatibility docs.
   - Document injector-family probing and troubleshooting signals.

## Testing Strategy

- Unit tests for injector resolution and invocation contract in runtime-compat tests.
- Regression tests for prune/retrieve exact compat error pass-through.
- Full suite + build verification.

## Validation Commands

- `bun test src/runtime-compat.test.ts src/prune.test.ts src/retrieve.test.ts`
- `bun test`
- `bun run build`

## Validation Loop Results

- Missing details check (iteration 1): identified blocked gaps in injector contract completeness, deterministic probe semantics, diagnostics sink/schema, and test seams; resolved by locking injector interface, ordered registry, one-time resolution rules, error contract, and diagnostics event schema.
- Ambiguity check (iteration 1): identified unresolved ambiguity in injector scope, success criteria, throw-path mapping, and resolution lifetime; resolved by defining explicit v1 injector families, structural availability checks, unchanged exception propagation rules, and construction-time cached selection.
- Missing details check (iteration 2): identified missing concrete probe matrix and diagnostics migration decision; resolved by locking `INJECTOR_CANDIDATES` table requirements and injector-only event naming.
- Ambiguity check (iteration 2): identified unresolved probe-exception behavior under "must never throw" contract; resolved by locking catch->emit->continue semantics for `isAvailable`.
- Ambiguity check (iteration 3): identified conflict between call-time sessionID precondition handling and capability-absent error rule; resolved by explicitly classifying missing/empty `ctx.sessionID` as capability absent at call time.
- Iterations run: 3
