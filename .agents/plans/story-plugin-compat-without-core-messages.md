# Story: Plugin Compatibility Without Core `messages` Dependency

## Goal

Ship `opencode-context-bonsai` in a form that does not require OpenCode core support for `ToolContext.messages`, while preserving current prune/retrieve behavior and adding a compatibility wrapper path for `updateMessage` when core does not provide it.

## User Model

### User Gamut
- Plugin users on stock OpenCode releases who install from npm and expect tools to work without custom forks.
- Teams running mixed OpenCode versions across laptops/CI containers where runtime capabilities differ.
- Safety-focused users who need deterministic pruning and retrieval behavior across long sessions.
- Maintainers evaluating upstreamability who want minimal coupling and clear compatibility boundaries.

### User-Needs Gamut
- Reliable prune/retrieve behavior regardless of whether `ToolContext.messages` exists.
- Clear, actionable failures when write capability is unavailable in the runtime.
- Minimal behavioral drift from current archive metadata flow.
- Compatibility that is observable and testable across capability tiers.

### Ambiguities From User Model
- Some runtime environments may not expose an internal atomic updater path; this plan resolves that by defining deterministic fallback behavior (explicit tool error) rather than silent degradation.

## Context References

- `src/prune.ts:115` - current message loading depends on `ctx.messages`.
- `src/prune.ts:192` - current archive write depends on `ctx.updateMessage`.
- `src/retrieve.ts:16` - current message loading depends on `ctx.messages`.
- `src/retrieve.ts:56` - current restore write depends on `ctx.updateMessage`.
- `src/index.ts:12` - tool registration currently uses static tool definitions.
- `package.json:5` - package entrypoint and build output constraints.
- `.llm-conductor/planning_guidance.md:212` - mandatory validation loop requirements.

## Acceptance Criteria

- [ ] Prune/retrieve message reads no longer require `ToolContext.messages`; they use a compatibility reader with ordered fallback.
- [ ] Compatibility reader fallback order is deterministic and documented.
- [ ] Write path uses capability probing in deterministic order:
  1. native `ctx.updateMessage`
  2. wrapper-injected updater
  3. explicit, user-visible error describing unsupported runtime.
- [ ] No silent no-op behavior is introduced for archive writes.
- [ ] Existing prune/retrieve semantics remain unchanged when native `ctx.messages` and `ctx.updateMessage` are available.
- [ ] Test suite covers capability matrix permutations for read and write paths.
- [ ] README includes compatibility notes and runtime expectations.

## Compatibility Contract (Locked)

- `RuntimeCompat.loadMessages(ctx): Promise<WithParts[]>` fallback order:
  1. Use `ctx.messages` when present.
  2. Otherwise call `ctx.client.session.messages({ path: { id: ctx.sessionID } })`, then normalize with `response.data ?? response`.
  3. Preserve message order exactly as returned from the client API.
  4. Otherwise use exact error: `Compatibility error: unable to load session messages in this runtime.`
- Message normalization is locked to existing conversion semantics:
  - `id <- msg.info.id`
  - `sessionID <- msg.info.sessionID`
  - `role <- msg.info.role`
  - `parts <- msg.parts`
  - `metadata <- msg.info.metadata ?? {}`
  - `createdAt <- new Date(msg.info.time?.created ?? Date.now())`
- `RuntimeCompat.updateMessage(ctx, id, mutate): Promise<void>` fallback order:
  1. Use native `ctx.updateMessage` when present.
  2. Otherwise use injected updater supplied by plugin initialization wrapper with signature `(ctx, id, mutate) => Promise<void>`.
  3. Injected updater contract is explicit: it must perform atomic write semantics equivalent to core `updateMessageAtomic` (read-modify-write, immutable identity fields, single successful update event).
  4. Otherwise use exact error: `Compatibility error: message updates are unsupported in this runtime.`
- Fallback to the next tier occurs only when capability is absent, not when a present capability throws.
- Compatibility module throws `Error` with exact compatibility strings above; prune/retrieve catch and return those exact strings without extra prefixes.
- Non-compat write/read exceptions are propagated unchanged and are not converted into compatibility fallback.
- Tools must depend only on `RuntimeCompat`; direct `ctx.messages` and direct `ctx.updateMessage` usage are forbidden outside the compatibility module.
- Wrapper behavior is internal to plugin initialization (same package entrypoint), not a separate published entrypoint.
- Wrapper lifecycle is per tool execution context: injected updater receives current `ctx` each invocation to preserve session scoping.
- Injected updater source is internal and explicit: plugin initialization constructs compat via `buildRuntimeCompat({ client: initCtx.client })`; this builder performs runtime capability probing and returns optional injected updater used by `RuntimeCompat.updateMessage` tier 2.

## Implementation Tasks

1. Add a compatibility module for tool runtime capabilities.
   - Define `RuntimeCompat` interface and implementations for `loadMessages` and `updateMessage`.
   - Implement the locked fallback order and exact error strings above.
2. Refactor prune and retrieve tools to use compatibility module.
   - Remove direct access to `ctx.messages` and direct `ctx.updateMessage` calls from tool logic.
3. Convert tool exports to factory form where needed.
   - In plugin initialization, construct compat once and inject it into prune/retrieve tool factories.
   - Keep package entrypoint unchanged (`src/index.ts` -> `dist/index.js`).
   - Use one compatibility builder entrypoint in `src/index.ts` as the single source of injected updater capability.
4. Add internal runtime wrapper behavior.
   - Provide injected updater capability during tool execution when native updater is absent.
   - Do not mutate global prototypes; wrapper scope is per-tool execution context.
   - Injected updater source must be explicit and testable (runtime capability probe + bound function), not inferred from tool context shape.
   - If injected updater path fails, propagate original error; do not silently continue or fall through.
5. Extend tests for capability matrix and wiring.
   - Read path: native messages present vs client fetch fallback.
   - Write path: native updater vs injected updater vs unsupported runtime explicit error.
   - Plugin wiring: initialization provides compat to tool factories and tests prove this path.
6. Update documentation.
   - Add compatibility section describing capability tiers and expected behavior.

## Testing Strategy

- Unit tests for compatibility module fallback order and explicit error surfaces.
- Regression tests for prune/retrieve end-to-end behavior under native capability availability.
- Matrix tests with mocked tool context permutations to validate deterministic behavior.

## Validation Commands

- `bun test src/prune.test.ts src/retrieve.test.ts`
- `bun test`
- `bun run build`

## Validation Loop Results

- Missing details check (iteration 1): identified blocked details for fallback API contract, wrapper injection location, and packaging expectations; resolved by locking `RuntimeCompat` contract, exact error strings, internal wrapper scope, and unchanged entrypoint strategy.
- Ambiguity check (iteration 1): identified unresolved details for concrete client API call, fallback-on-throw behavior, error surfacing format, and updater signature; resolved by locking API call shape, absence-only fallback transitions, exact compat error return behavior, and per-execution updater signature.
- Missing details check (iteration 2): identified missing updater wiring source and response-to-`WithParts` mapping; resolved by locking builder source in plugin initialization and exact field normalization contract.
- Ambiguity check (iteration 2): no unresolved high-impact ambiguity.
- Missing details check (iteration 3): identified unresolved injected-updater write contract; resolved by locking explicit atomic-write contract for tier-2 updater and throw/return behavior boundaries.
- Ambiguity check (iteration 3): identified fallback numbering and error transport ambiguity; resolved by corrected ordered steps and explicit error propagation rules.
- Iterations run: 3
