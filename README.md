# opencode-context-bonsai

Surgical context compaction plugin for OpenCode that enables LLMs to selectively prune and retrieve conversation history, keeping sessions under context limits without triggering built-in overflow compaction.

## Overview

This plugin provides autonomous context management for long-running OpenCode sessions. Instead of losing context when the window fills up, the LLM can archive stale conversation segments with summaries and retrieve them later if needed.

## Features

- **Selective Pruning**: Archive message ranges with LLM-generated summaries and index terms
- **Transparent Retrieval**: Restore previously pruned content when needed
- **Context Gauges**: Real-time token utilization tracking to guide autonomous pruning decisions
- **Zero Configuration**: Works out of the box with sensible defaults
- **Provider Agnostic**: Compatible with all LLM providers (Claude, GPT-4, etc.)

## How It Works

The plugin provides two tools that the LLM can call autonomously:

### `context-bonsai:prune`

Pattern-based tool for archiving conversation history:

- Call with `from_pattern`, `to_pattern`, `summary`, and `index_terms` (optional `reason`)
- The tool resolves both patterns to unique message boundaries, then archives that range

Archived messages are replaced with compact placeholders containing the summary and index terms.

### `context-bonsai:retrieve`

Restores previously pruned content by message ID, bringing the full conversation history back into context.

## Installation

```bash
npm install opencode-context-bonsai
```

Add to your OpenCode configuration:

```json
{
  "plugins": ["opencode-context-bonsai"]
}
```

Or place in `.opencode/plugin/` directory.

## Requirements

- OpenCode with Phase 1 upstream changes (message metadata support)
- `@opencode-ai/plugin` package
- `ai` SDK v5+

## Runtime Compatibility

`opencode-context-bonsai` supports multiple OpenCode runtime capability tiers:

- **Message reads**: uses `ctx.messages` when available; otherwise falls back to `ctx.client.session.messages({ path: { id: ctx.sessionID } })`.
- **Message writes**: uses `ctx.updateMessage` when available; otherwise performs one-time capability probing at plugin initialization and selects the first matching updater adapter in this fixed order:
  1. `client.session.updateMessageAtomic(ctx, id, mutate)`
  2. `client.session.updateMessageAtomic({ ctx, id, mutate })`
  3. `client.session.updateMessageAtomic({ sessionID: ctx.sessionID, messageID: id, mutate })`
  4. `client.session.updateMessage({ ctx, id, mutate })`
  5. `client.session.updateMessage({ sessionID: ctx.sessionID, messageID: id, mutate })`
- **Deterministic behavior**: first available adapter is cached for the plugin instance lifetime. There is no call-time re-probe and no fallback to later adapters if the selected adapter throws.
- **Unsupported runtime behavior**: tools return explicit compatibility errors instead of silently no-oping when required read/write capabilities are unavailable.

Troubleshooting notes:

- If no adapter is available at initialization, prune/retrieve writes return the exact compatibility update error.
- Adapters that require `ctx.sessionID` reject missing or empty session IDs with the same exact compatibility update error.
- Adapter invocation failures are treated as native runtime failures and are propagated unchanged (not rewritten as compatibility errors).
- For debug instrumentation in custom integration tests, `buildRuntimeCompat` accepts `onCompatDiagnostic(event)` events for probe, selection, and invoke failure signals.

Compatibility errors are returned as exact tool output strings:

- `Compatibility error: unable to load session messages in this runtime.`
- `Compatibility error: message updates are unsupported in this runtime.`

## Use Cases

- Multi-hour debugging sessions that approach context limits
- Complex refactoring work where earlier context becomes stale
- Project switching mid-session without losing conversation history
- Efficient context usage on slow or expensive models

## Architecture

The plugin uses OpenCode's hook system:

- **`tool`**: Registers prune and retrieve tools
- **`event`**: Tracks token usage for context gauges
- **`chat.params`**: Monitors model configuration
- **`messages.transform`**: Renders placeholders and removes archived messages
- **`system.transform`**: Injects behavioral guidance into system prompt

## Development

```bash
# Install dependencies
bun install

# Build
bun run build

# Test
bun test
```

## License

MIT
