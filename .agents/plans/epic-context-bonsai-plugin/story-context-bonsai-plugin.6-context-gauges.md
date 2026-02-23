# Story: Context Gauges and Token Tracking

**Epic:** Context Bonsai Plugin
**Size:** Medium
**Dependencies:** Story 3 (Archive Schema and Transform Hook)

## Story Description

Implement token utilization tracking and periodic gauge injection. The plugin
subscribes to `message.updated` events to cache token counts and to
`chat.params` to cache model context limits. The transform hook periodically
injects a gauge into the conversation so the LLM sees its own context pressure
and is prompted to prune.

This story completes the autonomous pruning loop: the LLM sees utilization data,
the system prompt (Story 2) tells it when to prune, and the prune tool (Story 4)
lets it act.

## User Model

### User Gamut

- LLMs that need context pressure data to make pruning decisions
- Users who benefit from the LLM proactively managing context before hitting
  the hard limit

### User-Needs Gamut

- Accurate utilization numbers (within one-turn staleness)
- Gauges that don't clutter the conversation (periodic, not every turn)
- Graceful degradation when token data is unavailable (skip gauge, don't crash)
- Works across all providers/models with different context window sizes

### Design Implications

- **Event dispatch timing**: Plugin event handlers are fire-and-forget
  (`plugin/index.ts:132`). The token cache update must use **synchronous
  mutation** — no `await` between reading the event payload and writing to the
  cache. This eliminates races with the transform hook.
- **Gauge staleness**: Token counts come from the previous turn's
  `message.updated` event. The gauge is always one turn behind. This is a known
  limitation, not a bug.
- **Gauge cadence**: Tuning parameter internal to the plugin. Start with a
  simple approach (every N turns, e.g., every 5 turns) and adjust based on
  real-world usage.

## Acceptance Criteria

- [ ] `event` hook: narrows on `event.type === "message.updated"` AND
      `event.properties.info.role === "assistant"` before accessing token data.
      Extracts `event.properties.info.tokens.input`, `.output`, `.cache.read`,
      `.cache.write`. Caches per session via synchronous mutation. Only caches
      from events where `info.tokens.input > 0` (final event, not intermediate
      streaming updates).
- [ ] `chat.params` hook: extracts `model.limit.context` (and `model.limit.input`
      if available), caches per session
- [ ] Transform hook: periodically injects gauge as `<system-reminder>` text
      part on the last user message
- [ ] Gauge format:
      ```
      <system-reminder>
      [CONTEXT GAUGE: {used} / {limit} tokens ({percent}%)]
      </system-reminder>
      ```
- [ ] Gauge injection skipped when: no cached token data for session, or no
      cached model limit
- [ ] Gauge cadence is configurable internally (turn count threshold)
- [ ] Turn counter increments per transform hook invocation, resets on new
      session
- [ ] Gauge accounts for its own injected tokens (~30 tokens) to avoid
      slightly over-reporting available space
- [ ] Unit tests for token data extraction from events
- [ ] Unit tests for gauge injection logic (cadence, skip conditions, format)
- [ ] Unit tests for race-safety of synchronous cache mutation

## Context References

### Relevant Codebase Files (must read)

- `packages/opencode/src/session/message-v2.ts` — `Event.Updated` definition,
  assistant message `tokens` field structure
- `packages/opencode/src/provider/provider.ts` — `Model.limit.context` and
  `Model.limit.input` types
- `packages/plugin/src/index.ts` — `event` hook signature, `chat.params` hook
  signature and input type
- `packages/opencode/src/session/prompt.ts:1234` — `insertReminders()` pattern
  for how synthetic text parts are constructed

### New Files to Create

- `src/gauge.ts` — Gauge injection logic and token tracking
- `src/gauge.test.ts` — Gauge tests

### Relevant Documentation

- PROJECT_PROPOSAL.md Feature 4 (Context Gauges) — full specification including
  event dispatch timing, race strategy, staleness, fallback behavior
- PROJECT_PROPOSAL.md "Lifecycle and Ordering Concerns" — process restart
  impact on ephemeral token caches

## Implementation Plan

### Phase 1: Token Cache

- In `src/gauge.ts`, implement token data extraction:
  - `handleTokenEvent(event)` — receives the raw `Event` union type from the
    `event` hook (`input.event`). Must narrow:
    1. `event.type === "message.updated"` — skip all other event types
    2. `event.properties.info.role === "assistant"` — skip user message events
    3. `event.properties.info.tokens.input > 0` — skip intermediate streaming
       updates (only cache from the final event with actual token counts)
  - Extract `sessionID` from `event.properties.info.sessionID`
  - Write to per-session cache **synchronously** (no `await` between read
    and write) — cache structure:
    `{ input: number, output: number, cacheRead: number, cacheWrite: number }`
  - The gauge shows `input` tokens as the primary utilization metric since
    that's what fills the context window. `input` includes cache reads.
  - Note: `tokens.total` is optional on the internal schema and absent from
    the SDK type — do not rely on it. Compute total from fields.

### Phase 2: Model Limit Cache

- `handleChatParams(sessionID, model)` — extracts and caches `model.limit.context`
  and `model.limit.input` per session
- Use `model.limit.input` if available (more accurate for context pressure),
  fall back to `model.limit.context`

### Phase 3: Gauge Injection

- `injectGauge(messages, sessionID, pluginID)` — called from transform hook:
  - Check if token cache and model limit cache both have data for this session
  - If either is missing: skip (return without modifying messages)
  - Check turn counter against cadence threshold
  - If not time for a gauge: increment counter and return
  - Calculate utilization: `tokenCount / modelLimit * 100`
  - Find the last user message in the array
  - Append a synthetic TextPart with the gauge text wrapped in
    `<system-reminder>` tags
  - Part must have valid `id`, `sessionID`, `messageID`, `type: "text"`,
    `synthetic: true`

### Phase 4: Wire into Plugin Hooks

- Update `src/index.ts`:
  - `event` hook: call `handleTokenEvent()` when event type is
    `message.updated`
  - `chat.params` hook: call `handleChatParams()` with sessionID and model
  - `experimental.chat.messages.transform` hook: call `injectGauge()` after
    `transformMessages()` (archive rendering) runs. This ordering is correct
    because `transformMessages()` may remove follower messages, but user
    messages are never followers (only assistant messages appear between an
    anchor and its rangeEnd). The "last user message" that `injectGauge()`
    targets is stable across transform operations.

### Phase 5: Tests

- Unit test: `handleTokenEvent` correctly extracts and caches token data
- Unit test: `handleTokenEvent` ignores non-assistant events
- Unit test: `handleChatParams` caches model limits correctly
- Unit test: `injectGauge` skips when no cached data
- Unit test: `injectGauge` respects cadence (only injects every N turns)
- Unit test: `injectGauge` produces correctly formatted gauge text
- Unit test: `injectGauge` appends to last user message's parts array
- Unit test: gauge part has valid TextPart shape with `synthetic: true`

## Step-by-Step Tasks

1. Implement `handleTokenEvent()` in `src/gauge.ts`
2. Implement `handleChatParams()` in `src/gauge.ts`
3. Implement `injectGauge()` in `src/gauge.ts`
4. Wire event, chat.params, and transform hooks in `src/index.ts`
5. Write comprehensive gauge tests (`src/gauge.test.ts`)
6. Run `bun test` and `bun run build`

## Testing Strategy

- Unit tests with synthetic event payloads — no OpenCode runtime needed
- Test race safety: verify that cache writes are synchronous (no async gaps
  between read and write)
- Test cadence logic: simulate multiple transform hook calls, verify gauge
  appears at correct intervals
- Test skip conditions: missing token data, missing model limit, first turn

## Validation Commands

- `bun test`
- `bun run build`

## Completion Checklist

- [ ] All acceptance criteria met
- [ ] Validation commands pass
- [ ] User-model ambiguities resolved or escalated
