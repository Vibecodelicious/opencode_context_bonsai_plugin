# Development

This repo contains the OpenCode Context Bonsai plugin. OpenCode is the reference implementation for the shared Context Bonsai behavior.

## Source Of Truth

Shared behavior is defined in the main repo's Context Bonsai spec. Changes to model-visible behavior should be made in the spec first, then implemented here.

## Implementation Notes

- `src/index.ts` exports the plugin factory.
- `src/prune.ts` implements `context-bonsai-prune`.
- `src/retrieve.ts` implements `context-bonsai-retrieve`.
- `src/transform.ts` renders placeholders and removes archived ranges from model context.
- `src/prompt.ts` and `src/gauge.ts` provide model guidance and context-pressure reminders.
- `src/runtime-compat.ts` handles OpenCode runtime capability differences.

Archive state is stored in OpenCode message metadata under the canonical key `opencode-context-bonsai`. Retrieval clears that metadata so the original messages are visible again.

## Commands

```sh
bun install
bun test
bun run build
```

Run commands from this side repo. Live harness validation requires the parent repo layout because the OpenCode fork and this plugin are matched submodules there.

## References

- Main project README: https://github.com/Vibecodelicious/context-bonsai-agents
- Shared spec: https://github.com/Vibecodelicious/context-bonsai-agents/blob/main/docs/context-bonsai-agent-spec.md
