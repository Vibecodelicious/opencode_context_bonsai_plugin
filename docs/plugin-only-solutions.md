# Plugin-Only Solutions (No OpenCode Modifications)

## The Challenge

The plugin needs to handle pruning of tool results with attachments, but synthetic wrapper message IDs are unstable. What can we do from the plugin alone?

## Option 1: Inject Parent ID Prefix via messages.transform Hook

**Idea:** Use the `messages.transform` hook to modify message content before it's sent to the LLM, adding parent ID prefixes ourselves.

```typescript
hooks: {
  'messages.transform': async (messages, context) => {
    if (!context.compactionModeEnabled) return messages;
    
    return messages.map(msg => {
      // If this is a synthetic wrapper (user message following assistant with tool)
      if (msg.role === 'user' && msg.parts.some(p => p.type === 'text' && p.text.includes('returned an attachment'))) {
        // Find the previous assistant message
        const idx = messages.indexOf(msg);
        const prevMsg = idx > 0 ? messages[idx - 1] : null;
        
        if (prevMsg?.role === 'assistant') {
          // Prefix with parent ID
          return {
            ...msg,
            parts: msg.parts.map(part => 
              part.type === 'text' 
                ? { ...part, text: `[${prevMsg.id}] ${part.text}` }
                : part
            )
          };
        }
      }
      return msg;
    });
  }
}
```

**Problems:**
- Fragile heuristic (detecting synthetic wrappers by text content)
- Doesn't know which assistant message is the parent (could be multiple tool calls)
- May not have access to message IDs in the transform hook
- Timing issues: when is compactionModeEnabled set?

**Viability:** 🟡 Possible but fragile

---

## Option 2: Track Synthetic Wrapper IDs During Rendering

**Idea:** Use the `messages.transform` hook to build a mapping of synthetic wrapper IDs to parent assistant message IDs.

```typescript
const syntheticWrapperMap = new Map<string, string>(); // wrapperID -> parentID

hooks: {
  'messages.transform': async (messages, context) => {
    // Build mapping
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      const prevMsg = i > 0 ? messages[i - 1] : null;
      
      if (msg.role === 'user' && 
          prevMsg?.role === 'assistant' &&
          msg.parts.some(p => p.type === 'file')) {
        syntheticWrapperMap.set(msg.id, prevMsg.id);
      }
    }
    return messages;
  }
}
```

Then in the prune tool:
```typescript
async prune({ from_id, to_id }) {
  // Translate synthetic wrapper IDs to parent IDs
  const actualFromId = syntheticWrapperMap.get(from_id) ?? from_id;
  const actualToId = syntheticWrapperMap.get(to_id) ?? to_id;
  
  // Archive using parent IDs
  await archiveMessages(actualFromId, actualToId);
}
```

**Problems:**
- Map is stale immediately after render (next render generates new wrapper IDs)
- Race condition: prune tool might be called before/after map is updated
- Map grows unbounded (memory leak)
- Doesn't work across plugin restarts

**Viability:** 🔴 Unreliable due to timing issues

---

## Option 3: Prune by Parent ID Only (Ignore Synthetic Wrappers)

**Idea:** Instruct the LLM to only reference assistant message IDs, never synthetic wrapper IDs.

Add to system prompt:
```
When using the prune tool, only reference assistant message IDs (the messages 
containing tool calls). Do not reference the synthetic "Tool X returned an 
attachment" messages - these are automatically included when you prune the 
assistant message.
```

**Implementation:**
```typescript
hooks: {
  'system.transform': async (systemPrompt) => {
    return systemPrompt + `\n\n<pruning-guidance>
When identifying messages to prune, reference the assistant message IDs that 
contain tool calls. The tool attachment results will be automatically included.
Do not attempt to reference messages like "Tool fs_read returned an attachment" 
as these are display artifacts.
</pruning-guidance>`;
  }
}
```

**Problems:**
- Relies on LLM following instructions perfectly
- LLM may still see and reference wrapper message IDs
- Doesn't solve the fundamental issue
- Confusing UX: LLM sees messages it can't reference

**Viability:** 🟡 Partial solution, requires perfect LLM compliance

---

## Option 4: Replace Synthetic Wrapper ID Prefixes

**Idea:** After OpenCode adds ID prefixes, use messages.transform to replace synthetic wrapper IDs with parent IDs.

```typescript
hooks: {
  'messages.transform': async (messages, context) => {
    if (!context.compactionModeEnabled) return messages;
    
    return messages.map((msg, idx) => {
      const prevMsg = idx > 0 ? messages[idx - 1] : null;
      
      // If this looks like a synthetic wrapper
      if (msg.role === 'user' && 
          prevMsg?.role === 'assistant' &&
          msg.parts.some(p => p.type === 'file')) {
        return {
          ...msg,
          parts: msg.parts.map(part => {
            if (part.type === 'text') {
              // Replace [msg_random123] with [msg_parent]
              const text = part.text.replace(/^\[msg_[^\]]+\]/, `[${prevMsg.id}]`);
              return { ...part, text };
            }
            return part;
          })
        };
      }
      return msg;
    });
  }
}
```

**Problems:**
- Assumes ID prefix format `[msg_xxx]` at start of text
- messages.transform might run BEFORE toModelMessage adds ID prefixes
- Hook execution order is critical and may not be guaranteed
- Fragile regex matching

**Viability:** 🔴 Likely doesn't work due to hook execution order

---

## Option 5: Expand Prune Range to Include Wrappers

**Idea:** When LLM specifies a range, automatically expand it to include any synthetic wrappers that follow assistant messages in the range.

```typescript
async prune({ from_id, to_id, reason }) {
  // Get all messages in session
  const allMessages = await getSessionMessages();
  
  // Find the range
  const fromIdx = allMessages.findIndex(m => m.id === from_id);
  const toIdx = allMessages.findIndex(m => m.id === to_id);
  
  // Expand range to include following synthetic wrappers
  let expandedToIdx = toIdx;
  for (let i = toIdx + 1; i < allMessages.length; i++) {
    const msg = allMessages[i];
    const prevMsg = allMessages[i - 1];
    
    // If this looks like a synthetic wrapper following an assistant message in range
    if (msg.role === 'user' && 
        prevMsg?.role === 'assistant' &&
        msg.parts.some(p => p.type === 'file')) {
      expandedToIdx = i;
    } else {
      break; // Stop at first non-wrapper
    }
  }
  
  // Archive expanded range
  await archiveMessages(from_id, allMessages[expandedToIdx].id);
}
```

**Problems:**
- Plugin doesn't have access to full message list with synthetic wrappers
- Synthetic wrappers aren't in storage, so can't be archived
- The wrappers will be regenerated anyway on next render

**Viability:** 🔴 Doesn't work - wrappers aren't stored

---

## Option 6: Accept the Limitation and Document It

**Idea:** Don't try to prune synthetic wrappers. Document that tool attachments can't be pruned individually.

Add to tool description:
```
Note: When pruning assistant messages that contain tool calls with attachments,
the attachment results are automatically included. You cannot prune attachment
results separately from their tool calls.
```

**Implementation:**
```typescript
// In prune tool
if (messageHasSyntheticWrapper(from_id)) {
  return {
    error: "Cannot prune synthetic attachment messages. Prune the parent assistant message instead."
  };
}
```

**Problems:**
- Doesn't solve the problem
- Poor UX: LLM sees messages it can't prune
- Attachments can be large and worth pruning

**Viability:** 🟡 Acceptable as temporary workaround

---

## Recommended Approach: Resolve Synthetic IDs Using Monotonic Ordering

**Strategy:**
Use the fact that message IDs are monotonic (timestamp-based) to resolve synthetic wrapper IDs to their parent assistant message IDs.

**Key Insight:**
- Synthetic wrapper IDs don't exist in storage
- They're generated during rendering, right after their parent assistant message
- The parent is the most recent stored assistant message (with tool attachments) that has ID < synthetic ID

```typescript
async prune({ from_id, to_id, reason }) {
  const realFromId = await resolveToStoredMessage(from_id);
  const realToId = await resolveToStoredMessage(to_id);
  
  await archiveMessages(realFromId, realToId, reason);
}

async function resolveToStoredMessage(messageId: string): string {
  // Check if it exists in storage
  if (await messageExists(messageId)) {
    return messageId;
  }
  
  // It's synthetic - find the parent
  const storedMessages = await getStoredMessages();
  
  // Filter to assistant messages with tool parts that have attachments
  const candidateParents = storedMessages.filter(msg => 
    msg.role === 'assistant' &&
    msg.parts.some(part => 
      part.type === 'tool' && 
      part.state.status === 'completed' &&
      part.state.attachments?.length > 0
    )
  );
  
  // Find the one with largest ID < messageId (most recent before synthetic)
  // Use simple string comparison - IDs are hex-encoded timestamps that preserve lexicographic order
  const parent = candidateParents
    .filter(msg => msg.id < messageId)
    .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
    .pop(); // Get last (largest ID)
  
  if (!parent) {
    throw new Error(`Cannot resolve synthetic message ID ${messageId} to parent`);
  }
  
  return parent.id;
}
```

**Advantages:**
- No upstream changes needed
- Works with multiple synthetic wrappers per parent
- Uses structural properties (monotonic IDs, storage existence)
- No string/regex matching
- Handles ID regeneration between phases (we resolve on each phase)
- Simple string comparison is correct for hex-encoded timestamp IDs
- Messages already loaded in memory (no additional queries)

**Limitations:**
- Assumes synthetic wrappers only created for tool attachments
- Requires filtering stored messages to find candidates
- Fails if no candidate parents exist (throw error with clear message)

**Viability:** 🟢 This works as a plugin-only solution

---

## Conclusion

**A plugin-only solution DOES work** using monotonic ID resolution:

1. When prune receives a message ID, check if it exists in storage
2. If not, it's a synthetic wrapper - find the parent by:
   - Getting all stored assistant messages with tool attachments
   - Finding the one with the largest ID that's still less than the synthetic ID
3. Archive using the resolved parent IDs

**This works because:**
- Message IDs are monotonic (timestamp-based)
- Synthetic wrappers are generated after their parents in the same render
- We can use ID ordering to find the parent without string matching
- Resolution happens at prune time, so ID regeneration between phases doesn't matter

**No upstream changes required** for basic functionality, though parent ID prefixing would still improve UX by making the relationship explicit to the LLM.
