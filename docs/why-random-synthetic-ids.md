# Why Synthetic Messages Use Random IDs: Root Cause Analysis

## Why Synthetic Messages Use Random IDs: Root Cause Analysis

## Executive Summary

Synthetic wrapper messages (that display tool attachments) use random IDs because they are **ephemeral presentation artifacts**, not persisted entities. They're regenerated on every render from stored ToolParts. The attachment data itself (FileParts) IS persisted with stable IDs, but the user message wrapper that presents them to the LLM is recreated each time.

Making wrapper IDs stable would require either:
1. Persisting wrapper messages (storage bloat, lifecycle complexity)
2. Deterministic ID generation (collision risks, validation failures)
3. Parent ID prefixing (fork's solution - avoids the problem entirely)

## Evidence from Codebase

### 1. Synthetic Wrapper Messages Are Not Persisted

**Storage Pattern:**
```typescript
// Real messages are stored
await Storage.write(["message", msg.sessionID, msg.id], msg)

// Synthetic wrapper messages are generated in toModelMessage() and never stored
result.push({
  id: Identifier.ascending("message"),  // Generated fresh each time
  role: "user",
  parts: [...]
})
```

**Key Files:**
- `packages/opencode/src/session/index.ts:345` - Only real messages are written to storage
- `packages/opencode/src/session/message-v2.ts:735` - Synthetic wrapper messages created during rendering

### 2. Attachments Are Stored, But Synthetic Wrapper Messages Are Not

**From commit `a580fb47d` (Feb 16, 2026):**
> "tweak: drop ids from attachments in tools, assign them in prompt.ts instead"

This commit shows that attachment IDs are assigned in `prompt.ts` and then **persisted**:

```typescript
// Attachments get stable IDs assigned once
const attachments = result?.attachments?.map((attachment) => ({
  ...attachment,
  id: Identifier.ascending("part"),  // Assigned once, then stored
  sessionID,
  messageID: assistantMessage.id,
}))

// Stored as part of ToolPart state
await Session.updatePart({
  ...part,
  state: {
    status: "completed",
    attachments,  // FilePart[] with stable IDs
    ...
  },
})
```

The **FilePart attachments** are persisted with stable IDs. However, the synthetic **user message wrapper** that displays them is created during rendering with a new message ID each time.

### 3. ID Generation Strategy

**From commit `802389a90` (May 26, 2025):**
> "fixed id generation"

Added monotonic counter to prevent collisions when multiple IDs are generated in the same millisecond:

```typescript
let lastTimestamp = 0;
let counter = 0;

export function ascending(prefix: keyof typeof prefixes, given?: string) {
  const currentTimestamp = Date.now();
  if (currentTimestamp !== lastTimestamp) {
    lastTimestamp = currentTimestamp;
    counter = 0;
  }
  counter++;
  
  let now = BigInt(currentTimestamp) * BigInt(0x1000) + BigInt(counter);
  // ... plus random suffix
}
```

This shows IDs are designed to be **unique per generation**, not stable across renders.

### 4. The Rendering Flow

```
Storage (persisted):
  Message (assistant, msg_abc)
    └─ ToolPart (completed, prt_123)
         └─ state.attachments: [FilePart(prt_456), FilePart(prt_789)]
              ↑ These FileParts have stable IDs, persisted

toModelMessage() generates (ephemeral):
  Message (assistant, msg_abc)
    └─ tool-fs_read part
  Message (user, msg_xyz_RANDOM)  ← Synthetic wrapper, new ID each time
    └─ text: "Tool fs_read returned an attachment:"
    └─ file parts (using data from stored FileParts prt_456, prt_789)
```

**Key insight**: The attachment **data** (FileParts) is persisted with stable IDs. The synthetic **wrapper message** that presents them to the LLM is ephemeral and gets a new message ID on every render.

## Why Not Make IDs Stable?

### Option A: Deterministic IDs

```typescript
// Instead of:
id: Identifier.ascending("message")

// Use:
id: `${msg.info.id}-attachment-${part.id}`
```

**Problems:**
1. **ID Format Collision**: Real message IDs follow pattern `msg_<hex><random>`. Deterministic IDs like `msg_abc-attachment-prt_xyz` break this format.
2. **Storage Key Collision**: If you accidentally try to store a synthetic wrapper message, it could collide with real messages in the `["message", sessionID, messageID]` keyspace.
3. **Validation Issues**: `Identifier.schema("message")` expects IDs starting with `msg_` followed by specific format. Composite IDs would fail validation.
4. **Cross-session Pollution**: If message IDs are reused across sessions (unlikely but possible), deterministic synthetic IDs could collide.

### Option B: Persist Synthetic Wrapper Messages

**Problems:**
1. **Storage Bloat**: Every tool attachment creates an extra message in storage (in addition to the FileParts already stored in ToolPart state)
2. **Lifecycle Management**: When do you delete synthetic wrapper messages? When the parent is deleted? What if the parent is updated?
3. **Migration Complexity**: Existing sessions don't have synthetic wrapper messages stored. How do you handle mixed states?
4. **Update Propagation**: If attachment metadata changes (filename, mime type), do you update the synthetic wrapper message?
5. **Query Complexity**: Filtering real vs synthetic wrapper messages in every query
6. **Duplication**: Attachment data would be stored twice - once in ToolPart.state.attachments, once in the wrapper message

### Option C: Parent ID Prefixing (Fork's Solution)

```typescript
// In archive-context.ts (fork)
text: prefix(msg.info.id, `Tool ${part.tool} returned an attachment [continued]:`)
// Renders as: "[msg_abc] Tool fs_read returned an attachment [continued]:"
```

**Why This Works:**
1. **No ID Management**: Synthetic message still has random ID, but LLM references parent ID
2. **Stateless**: No storage changes needed
3. **Self-Documenting**: The `[continued]` marker makes the relationship explicit
4. **Debugging-Friendly**: Easy to trace which parent message owns the attachment
5. **Pruning-Friendly**: LLM can reference `msg_abc` to prune both the tool call and its attachments

**Tradeoffs:**
- Text pollution: `[msg_abc]` prefix appears in every message during compaction mode
- Requires parsing: UI/tools need to understand the prefix convention
- Not "pure": Mixing presentation (text) with identity (IDs)

But these are **minor** compared to the architectural problems of Options A and B.

## Why the Fork's Approach Is Correct

The fork recognized that synthetic **wrapper messages** are **derived data** - they're a rendering concern, not a storage concern. The real data is:
- The assistant message with its tool parts
- The tool parts with their attachment arrays (FileParts with stable IDs)

The synthetic user message is just a **presentation layer artifact** to satisfy the LLM API's requirement that files come from user messages. The attachment data itself is persisted, but the wrapper message is regenerated on each render.

By using parent ID prefixing, the fork:
1. Keeps storage simple (no synthetic wrapper messages stored)
2. Avoids ID collision risks (synthetic wrapper IDs remain random)
3. Provides stable references for pruning (parent IDs are stable)
4. Makes the relationship explicit (text shows continuation)

The LLM can reference the parent assistant message ID to prune both the tool call and its attachment results together, even though the synthetic wrapper message has a different (random) ID.

## Implications for Plugin

The plugin **cannot** reliably prune tool attachments without upstream changes because:

1. Synthetic wrapper message IDs change on every render
2. The plugin has no way to map synthetic wrapper messages to their parent assistant messages
3. Even if the plugin tracks synthetic wrapper messages, the IDs won't match on the next render
4. The LLM sees and references the wrapper message ID, but only the parent assistant message ID exists in storage

**Required Upstream Change:**

Implement parent ID prefixing in `toModelMessage()` when `compactionModeEnabled: true`:

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

This is a **minimal change** that:
- Doesn't alter storage schema
- Doesn't change ID generation
- Only affects rendering when compaction mode is enabled
- Follows the pattern already established in the fork
- Allows LLM to reference stable parent IDs instead of ephemeral wrapper IDs

## References

- Commit `a580fb47d`: "tweak: drop ids from attachments in tools, assign them in prompt.ts instead"
- Commit `802389a90`: "fixed id generation" (added monotonic counter)
- Commit `3efc3eda8`: "fix: align compaction ID context with real messages" (fork's solution)
- File: `packages/opencode/src/session/message-v2.ts` (toModelMessage implementation)
- File: `packages/opencode/src/session/archive-context.ts` (fork's toModelMessageWithIDs)
- File: `packages/opencode/src/id/id.ts` (Identifier implementation)
