# opencode-context-bonsai

OpenCode Context Bonsai plugin. OpenCode is the reference implementation for Context Bonsai behavior.

For the shared explanation of Context Bonsai, see the main project README: https://github.com/Vibecodelicious/context-bonsai-agents

## Installation

Install the package where OpenCode can load plugins:

```sh
npm install opencode-context-bonsai
```

Then configure OpenCode to load the `opencode-context-bonsai` plugin package according to your OpenCode plugin configuration.

The package exports an OpenCode plugin factory as its default export and as `contextBonsai`.

## Usage

Once loaded, the plugin registers two model-facing tools:

- `context-bonsai-prune`
- `context-bonsai-retrieve`

The model decides when to use those tools based on the injected guidance and context-pressure reminders. Pruned ranges are hidden from active model context and replaced with placeholders. Retrieval restores archived ranges by clearing the archive metadata on the anchor message.

## How This Is Implemented For OpenCode

The plugin uses OpenCode hooks to register tools, append model guidance, observe token usage, inject gauge reminders, and transform messages before they are sent to the model.

Archive state is stored in OpenCode message metadata under the canonical key `opencode-context-bonsai`. The original message content remains in OpenCode storage.

Runtime compatibility is checked before reading or updating messages. Unsupported runtimes return explicit compatibility errors rather than silently doing nothing.

## Requirements

- OpenCode with plugin support
- Bun for local development and builds
- `@opencode-ai/plugin`

## Development

See [DEVELOPMENT.md](DEVELOPMENT.md).

```sh
bun install
bun test
bun run build
```
