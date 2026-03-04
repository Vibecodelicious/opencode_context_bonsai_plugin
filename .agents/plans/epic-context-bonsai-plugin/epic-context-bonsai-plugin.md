# Epic: Context Bonsai Plugin

**Goal:** Implement surgical context compaction as a standalone OpenCode plugin
(npm package) that lets the LLM selectively prune and retrieve stale
conversation context, keeping sessions under the context limit without
triggering built-in overflow compaction.

**Depends on:** Phase 1 upstream OpenCode changes (merged): `metadata` on
`MessageV2.Base`, `languageModel`/`updateMessage`/`messages`/`pluginID` on
plugin `ToolContext`.

**Parallel with:** None

**Complexity:** High

## User Model

### User Gamut

- OpenCode power users running multi-hour sessions that approach context limits
- Developers doing complex multi-step work (debugging, refactoring, feature
  implementation) where earlier context becomes stale
- Users on different LLM providers with varying context window sizes (128K–2M)
- Users who switch between projects/repos mid-session
- Users on slow/expensive models who want efficient context usage
- Users who occasionally need to recall earlier pruned context

### User-Needs Gamut

- Transparent pruning: know what was archived, trust that summaries capture the
  meaning, ability to retrieve originals
- Zero disruption: the LLM handles pruning autonomously; user just sees
  notifications
- Reliability: no message corruption, no lost data, graceful handling of edge
  cases (process restart, concurrent sessions)
- Accurate context reporting: understand how full the context window is
- Works across all providers: no provider-specific assumptions in core logic
- No configuration burden: plugin works out of the box

### Ambiguities From User Model

- **Summary quality vs. token cost**: Summarization calls consume tokens/money.
  Users on expensive models may prefer shorter summaries; users on cheap models
  may prefer detailed ones. Resolution: use the session's configured model for
  summarization (no separate model config), keep summary prompts concise.
- **Pruning aggressiveness**: Some users want maximum context preserved; others
  want aggressive pruning. Resolution: defer to the system prompt guidance which
  defines a graduated policy (prune completed work early, escalate with
  utilization). No user-facing knobs per PROJECT.md scope.

## Stories

### Story 1: Project Scaffolding
**Size:** Small
**Description:** Initialize the npm package with build tooling, test framework,
linting, and CI-ready structure. Produces a buildable, testable, empty package.
**Implementation Plan:** `.agents/plans/epic-context-bonsai-plugin/story-context-bonsai-plugin.1-project-scaffolding.md`

### Story 2: Plugin Skeleton and System Prompt
**Size:** Small
**Description:** Export the Plugin factory function, wire all hook registrations
(tool, event, chat.params, messages.transform, system.transform), and implement
system prompt injection with pruning/retrieval behavioral guidance. First
integration milestone: plugin loads in OpenCode and injects guidance.
**Implementation Plan:** `.agents/plans/epic-context-bonsai-plugin/story-context-bonsai-plugin.2-plugin-skeleton-and-system-prompt.md`

### Story 3: Archive Schema and Transform Hook
**Size:** Medium
**Description:** Define the archive metadata Zod schema, implement the message
transform hook (anchor placeholder rendering, follower removal with paired
tool-call integrity, message ID prefixing), and define shared ephemeral state
infrastructure used by tools in later stories. Unit-testable with synthetic
archive metadata.
**Implementation Plan:** `.agents/plans/epic-context-bonsai-plugin/story-context-bonsai-plugin.3-archive-schema-and-transform-hook.md`

### Story 4: Prune Tool
**Size:** Large
**Description:** Implement the two-phase prune tool: phase 1 enables message ID
visibility, phase 2 archives a message range with LLM-generated summary. First
end-to-end demo: LLM prunes content, placeholders appear.
**Implementation Plan:** `.agents/plans/epic-context-bonsai-plugin/story-context-bonsai-plugin.4-prune-tool.md`

### Story 5: Retrieve Tool
**Size:** Small
**Description:** Implement the retrieve tool that restores previously pruned
content by clearing anchor metadata. Includes same-step guard for
prune-then-retrieve in a single response.
**Implementation Plan:** `.agents/plans/epic-context-bonsai-plugin/story-context-bonsai-plugin.5-retrieve-tool.md`

### Story 6: Context Gauges and Token Tracking
**Size:** Medium
**Description:** Implement token utilization tracking (via event and chat.params
hooks) and periodic gauge injection into the conversation via the transform
hook. Enables autonomous pruning behavior driven by context pressure.
**Implementation Plan:** `.agents/plans/epic-context-bonsai-plugin/story-context-bonsai-plugin.6-context-gauges.md`

### Story 7: Severity-Scaled Gauge Compaction Nudges
**Size:** Small
**Description:** Replace bare gauge data readout with severity-scaled messages
that instruct the LLM to compact with progressively stronger urgency. Removes
gauge-based escalation policy from system prompt (single source of truth moves
to the gauge itself).
**Implementation Plan:** `.agents/plans/epic-context-bonsai-plugin/story-context-bonsai-plugin.7-severity-scaled-gauge-nudges.md`

## Dependencies and Integration

- Prerequisites: Phase 1 upstream changes merged into OpenCode
- Story dependency chain: 1 → 2 → 3 → {4, 5, 6} → 7
  - Stories 4, 5, and 6 can be developed in parallel after Story 3
  - Story 5 integration testing benefits from Story 4 (needs archives to retrieve)
  - Story 6 is fully independent of Stories 4 and 5
  - Story 7 depends on Stories 2 and 6 (modifies both system prompt and gauge
    injection)
- Integration points:
  - `@opencode-ai/plugin` package (peerDependency)
  - `ai` SDK v5+ (dependency for `generateText` and `LanguageModelV2` type)
  - OpenCode config: `opencode.json` `plugin` array or `.opencode/plugin/` directory

## Validation Loop Results

### Iteration 1: Missing Details Check

Findings incorporated into story updates:

- **Tool call/result pairing (Story 3)**: OpenCode stores both in the same
  `ToolPart` — no separate result messages. Removed the pairing concern from
  Story 3. Added pending/running tool guard to Story 4's input validation.
- **`ai` SDK version (Story 1)**: Must be `^5.0.0`, not `^4.0.0`. Fixed.
- **Event type narrowing (Story 6)**: Must narrow `event.type` and `role`
  before accessing `tokens`. Added explicit narrowing steps.
- **Summarization filtering (Story 4)**: Changed from "consider" to required.
  `synthetic: true` parts must be filtered before summarization.
- **`compact.txt` reference (Story 2)**: File doesn't exist. Redirected to
  PROJECT_PROPOSAL.md Feature 5.
- **`system.transform` sessionID (Story 2)**: Optional in one call site. Added
  note to handle gracefully.
- **SDK `Message` type (Story 4)**: May lack `metadata` field until
  regenerated. Added explicit note about `(draft as any).metadata` workaround.
- **Shared test fixtures (Stories 3-6)**: Added `src/test/fixtures.ts` to
  Story 3 deliverables.

### Iteration 1: Ambiguity Check

Findings incorporated into story updates:

- **Same-step prune set clearing (Stories 2, 3)**: Clear at top of transform
  hook invocation. Documented in both stories.
- **`pluginID` in transform hooks (Stories 3, 6)**: Use `PLUGIN_ID` module
  constant from `src/constants.ts`. Added to Story 2 and Story 3.
- **`transformMessages()` signature (Story 3)**: In-place mutation, `void`
  return. Documented explicitly.
- **Message ID prefixing (Story 3)**: Prefix first non-synthetic text part.
  Insert synthetic part if none exists. Specified in acceptance criteria.
- **`idVisibility` per-session lookup (Story 3)**: Must use `sessionID` from
  hook input, not a global flag. Added to acceptance criteria.
- **Gauge/transform ordering (Story 6)**: Inject after transform. User messages
  are never followers, so the last user message is stable. Documented.
- **Phase detection partial args (Story 4)**: If one ID provided without the
  other, return actionable error. Added to acceptance criteria.

### Iteration 2

No blocking gaps or unresolved high-impact ambiguity remain. All validator
findings addressed in story updates. Stopping validation loop.

- Iterations run: 2
