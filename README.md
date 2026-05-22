# opencode-context-bonsai

OpenCode Context Bonsai plugin. OpenCode is the reference implementation for Context Bonsai behavior.

For the shared explanation of Context Bonsai, see the main project README: https://github.com/Vibecodelicious/context-bonsai-agents

## Installation

### Prerequisites

- [Bun](https://bun.com/install) (version 1.3.13 or newer). On Linux/macOS: `curl -fsSL https://bun.com/install | bash`. On Windows: `powershell -c "irm bun.sh/install.ps1|iex"`. Confirm with `bun --version`. If you have an older Bun, run `bun upgrade`.
- An OpenCode-compatible LLM provider already configured on your machine. This README does not cover provider setup; see OpenCode's own documentation.

### Clone the parent repository

OpenCode Context Bonsai is delivered as a matched pair: an OpenCode fork that carries narrow integration patches, and this plugin. They are tracked as submodules of a coordination repo:

```sh
git clone https://github.com/Vibecodelicious/context-bonsai-agents.git
cd context-bonsai-agents
git submodule update --init opencode opencode_context_bonsai_plugin
```

After this you'll have:

- `opencode/` — the OpenCode fork.
- `opencode_context_bonsai_plugin/` — this plugin.

### Build the OpenCode fork

```sh
cd opencode
bun install
cd packages/opencode
bun run build
```

The build produces a per-platform binary at `opencode/packages/opencode/dist/opencode-<platform>/bin/opencode` (relative to your `context-bonsai-agents` clone). Use the subdirectory matching your machine in the launch step below.

If `bun install` fails on first run with a `node-gyp ENOENT` error from a native-build postinstall, simply re-run it — the second attempt typically completes.

If a later `bun run build` or `bun typecheck` fails with `Failed to resolve entry for package "..."` or `Cannot find module ...` errors for dependencies that should be present, `bun install` produced an incomplete dependency tree. Re-running `bun install` alone may not repair it — remove `node_modules` and reinstall, then rebuild:

```sh
rm -rf node_modules && bun install
```

### Wire the plugin into your OpenCode global config

Add the plugin to your OpenCode global config so it loads regardless of which workspace you start OpenCode in. Edit `~/.config/opencode/opencode.json` (create the file if it doesn't exist) and add a `plugin` entry pointing at the plugin's TypeScript entry:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    "file:///absolute/path/to/context-bonsai-agents/opencode_context_bonsai_plugin/src/index.ts"
  ]
}
```

Replace `/absolute/path/to/...` with the real path on your machine. OpenCode loads the plugin's TypeScript source directly under Bun; no separate plugin build step is required.

If your `opencode.json` already has other `plugin` entries, add the bonsai entry to the existing array.

### Launch the bonsai-integrated OpenCode

The binary you just built lives at a platform-specific path inside the submodule. Define a shell function so you can launch the bonsai-integrated build by name, leaving any existing `opencode` install in place. Example (Linux x64):

```sh
opencode_bonsai() {
  /absolute/path/to/context-bonsai-agents/opencode/packages/opencode/dist/opencode-linux-x64/bin/opencode "$@"
}
```

Replace the path with the correct platform subdirectory for your machine. Available subdirectories at the pinned commit:

- Linux x64: `opencode-linux-x64`
- Linux ARM64: `opencode-linux-arm64`
- macOS Apple Silicon: `opencode-darwin-arm64`
- macOS Intel: `opencode-darwin-x64`
- Windows x64: `opencode-windows-x64`
- Windows ARM64: `opencode-windows-arm64`

(Musl and baseline variants are also present in the `dist/` directory if your platform needs them.)

Add the function to `~/.bashrc`, `~/.zshrc`, or your shell's equivalent so it persists across sessions, then `source` that file or open a new terminal. The name `opencode_bonsai` is just an example — choose any name that does not collide with your existing `opencode`.

If the launched OpenCode offers to update itself, decline (press Esc). Accepting would replace this fork's build with upstream OpenCode and remove the bonsai integration.

### Verify the plugin loaded

Run the function to launch OpenCode and ask the model to list its tools:

```sh
opencode_bonsai
```

In OpenCode, send the prompt:

```
list your tools
```

The model's response should include `context-bonsai-prune` and `context-bonsai-retrieve` among its available tools. If those names are missing, OpenCode did not load the plugin — check that the path in `~/.config/opencode/opencode.json` is absolute, points at the plugin's `src/index.ts`, and uses the `file://` prefix.

## Usage

Once loaded, the plugin registers two model-facing tools:

- `context-bonsai-prune`
- `context-bonsai-retrieve`

The model decides when to use those tools based on the injected guidance and context-pressure reminders. Pruned ranges are hidden from active model context and replaced with placeholders. Retrieval restores archived ranges by clearing the archive metadata on the anchor message.

## How This Is Implemented For OpenCode

The plugin uses OpenCode hooks to register tools, append model guidance, observe token usage, inject context utilization reminders, and transform messages before they are sent to the model.

Archive state is stored in OpenCode message metadata under the canonical key `opencode-context-bonsai`. The original message content remains in OpenCode storage.

Runtime compatibility is checked before reading or updating messages. Unsupported runtimes return explicit compatibility errors rather than silently doing nothing.

## Security Disclosure

- **What the plugin reads.** OpenCode session messages and message metadata for the active conversation, to resolve prune patterns, validate ranges, render placeholders, and clear archive state on retrieval.
- **Where archive state persists on disk.** In OpenCode's stored message metadata under the key `opencode-context-bonsai`. The plugin does not create a separate archive database.
- **What is transmitted to the LLM provider.** Placeholder summaries and index terms remain in active context and can be sent to the model. Archived original messages are removed from provider-bound context until retrieval clears their archive metadata.
- **Network egress.** The plugin does not initiate network calls separately from OpenCode. Model traffic uses OpenCode's provider configuration.

## Uninstall

1. Remove the Context Bonsai plugin entry from `~/.config/opencode/opencode.json`.
2. Stop using the `opencode_bonsai` shell function, or remove it from your shell rc file.
3. Existing OpenCode sessions may still contain `opencode-context-bonsai` metadata. Without the plugin, that metadata is inert.

## Development

See [DEVELOPMENT.md](DEVELOPMENT.md).

```sh
bun install
bun test
bun run build
```
