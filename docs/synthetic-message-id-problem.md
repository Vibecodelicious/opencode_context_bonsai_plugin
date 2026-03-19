# Synthetic Message ID Stability Problem

## Problem Statement

The plugin cannot prune tool call results because synthetic messages (generated for tool attachments) receive random IDs on every render, making them impossible to reference reliably.

## Root Cause

In OpenCode's `toModelMessage()` function, when a tool returns attachments, a synthetic user message wrapper is created:

```typescript
if (part.state.attachments?.length) {
  const attachmentText = `Tool ${part.tool} returned an attachment:`
  result.push({
    id: Identifier.ascending("message"),  // ❌ NEW RANDOM ID EVERY RENDER
    role: "user",
    parts: [
      {
        type: "text",
        text: compactionModeEnabled ? prefixWithId(msg.info.id, attachmentText) : attachmentText,
      },
      ...part.state.attachments.map((attachment) => ({
        type: "file" as const,
        url: attachment.url,
        mediaType: attachment.mime,
        filename: attachment.filename,
      })),
    ],
  })
}
```

**What's Actually Stored:**
```typescript
// In storage: Assistant message with ToolPart
Message (assistant, msg_abc)
  └─ ToolPart (prt_123)
       └─ state.attachments: [FilePart(prt_456), FilePart(prt_789)]
            ↑ These FileParts have STABLE IDs, assigned once and persisted
```

**What's Ephemeral:**
The synthetic **user message wrapper** (with role "user") that presents the attachments to the LLM. This wrapper is regenerated on every render with a new message ID.

**Impact:**
1. Phase 1 of pruning shows message IDs to the LLM
2. LLM sees synthetic wrapper as `msg_xyz123` and identifies it for pruning
3. Phase 2 calls prune tool with `from_id: "msg_xyz123"`
4. Next render generates a different wrapper ID `msg_abc456`
5. Archive lookup fails - `msg_xyz123` doesn't exist in storage (only the assistant message `msg_abc` exists)

## Solution from Fork

The fork solved this in `archive-context.ts` by using the **parent message ID** instead of generating synthetic IDs:

```typescript
if (part.state.attachments?.length) {
  result.push({
    id: Identifier.ascending("message"),  // Still synthetic, but...
    role: "user",
    parts: [
      {
        type: "text",
        text: prefix(msg.info.id, `Tool ${part.tool} returned an attachment [continued]:`),
        //            ^^^^^^^^^^^^ Uses parent assistant message ID
      },
      ...part.state.attachments.map((attachment) => ({
        type: "file" as const,
        url: attachment.url,
        mediaType: attachment.mime,
        filename: attachment.filename,
      })),
    ],
  })
}
```

**Key insight:** The text content is prefixed with `[msg_abc]` where `msg_abc` is the parent assistant message's ID. The `[continued]` marker indicates it's a continuation of the previous message.

When the LLM sees:
```
[msg_abc] Here's the file content...
[msg_abc] Tool fs_read returned an attachment [continued]:
```

It can reference `msg_abc` to prune both the tool call and its attachment result together. The synthetic wrapper message still has a random ID, but the LLM references the stable parent ID instead.

## Upstream Changes Needed

### Option 1: Stable Synthetic IDs (Minimal)

Generate deterministic IDs for synthetic wrapper messages based on parent message + part:

```typescript
// Instead of:
id: Identifier.ascending("message")

// Use:
id: `${msg.info.id}-attachment-${part.id}`
```

This makes synthetic wrapper message IDs stable across renders and allows plugins to reference them.

**Problems:**
- Breaks ID format validation (`msg_<hex><random>` pattern)
- Risk of collision with real message IDs in storage keyspace
- Composite IDs would fail `Identifier.schema("message")` validation

### Option 2: Parent ID Association (Fork's Approach)

Always prefix synthetic wrapper message content with the parent message ID when `compactionModeEnabled: true`:

```typescript
if (part.state.attachments?.length) {
  const attachmentText = `Tool ${part.tool} returned an attachment [continued]:`
  result.push({
    id: Identifier.ascending("message"),  // Still random
    role: "user",
    parts: [
      {
        type: "text",
        text: compactionModeEnabled 
          ? prefixWithId(msg.info.id, attachmentText)  // Use parent ID
          : attachmentText,
      },
      ...
    ],
  })
}
```

This allows the LLM to reference the parent message ID, and the plugin can prune the parent + all its synthetic children together. The wrapper message ID remains random, but the LLM uses the stable parent ID for pruning.

### Option 3: Expose Synthetic Message Metadata

Add metadata to synthetic wrapper messages indicating their parent:

```typescript
result.push({
  id: Identifier.ascending("message"),
  role: "user",
  parts: [...],
  experimental_syntheticParent: msg.info.id  // New field
})
```

Plugins can then track synthetic wrapper messages and map them to their parents for pruning.

**Problems:**
- Requires schema changes to message format
- Plugins need complex tracking logic
- Doesn't solve the fundamental issue that wrapper IDs are unstable

## Recommendation

Use plugin-only synthetic-ID resolution as the canonical implementation path in this repository. It resolves synthetic IDs to stored parent messages using monotonic ordering and does not require upstream parent-prefixing.

## Why Synthetic Messages Use Random IDs

After deep analysis (see `why-random-synthetic-ids.md`), the root cause is:

**Synthetic messages are ephemeral derived data, not persisted entities.**

They're regenerated on every render from stored tool parts. The real data stored is:
- Assistant message with tool parts
- Tool parts with attachment arrays

The synthetic user message is a **presentation layer artifact** to satisfy LLM API requirements that files come from user messages.

Making synthetic IDs stable would require either:
1. **Persisting them** → storage bloat, lifecycle complexity, migration issues
2. **Deterministic IDs** → collision risks with real message IDs, validation failures
3. **Parent ID prefixing** → fork's solution, avoids the problem entirely

The fork's approach is architecturally correct because it treats synthetic messages as what they are: rendering artifacts, not domain entities.

## Implementation for Plugin

Current plugin behavior is:

1. When archiving a message with tool parts that have attachments, the LLM will reference the parent assistant message ID
2. Archive the parent message - the synthetic wrapper messages will naturally disappear from rendering
3. Include a note in the summary that attachment results were also archived
4. When retrieving, restore the parent message - the synthetic wrappers will be regenerated automatically with the stored attachment data

The plugin doesn't need to track synthetic wrapper messages separately - it archives the resolved parent assistant message by ID, and ephemeral wrappers are handled by the rendering layer.

Canonical scope statement: current implementation uses plugin-only synthetic-ID resolution; upstream parent-prefixing work is explicitly out of scope for this story.

## References

- Fork commit: `3efc3eda8` - "fix: align compaction ID context with real messages"
- Fork commit: `9e16038ed` - "feat(session): add conditional ID prefixing to toModelMessage"
- Fork file: `packages/opencode/src/session/archive-context.ts`
- Fork file: `packages/opencode/src/session/message-v2.ts`
