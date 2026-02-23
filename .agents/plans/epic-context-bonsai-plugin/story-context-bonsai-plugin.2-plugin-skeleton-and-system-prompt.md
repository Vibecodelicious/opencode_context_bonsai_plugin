# Story: Plugin Skeleton and System Prompt

**Epic:** Context Bonsai Plugin
**Size:** Small
**Dependencies:** Story 1 (Project Scaffolding)

## Story Description

Wire up the Plugin factory function with all hook registrations and implement
system prompt injection. This is the first integration milestone: when loaded by
OpenCode, the plugin registers its hooks and injects behavioral guidance into
the system prompt.

The plugin skeleton establishes the module-level state containers (per-session
caches for token data, model limits, ephemeral flags) and the hook wiring that
later stories will populate with logic.

## User Model

### User Gamut

- OpenCode users who install the plugin and expect it to "just work"
- LLMs that receive the system prompt and need clear guidance on pruning behavior

### User-Needs Gamut

- Plugin loads without errors on any OpenCode version with Phase 1 changes
- System prompt guidance is clear, actionable, and doesn't conflict with
  OpenCode's built-in system prompts
- Guidance covers: when to prune, how to use the tools, how to interpret gauges

### Design Implications

- System prompt text is a critical UX surface — it directly controls LLM pruning
  behavior. Derived from `surgical_compaction` branch's `compact.txt`.
- Capability check at init: if `ctx.updateMessage` or `ctx.languageModel` are
  missing from a tool context at runtime, the tools should return a clear error
  rather than crash.
- The `experimental.chat.system.transform` hook receives `input: { sessionID?:
  string; model: Model }` — `sessionID` is optional because one call site
  (`agent/agent.ts`) omits it. The system prompt handler must not depend on
  `sessionID` being present.

## Acceptance Criteria

- [ ] Plugin factory returns a Hooks object with all hook keys registered
- [ ] `experimental.chat.system.transform` hook appends pruning guidance to
      system prompt array
- [ ] System prompt includes: tool usage instructions, gauge interpretation,
      proactive pruning triggers, gauge-based escalation policy, content detection
      patterns, quality gate, loop/iteration detection, range partitioning guidance
- [ ] `event` hook handler is wired (empty body, populated in Story 6)
- [ ] `chat.params` hook handler is wired (empty body, populated in Story 6)
- [ ] `experimental.chat.messages.transform` hook handler is wired (empty body,
      populated in Stories 3 and 6)
- [ ] Module-level state containers are defined: per-session token cache,
      per-session model limit cache, per-session ID-visibility flag,
      per-session same-step prune tracking set
- [ ] Unit test: Plugin factory returns valid Hooks structure
- [ ] Integration test: system prompt hook appends expected guidance text

## Context References

### Relevant Codebase Files (must read)

- `packages/plugin/src/index.ts` — Hook type definitions, `Plugin` type,
  `PluginInput` type
- `packages/plugin/src/tool.ts` — `tool()` helper, `ToolContext` type
- `packages/plugin/src/example.ts` — Minimal plugin example
- PROJECT_PROPOSAL.md Feature 5 (System Prompt Guidance) — the authoritative
  source for pruning guidance text (the `compact.txt` reference in the proposal
  no longer exists as a separate file)

### New Files to Create

- `src/index.ts` — Plugin factory (extend from Story 1 skeleton)
- `src/state.ts` — Module-level per-session state management
- `src/prompt.ts` — System prompt guidance text
- `src/state.test.ts` — State container tests
- `src/prompt.test.ts` — Prompt content tests

### Relevant Documentation

- PROJECT_PROPOSAL.md Feature 5 (System Prompt Guidance) — full specification
  of the behavioral policy
- PROJECT_PROPOSAL.md "Lifecycle and Ordering Concerns" — process restart
  behavior for ephemeral state

## Implementation Plan

### Phase 1: Constants and State Management

- Create `src/constants.ts` with:
  - `PLUGIN_ID = "opencode-context-bonsai"` — module-level constant matching
    the npm package name. Used everywhere the plugin needs its namespace key.
    Transform and system hooks do NOT receive `pluginID` from the framework
    (only `ToolContext` does), so this constant is the canonical source. Tools
    should use `ctx.pluginID` when available for consistency, but this constant
    is the fallback for non-tool hooks.
- Create `src/state.ts` with per-session state containers:
  - `Map<sessionID, { tokens: TokenData | null }>` — from event hook
  - `Map<sessionID, { modelLimit: number | null }>` — from chat.params hook
  - `Map<sessionID, { idVisibility: boolean }>` — prune phase 1 flag
  - `Map<sessionID, Set<anchorID>>` — same-step prune tracking. Cleared at
    the top of the transform hook invocation (the transform hook fires exactly
    once per turn, making it a reliable per-turn epoch boundary).
  - `Map<sessionID, { turnCount: number }>` — for gauge cadence
- Export getter/setter functions for each state type
- State defaults to safe values (null/false/0) — missing data causes graceful
  degradation, not crashes

### Phase 2: System Prompt

- Create `src/prompt.ts` with the full behavioral guidance text
- Derived from PROJECT_PROPOSAL.md Feature 5, adapted from `compact.txt`
- Must cover:
  - Tool names (`context-bonsai:prune`, `context-bonsai:retrieve`)
  - Two-phase prune flow explanation
  - Proactive pruning triggers (completed tasks, project switches, multiple
    gauges without pruning)
  - Gauge-based escalation policy (<30%, 30-50%, 50-80%, >80%)
  - Content detection patterns (tool outputs, completed discussions, reference
    material)
  - Quality gate (verify learnings are preserved before pruning)
  - Loop/iteration detection and summary requirements
  - Range partitioning guidance (when to split vs. single range)

### Phase 3: Hook Wiring

- Update `src/index.ts` Plugin factory to return Hooks with:
  - `tool`: {} (empty — populated in Stories 4 and 5)
  - `event`: handler that delegates to state update (body in Story 6)
  - `"chat.params"`: handler that caches model.limit.context (body in Story 6)
  - `"experimental.chat.messages.transform"`: handler (body in Stories 3 and 6)
  - `"experimental.chat.system.transform"`: handler that appends prompt guidance

### Phase 4: Tests

- Unit test: Plugin factory returns well-shaped Hooks
- Unit test: system transform hook appends guidance to output.system array
- Unit test: state containers initialize with safe defaults

## Step-by-Step Tasks

1. Create `src/state.ts` with per-session state containers and accessors
2. Create `src/prompt.ts` with system prompt guidance text
3. Update `src/index.ts` to wire all hooks and return complete Hooks object
4. Write tests for state management (`src/state.test.ts`)
5. Write tests for prompt content (`src/prompt.test.ts`)
6. Update entry point test to verify full Hooks structure
7. Run `bun test` and `bun run build`

## Testing Strategy

- Unit tests for state container initialization and per-session isolation
- Unit tests for system prompt hook: verify guidance text is appended to
  output.system array, verify it doesn't clobber existing system entries
- Build verification: plugin compiles and exports correctly

## Validation Commands

- `bun test`
- `bun run build`

## Completion Checklist

- [ ] All acceptance criteria met
- [ ] Validation commands pass
- [ ] User-model ambiguities resolved or escalated
