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

Two-phase tool for archiving conversation history:

1. **Phase 1** (no arguments): Enables message ID visibility so the LLM can see which messages to prune
2. **Phase 2** (with `from_id`, `to_id`, `reason`): Archives the specified message range with a summary

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
