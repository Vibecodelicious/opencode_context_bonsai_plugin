# Story: Stock OpenCode Internal Injection Repair

## Goal

Repair the runtime compatibility wrapper so `context-bonsai-prune`/`context-bonsai-retrieve` can perform message updates on stock OpenCode installs by resolving real internal module targets, while preserving the existing native `ctx.updateMessage` fallback for modified OpenCode builds.

## Validation Baseline

- This story is validated against the currently reproducible runtime pair:
  - stock install observed in repro: `opencode 1.2.24` (`/home/basil/.opencode/bin/opencode`)
  - modified local dist used for fallback verification: `0.0.0-context_bonsai_plugin-202603042009`
- Implementation remains capability-driven (symbol/module probing), not version-gated.
- No runtime version checks are introduced by this story.
- Scope decision: this story does not expand support commitments beyond capability-based behavior validated on the baseline runtimes above.

## User Model

### User Gamut
- Plugin users on stock OpenCode binaries installed via `~/.opencode/bin/opencode`, expecting prune/retrieve to work without custom forks.
- Teams with mixed environments (local patched OpenCode + CI/containers on stock binaries) that need deterministic behavior across both.
- Maintainers debugging compatibility regressions across OpenCode versions where internal shapes drift.
- Safety-sensitive users who rely on prune/retrieve for context hygiene and need explicit failure semantics over silent no-ops.

### User-Needs Gamut
- Preserve working behavior on modified OpenCode (`ctx.updateMessage` path) while adding stock-runtime compatibility.
- Ensure stock runtime writes use atomic-equivalent message mutation semantics.
- Keep exact compatibility error contracts when both native and injected write capabilities are unavailable.
- Make capability decisions observable with evidence-backed diagnostics so failures can be triaged quickly.

### Ambiguities From User Model
- OpenCode internal module layouts may vary by version; plan resolves this by defining ordered internal-module candidate probes and deterministic selection.
- Some stock versions may still expose no safe writable internals; plan keeps explicit unsupported-runtime behavior in that case.

## Context References

- `src/runtime-compat.ts:112` - injector candidate table currently probes only object paths on plugin init client.
- `src/runtime-compat.ts:199` - compat construction and injector selection lifecycle.
- `src/runtime-compat.ts:74` - update path priority (`ctx.updateMessage` first).
- `src/index.ts:13` - compat initialized once from plugin init input.
- `src/runtime-compat.test.ts:78` - existing injector diagnostics and compatibility matrix tests.
- `packages/opencode/src/tool/registry.ts:79` (OpenCode repo) - modified OpenCode path that provides `ctx.updateMessage`.
- Runtime evidence: `/tmp/sys-shape.log` and `/tmp/local-shape.log` show all current injector targets are `undefined` in both runtimes.
- Runtime evidence: `/tmp/bonsai-local2-step2.log` shows local success via `update_path=ctx.updateMessage`; `/tmp/sys-seq-step2.log` shows stock failure via `update_path=unsupported`.
- `runtime-discovery-artifact-spec.md` - required artifact schema and validation checklist.

## Acceptance Criteria

- [ ] Native fallback remains unchanged: when `ctx.updateMessage` exists, writes use it before any injected path.
- [ ] Injector layer supports internal-module resolution (not only init-client object-path probing).
- [ ] Ordered, deterministic internal probe matrix is documented and implemented with first-success caching per plugin instance.
- [ ] On stock runtime with resolvable internals, prune phase-2 writes complete successfully (no compatibility update error).
- [ ] If no safe write surface is found, tools still return exact `Compatibility error: message updates are unsupported in this runtime.`
- [ ] Diagnostics clearly distinguish source used (`ctx.updateMessage` vs `injectedUpdater` vs `unsupported`) and include injector/source metadata in separate diagnostic fields/events.
- [ ] Tests cover: native fallback success, module-injected success, probe miss fallback, and selected injector throw behavior.

## Compatibility Contract (Locked)

- `RuntimeCompat.updateMessage(ctx, id, mutate)` priority remains:
  1. `ctx.updateMessage` when present.
  2. selected injected updater.
  3. exact error `Compatibility error: message updates are unsupported in this runtime.`
- Fallback between tiers occurs only when capability is absent, not when present capability throws.
- Selected updater invocation failures propagate unchanged (never rewritten as compatibility errors).
- Injector selection remains deterministic and cached once at compat construction.
- Construction-time probe/inject failures must degrade to next candidate with diagnostics; they must not crash plugin initialization.

## Internal Resolver Contract (New)

- Add resolver seam to `buildRuntimeCompat` options:
  - `resolveInternal(specifier: string): Promise<any> | any`
  - default implementation uses runtime-safe dynamic import strategy.
- Probe matrix entries must be explicit tuples of:
  - `module specifier`
  - `export/root path`
  - `call contract adapter` (maps `(ctx,id,mutate)` to target signature)
- Resolver/load errors are recorded as `injector_probe_error` and probing continues.
- Keep existing object-path probes as final compatibility family after module probes.

## Injection Mechanism (Explicit)

- Primary mechanism is tool-context injection, not direct plugin write-path replacement.
- At plugin initialization, attempt to load OpenCode internal tool registry module and locate the plugin wrapper constructor (equivalent to `fromPlugin`).
- Monkeypatch wrapper construction once per process so each plugin tool `execute(args, ctx)` receives:
  - existing `ctx.updateMessage` unchanged when already present;
  - injected `ctx.updateMessage` when absent, backed by resolved internal updater adapter.
- Injected function contract:
  - `ctx.updateMessage(id, mutate) => Promise<void>`
  - internally calls resolved updater with `{ sessionID: ctx.sessionID, messageID: id, mutate }`.
- Safety constraints:
  - no global prototype mutation;
  - idempotent patch (do not patch same wrapper twice);
  - if patch hook cannot be resolved, continue without patch and rely on runtime compat fallback/error.

### Registry patch targets (v1, locked)

- Attempt registry patch points in this order:
  1. module `@opencode-ai/opencode/tool/registry`, export path `PluginToolRegistry.fromPlugin`
  2. module `@opencode-ai/opencode/tool/registry`, export path `fromPlugin`
  3. module `opencode/tool/registry`, export path `PluginToolRegistry.fromPlugin`
  4. module `opencode/tool/registry`, export path `fromPlugin`
- Patch lifecycle is process-global plugin state with explicit `patched` guard and saved original reference.

## Architecture decision (locked)

- Authoritative stock-runtime mechanism is execute-time `ctx.updateMessage` injection via registry wrapper patch.
- RuntimeCompat updater probing remains secondary fallback when registry patch is unavailable.
- Classification tie-breaker:
  - unmarked `ctx.updateMessage` -> native path
  - marker-tagged injected `ctx.updateMessage` -> injected path
  - no context updater -> compat injected-updater probe, else unsupported

### Resolver behavior (locked)

- Loader sequence per specifier: `resolveInternal(specifier)`; if module namespace returned, probe both namespace and `default` export roots.
- Resolver error classes are normalized:
  - `module_not_found`
  - `export_path_missing`
  - `adapter_build_failed`
  - `adapter_invoke_failed`
- Construction-time resolver/adapter failures must emit `injector_probe_error` and continue to next candidate.
- Invocation-time adapter failures must emit `injector_invoke_error` and propagate unchanged.

## Initial Internal Target Matrix (v1, locked)

Module probe candidates are attempted in this order, then object-path probes in existing order:

1. Specifier `@opencode-ai/opencode/session` root path `Session.updateMessageAtomic`
2. Specifier `@opencode-ai/opencode/session/index` root path `Session.updateMessageAtomic`
3. Specifier `opencode/session` root path `Session.updateMessageAtomic`
4. Specifier `opencode/session/index` root path `Session.updateMessageAtomic`
5. Specifier `@opencode-ai/opencode/session` root path `Session.updateMessage`
6. Specifier `@opencode-ai/opencode/session/index` root path `Session.updateMessage`
7. Specifier `opencode/session` root path `Session.updateMessage`
8. Specifier `opencode/session/index` root path `Session.updateMessage`
9. Specifier `@opencode-ai/opencode/message-route` root path `MessageRoute.patchUpdateMessage` with bridge `MessageBridge.createMutateBridge`
10. Specifier `opencode/message-route` root path `MessageRoute.patchUpdateMessage` with bridge `MessageBridge.createMutateBridge`

If all module candidates miss or fail, continue to existing object-path probes (`internals.*` / direct `session.*` / `messageRoute.*`).

## Diagnostic Schema Changes (locked)

- Keep existing events unchanged where possible (`injector_probe`, `injector_probe_error`, `injector_selected`, `injector_none_selected`, `injector_invoke_error`, `update_path`).
- Add `injector_source` event:
  - `{ type: 'injector_source', injector: string, source: 'module' | 'object-path', specifier?: string, exportPath?: string }`
- Add optional field on `update_path` when path is `injectedUpdater`:
  - `{ type: 'update_path', path: 'injectedUpdater', injector?: string, source?: 'module' | 'object-path' }`
- Tests asserting diagnostics must be updated to accept the expanded union while preserving previous event meanings.
- Injected context updater must set non-enumerable marker `__contextBonsaiInjected=true` with `injector` and `source` metadata for diagnostic classification.

## Implementation Tasks

0. Runtime discovery phase (must complete before implementation claims)
   - Implement and run discovery generator for both runtimes to produce JSON artifacts per `runtime-discovery-artifact-spec.md`.
   - Verify matrix rows for registry patch targets and updater targets are evidence-backed callable entries.
   - If discovery does not find required callable targets on stock runtime, story remains `NEEDS REVISION` with blocker report.

1. Define internal-module injection contract.
   - Add resolver abstraction and typed probe descriptor table (module specifier, export path, call adapter).
   - Lock full precedence list: `ctx.updateMessage` (runtime tier) > module probe families > existing object-path families > unsupported.

2. Implement module-aware probe matrix.
   - Implement the locked v1 target matrix above exactly in ordered table form.
   - Add one discovery utility test helper that prints which matrix entries resolve on current runtime, then lock observed outcomes in tests.
   - Resolve candidates safely with explicit error capture (`probe_error`) and continue semantics.
   - Cache selected injector (name + source metadata) at compat construction.

3. Integrate with current runtime compat lifecycle.
   - Preserve `ctx.updateMessage` tier-1 behavior exactly.
   - Use selected module-backed injected updater for tier-2 when native updater absent.
   - Preserve exact unsupported-runtime compatibility error for tier-3.

4. Expand diagnostics for forensic debugging.
   - Keep `update_path` enum stable (`ctx.updateMessage|injectedUpdater|unsupported`).
   - Emit separate probe-source diagnostics with injector name + module specifier + export path + resolution outcome.

5. Add/extend tests.
   - Unit tests for module-probe success/failure ordering and deterministic selection.
   - Runtime compat tests for write-path selection precedence.
   - Regression tests proving local patched OpenCode still uses native fallback path.
   - Construction-time robustness tests (resolver throws, import miss, adapter build failure) proving plugin init still succeeds.

6. Document compatibility behavior.
   - Update README compatibility section with module-based injection strategy, fallback tiers, and troubleshooting commands.

## Testing Strategy

- Unit-first verification in `src/runtime-compat.test.ts` with mocked module resolver seams.
- Tool-level regression tests in prune/retrieve suites for exact error and success semantics.
- E2E checks on both binaries:
  - local dist OpenCode must continue succeeding via native fallback.
  - system-installed OpenCode must succeed via injected internal path when available.

### E2E Completion Gate (mandatory before claiming done)

- A developer completion report is invalid unless it includes successful E2E evidence for both runtimes below.
- Required runtimes:
  1. local dist: `/home/basil/projects/opencode_context_management/opencode/packages/opencode/dist/opencode-linux-x64/bin/opencode`
  2. stock install: `/home/basil/.opencode/bin/opencode`
- Required flow per runtime (same session, with `CONTEXT_BONSAI_COMPAT_DIAGNOSTICS=1`):
  1. run step to create a unique marker message (use unique token to avoid pattern ambiguity)
  2. `context-bonsai-prune` phase 1 (no args)
  3. `context-bonsai-prune` phase 2 with `from_pattern` + `to_pattern` using that unique token
  4. next-turn `context-bonsai-retrieve` using returned anchor id
  5. export session and verify tool-result outputs
- Required proof artifacts in report:
  - exact commands run
  - session IDs
  - pass/fail per runtime
  - key evidence lines with path:line from logs/exports
  - explicit diagnostic path classification:
    - local must show native path (`update_path=ctx.updateMessage`) unless runtime genuinely changes
    - stock must not end on unsupported path for story completion
- Completion rule:
  - If stock runtime shows `Compatibility error: message updates are unsupported in this runtime.` or `update_path=unsupported`, story status must remain `NEEDS REVISION`.

## Validation Commands

- `bun test src/runtime-compat.test.ts src/prune.test.ts src/retrieve.test.ts src/index.test.ts`
- `bun test`
- `bun run scripts/discover-runtime-targets.ts --runtime stock --out /tmp/runtime-discovery-stock.json`
- `bun run scripts/discover-runtime-targets.ts --runtime local --out /tmp/runtime-discovery-local.json`
- `cd /home/basil/projects/opencode_context_management/opencode && CONTEXT_BONSAI_COMPAT_DIAGNOSTICS=1 ./packages/opencode/dist/opencode-linux-x64/bin/opencode run "Please just reply ACKLOCAL." --print-logs --log-level DEBUG`
- `cd /home/basil/projects/opencode_context_management/opencode && CONTEXT_BONSAI_COMPAT_DIAGNOSTICS=1 opencode run "Please just reply ACKSYS." --print-logs --log-level DEBUG`
- `cd /home/basil/projects/opencode_context_management/opencode && CONTEXT_BONSAI_COMPAT_DIAGNOSTICS=1 ./packages/opencode/dist/opencode-linux-x64/bin/opencode run --continue "Use context-bonsai-prune ..." --print-logs --log-level DEBUG`
- `cd /home/basil/projects/opencode_context_management/opencode && CONTEXT_BONSAI_COMPAT_DIAGNOSTICS=1 /home/basil/.opencode/bin/opencode run --continue "Use context-bonsai-prune ..." --print-logs --log-level DEBUG`
- `cd /home/basil/projects/opencode_context_management/opencode && ./packages/opencode/dist/opencode-linux-x64/bin/opencode export <sessionID>`
- `cd /home/basil/projects/opencode_context_management/opencode && /home/basil/.opencode/bin/opencode export <sessionID>`

## Validation Loop Results

- Missing details check (iteration 1): identified blockers: missing concrete module target matrix, missing resolver injection seam, and unspecified diagnostics contract changes. Resolved by adding scope lock, explicit resolver contract, deterministic precedence, and diagnostics schema constraints.
- Ambiguity check (iteration 1): identified ambiguities in module loader approach, probe ordering, throw semantics, and construction-time failure handling; resolved by locking compatibility contract and fallback semantics. Remaining user-dependent ambiguity: target version window beyond stock `1.2.24` is intentionally out of scope for this story.
- Missing details check (iteration 2): identified missing concrete matrix, resolver detail gaps, and diagnostic schema uncertainty. Resolved by adding locked v1 module matrix, resolver error classes, and explicit diagnostic schema additions.
- Ambiguity check (iteration 2): identified under-specified adapter/loader behavior. Resolved by locking namespace/default root probing and construction-vs-invocation failure semantics.
- Missing details check (iteration 3): identified missing registry patch target matrix, patch lifecycle location, and native-vs-injected diagnostic distinction. Resolved by adding locked registry target order, process-global patch-state rule, and marker-based classification contract.
- Ambiguity check (iteration 3): identified dual-mechanism ambiguity; resolved by locking authoritative mechanism (registry patch first, compat updater second) and explicit tie-breaker behavior.
- Iterations run: 3
