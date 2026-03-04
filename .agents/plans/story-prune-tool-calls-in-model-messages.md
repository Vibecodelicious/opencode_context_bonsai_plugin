# Story: Prune Tool Calls in model-messages.transform Hook

## Goal

Implement pruning logic in the `experimental.chat.model-messages.transform` hook to remove ModelMessage entries (including tool calls, tool results, and synthetic attachment messages) that correspond to pruned message ranges. This ensures tool call results don't remain visible after pruning.

## User Model

### User Gamut
- Plugin users pruning sensitive conversation history containing tool calls (examples: removing debugging sessions with file contents, archiving API responses with credentials, cleaning up failed tool executions)
- Security-conscious users relying on complete information removal (examples: compliance requirements, data privacy regulations, client confidentiality)
- Plugin developers debugging pruning behavior (examples: verifying tool results are removed, testing edge cases with attachments)
- Users with complex tool usage patterns (examples: multiple tool calls per message, tool calls with file attachments, nested tool invocations)

### User-Needs Gamut
- Need complete removal of tool call results when parent messages are pruned (examples: tool output containing secrets, file attachments with sensitive data, error messages revealing system details)
- Need synthetic attachment messages to be removed along with parent messages (examples: tool-generated images, PDF reports, data exports)
- Need pruning to work correctly across message format conversions (examples: plugin Message → UIMessage → ModelMessage transformations)
- Need placeholder messages (anchors) to remain visible after pruning (examples: summary of pruned range, index terms for retrieval)
- Need pruning behavior to be consistent and predictable (examples: no partial removals, no orphaned tool results, no leaked synthetic messages)

### Design Implications
- Must track pruned message ID ranges across hook boundaries (messages.transform → model-messages.transform)
- Must handle ModelMessage[] format which lacks message IDs (requires alternative matching strategy)
- Must identify and remove synthetic messages created during conversion (tool attachments, media injections)
- Must preserve anchor messages with archive metadata (these become placeholders)
- Must handle all ModelMessage types (UserModelMessage, AssistantModelMessage, ToolModelMessage)

## Context References

### Relevant Codebase Files (must read)
- `src/index.ts:1-110` - Plugin hooks, currently has model-messages.transform with only gauge injection
- `src/prune.ts:1-120` - Prune tool implementation, writes archive metadata to anchor messages
- `src/state.ts:1-60` - Session state management for tracking pruned ranges
- `src/test/fixtures.ts:1-100` - Test utilities for creating messages
- `/home/basil/projects/opencode_context_management/opencode_backup/packages/opencode/src/session/archive-context.ts:117-127` - Shows synthetic message creation for tool attachments

### Files to Modify
- `src/index.ts` - Add pruning logic to model-messages.transform hook
- `src/state.ts` - Add state tracking for pruned message IDs
- `src/prune.ts` - Store pruned message IDs in session state during Phase 2

### Files to Create
- `src/model-messages-prune.ts` - Pruning logic for ModelMessage[] format
- `src/model-messages-prune.test.ts` - Tests for ModelMessage pruning

### Relevant Documentation
- `/home/basil/projects/opencode_context_bonsai_plugin/ISSUE_TOOL_CALL_PRUNING.md` - Issue description and evidence
- `/home/basil/projects/opencode_context_management/opencode/proposal-model-messages-transform-hook.md` - Hook specification

## Acceptance Criteria

- [ ] Pruned message IDs are tracked in session state during prune tool Phase 2
- [ ] model-messages.transform hook accesses pruned message IDs from session state
- [ ] ModelMessage entries are removed if they correspond to pruned message IDs
- [ ] Anchor messages (with archive metadata) are preserved as placeholders
- [ ] Synthetic messages created from pruned parents are also removed
- [ ] Tool call results within pruned assistant messages are removed
- [ ] All ModelMessage types handled correctly (user, assistant, tool, system)
- [ ] Existing gauge injection in model-messages.transform continues to work
- [ ] Tests verify tool calls and results are removed after pruning
- [ ] Test case from /tmp/failed_prune_for_tool_call_result_extended.json passes

## Design Decisions and Rationale

### Tracking Strategy
**Decision:** Store pruned message IDs (followers only, not anchors) in session state during prune tool execution.  
**Rationale:** Archive metadata is stored on anchor messages, but we need to track which messages are followers (should be removed). Session state provides cross-hook communication. Storing only follower IDs keeps the set minimal and clear about removal intent.

### Matching Strategy
**Decision:** Use position-based matching with message ID tracking from plugin Message[] array.  
**Rationale:** ModelMessage[] doesn't have IDs, but we can track which plugin messages were converted and their positions. Since messages.transform already removes followers from the array, we need to identify which ModelMessage entries correspond to messages that SHOULD have been removed but weren't (due to conversion creating new entries like synthetic messages).

**Alternative Considered:** Content-based matching (match by text content).  
**Rejected Because:** Content is transformed during conversion (ID prefixes added, formatting changes), making reliable matching difficult. Position-based is more robust.

### Synthetic Message Handling
**Decision:** Track parent message IDs during conversion, remove synthetic messages if parent is pruned.  
**Rationale:** Synthetic messages (tool attachments, media injections) are created during conversion with generated IDs. They don't exist in the plugin Message[] array, so they're never removed by messages.transform. We must identify them by checking if their content references a pruned parent message ID.

**Implementation:** Since we can't modify the conversion logic (it's in OpenCode core), we'll use heuristics: synthetic messages typically appear immediately after their parent assistant message in the ModelMessage[] array. We'll track the last seen message ID and associate synthetic messages with it.

### Anchor Preservation
**Decision:** Never remove ModelMessage entries that correspond to anchor messages (messages with archive metadata).  
**Rationale:** Anchor messages become placeholders showing the pruned range summary. They must remain visible for context continuity and retrieval functionality.

### Hook Execution Order
**Decision:** Rely on existing hook order: messages.transform → conversion → model-messages.transform.  
**Rationale:** This order is established by OpenCode core. messages.transform handles plugin format pruning, model-messages.transform handles final format pruning. No changes needed to hook order.

### State Cleanup
**Decision:** Clear pruned message IDs from session state after model-messages.transform completes.  
**Rationale:** Pruned IDs are only needed for one LLM call. Keeping them in state indefinitely could cause issues if message IDs are reused or if pruning happens multiple times in a session.

## Implementation Plan

### Phase 1: Add State Tracking for Pruned Message IDs

Add session state to track which message IDs are in pruned ranges (followers only).

**Tasks:**
1. Open `src/state.ts`
2. Add new state map: `const prunedMessageIDs = new Map<string, Set<string>>()`
3. Add getter: `export const getPrunedMessageIDs = (sessionID: string) => prunedMessageIDs.get(sessionID) ?? new Set<string>()`
4. Add setter: `export const setPrunedMessageIDs = (sessionID: string, value: Set<string>) => prunedMessageIDs.set(sessionID, value)`
5. Add clear function: `export const clearPrunedMessageIDs = (sessionID: string) => prunedMessageIDs.delete(sessionID)`
6. Update `clearSessionState` to also clear pruned message IDs

### Phase 2: Store Pruned Message IDs During Prune Tool Execution

Modify prune tool to store follower message IDs in session state.

**Tasks:**
1. Open `src/prune.ts`
2. Import state functions: `import { getPrunedMessageIDs, setPrunedMessageIDs } from './state'`
3. In Phase 2 execution (after validation passes), before writing archive metadata:
   - Calculate follower message IDs: all messages between `from_id` and `to_id` EXCEPT `from_id` (anchor)
   - Get current pruned IDs set: `const prunedIDs = getPrunedMessageIDs(ctx.sessionID)`
   - Add follower IDs to set: `for (let i = fromIndex + 1; i <= toIndex; i++) { prunedIDs.add(messages[i].id) }`
   - Store updated set: `setPrunedMessageIDs(ctx.sessionID, prunedIDs)`
4. Verify TypeScript compilation succeeds

### Phase 3: Create ModelMessage Pruning Logic

Create new module with logic to remove ModelMessage entries for pruned messages.

**Tasks:**
1. Create `src/model-messages-prune.ts`
2. Add imports:
   ```typescript
   import type { ModelMessage } from 'ai'
   import { PLUGIN_ID } from './constants'
   ```
3. Create function `pruneModelMessages(messages: ModelMessage[], prunedIDs: Set<string>, sessionID: string): void`
4. Implementation approach:
   - Iterate through messages array in reverse (for safe removal)
   - For each message, determine if it should be removed:
     - Check if message corresponds to a pruned ID (requires tracking)
     - Check if message is synthetic and parent is pruned
   - Remove messages by splicing array
5. Challenge: ModelMessage doesn't have IDs, so we need to track correspondence
6. Solution: Build a map during iteration that tracks which ModelMessage index corresponds to which original message ID
   - This requires access to the original plugin Message[] array or UIMessage[] array
   - Since we don't have access to that in model-messages.transform, we need a different approach

**Revised Approach:**
- Since ModelMessage[] is the result of converting the already-pruned plugin Message[] array, the pruned followers should NOT be in ModelMessage[] at all
- The issue is that synthetic messages and tool results are created DURING conversion, and these might reference pruned content
- So we need to identify ModelMessage entries that contain references to pruned message IDs in their content

**Revised Implementation:**
1. Function signature: `export function pruneModelMessages(messages: Array<any>, prunedIDs: Set<string>): void`
   - Use `Array<any>` to avoid complex ModelMessage union type handling
   - Mutates messages array in place (consistent with hook pattern)
2. For each message in reverse (safe removal while iterating):
   - Extract text content from message:
     - UserModelMessage/AssistantModelMessage: `message.content` (string or Array<{type, text}>)
     - ToolModelMessage: `message.content` (Array<ToolResultPart>)
   - Check if message is an anchor (should preserve):
     - Search content for `[PRUNED:` or `[SMART_ARCHIVED:` pattern
     - If found, skip removal (this is a placeholder)
   - Check if content contains any pruned message ID:
     - Search for `[<id>]` pattern (format used by plugin's ID visibility)
     - Match against prunedIDs set
     - If found, remove the message via splice
3. Content extraction helper:
   ```typescript
   function extractTextContent(message: any): string {
     if (typeof message.content === 'string') return message.content
     if (Array.isArray(message.content)) {
       return message.content
         .filter(part => part.type === 'text' && part.text)
         .map(part => part.text)
         .join(' ')
     }
     return ''
   }
   ```
4. Anchor detection helper:
   ```typescript
   function isAnchorMessage(content: string): boolean {
     return content.includes('[PRUNED:') || content.includes('[SMART_ARCHIVED:')
   }
   ```
5. ID extraction from content:
   ```typescript
   function extractMessageIDs(content: string): string[] {
     const matches = content.match(/\[msg_[a-zA-Z0-9]+\]/g) || []
     return matches.map(m => m.slice(1, -1)) // Remove [ and ]
   }
   ```

### Phase 4: Integrate Pruning into model-messages.transform Hook

Add pruning logic to the existing model-messages.transform hook.

**Tasks:**
1. Open `src/index.ts`
2. Import pruning function: `import { pruneModelMessages } from './model-messages-prune'`
3. Import state function: `import { getPrunedMessageIDs, clearPrunedMessageIDs } from './state'`
4. In `experimental.chat.model-messages.transform` hook, BEFORE gauge injection:
   ```typescript
   const prunedIDs = getPrunedMessageIDs(input.sessionID)
   if (prunedIDs.size > 0) {
     pruneModelMessages(output.messages, prunedIDs)
     clearPrunedMessageIDs(input.sessionID)
   }
   ```
5. Gauge injection remains after pruning (so gauge appears in pruned context)
6. Verify TypeScript compilation succeeds

### Phase 5: Write Tests

Create tests to verify ModelMessage pruning works correctly.

**Tasks:**
1. Create `src/model-messages-prune.test.ts`
2. Test case 1: Remove assistant message with tool call when message ID is pruned
   - Create ModelMessage[] with assistant message containing tool call
   - Mark message ID as pruned
   - Call pruneModelMessages
   - Verify message is removed
3. Test case 2: Remove synthetic user message when parent is pruned
   - Create ModelMessage[] with assistant message followed by synthetic user message (tool attachment)
   - Mark parent message ID as pruned
   - Call pruneModelMessages
   - Verify both messages are removed
4. Test case 3: Preserve anchor message even if ID is in range
   - Create ModelMessage[] with anchor message (contains archive summary)
   - Mark message ID as pruned
   - Call pruneModelMessages
   - Verify message is NOT removed (anchors are preserved)
5. Test case 4: Handle empty pruned IDs set (no-op)
6. Test case 5: Handle ModelMessage with string content
7. Test case 6: Handle ModelMessage with array content
8. Run tests: `bun test src/model-messages-prune.test.ts`

### Phase 6: Integration Testing

Test the full flow with actual prune tool execution.

**Tasks:**
1. Create integration test in `src/index.test.ts` or separate file
2. Test scenario:
   - Create session with messages including tool calls
   - Call prune tool Phase 1 (enable ID visibility)
   - Call prune tool Phase 2 (archive range including tool call)
   - Trigger model-messages.transform hook
   - Verify tool call results are removed from ModelMessage[]
3. Test with actual test case from /tmp/failed_prune_for_tool_call_result_extended.json:
   - Load test case messages
   - Simulate prune tool execution
   - Verify tool results are removed
4. Run all tests: `bun test`

### Phase 7: Handle Edge Cases

Address edge cases and error conditions.

**Tasks:**
1. Handle case where prunedIDs contains anchor message ID (should not remove)
   - Add check in pruneModelMessages to skip removal if message is anchor
   - Anchor detection: message content contains `[PRUNED:` or `[SMART_ARCHIVED:` pattern
2. Handle case where ModelMessage[] is empty (no-op)
3. Handle case where all messages are pruned (leave only anchors)
4. Handle case where synthetic message appears before parent (shouldn't happen, but defensive)
5. Add error logging for unexpected conditions (optional, for debugging)

## Step-by-Step Tasks

1. Add prunedMessageIDs state map to src/state.ts with getter/setter/clear functions
2. Update clearSessionState to clear pruned message IDs
3. Modify prune tool Phase 2 to calculate and store follower message IDs in state
4. Create src/model-messages-prune.ts with pruneModelMessages function
5. Implement content-based matching to identify messages referencing pruned IDs
6. Integrate pruning into model-messages.transform hook before gauge injection
7. Clear pruned IDs from state after pruning completes
8. Write unit tests for pruneModelMessages function
9. Write integration test for full prune flow with tool calls
10. Test with actual test case from /tmp/failed_prune_for_tool_call_result_extended.json
11. Handle edge cases (anchor preservation, empty arrays, all pruned)
12. Run all tests and verify passing

## Testing Strategy

### Unit Testing
- Test pruneModelMessages function with various ModelMessage[] configurations
- Test state management functions (get/set/clear pruned IDs)
- Test anchor detection logic
- Test content-based ID matching

### Integration Testing
- Test full prune flow: Phase 1 → Phase 2 → model-messages.transform
- Test with messages containing tool calls and results
- Test with synthetic attachment messages
- Test with actual test case from /tmp/

### Manual Testing
- Run OpenCode session with context-bonsai plugin
- Execute tool calls that produce results
- Prune messages containing tool calls
- Verify tool results are removed from LLM context
- Verify anchor placeholders remain visible

## Validation Commands

```bash
# Run all tests
cd /home/basil/projects/opencode_context_bonsai_plugin && bun test

# Run specific test file
cd /home/basil/projects/opencode_context_bonsai_plugin && bun test src/model-messages-prune.test.ts

# Build plugin
cd /home/basil/projects/opencode_context_bonsai_plugin && bun run build

# Check for TypeScript errors
cd /home/basil/projects/opencode_context_bonsai_plugin && bunx tsc --noEmit
```

## Validation Loop Results

### Iteration 1

**Missing Details Check:**
- ❌ 5 missing details identified:
  1. Content extraction logic for different ModelMessage types not specified
  2. Anchor detection pattern unclear (`[PRUNED:` vs `[SMART_ARCHIVED:`)
  3. ID extraction pattern ambiguous (`[msg_<id>]` vs `[<id>]`)
  4. Function signature return type not specified (void vs filtered array)
  5. Helper function implementations missing

**Action taken:**
- Added detailed implementation with helper functions for content extraction, anchor detection, and ID extraction
- Specified function signature: `pruneModelMessages(messages: Array<any>, prunedIDs: Set<string>): void`
- Clarified ID pattern: `[msg_<id>]` format (matches plugin's ID visibility format)
- Clarified anchor pattern: `[PRUNED:` or `[SMART_ARCHIVED:` (matches placeholder format)

**Ambiguity Check:**
- Pending (Iteration 2)

### Iteration 2

**Missing Details Check:**
- ✅ All iteration 1 issues resolved
- ✅ No new missing details identified

**Ambiguity Check:**
- ❌ 4 high-impact ambiguities identified:
  1. **Partial match handling**: If message contains multiple IDs (some pruned, some not), should we remove it?
  2. **Synthetic message detection**: How to reliably identify synthetic messages if they're not adjacent to parent?
  3. **State cleanup timing**: When exactly to clear pruned IDs if hook is called multiple times?
  4. **Removal efficiency**: Immediate removal vs batch removal?

**Action taken:**
- **Partial match**: Remove message if ANY pruned ID found (conservative - prevents data leakage)
- **Synthetic detection**: Use content-based matching only (don't rely on position)
- **State cleanup**: Clear at END of hook, after all processing complete
- **Removal efficiency**: Immediate removal in reverse iteration (prevents index shifting, simpler logic)

### Iteration 3

**Missing Details Check:**
- ✅ No missing details identified
- ✅ All function signatures specified
- ✅ All helper functions implemented
- ✅ All patterns and formats clarified

**Ambiguity Check:**
- ✅ No remaining high-impact ambiguities
- ✅ All design decisions resolved
- ✅ Implementation path is clear

**Conclusion:** Plan is implementation-ready. Validation loop complete (3 iterations).

## Completion Checklist

- [ ] All acceptance criteria met
- [ ] Validation commands pass
- [ ] All tests passing
- [ ] TypeScript compilation succeeds
- [ ] Tool call results removed after pruning
- [ ] Synthetic messages removed when parent is pruned
- [ ] Anchor messages preserved
- [ ] Gauge injection still works
- [ ] Test case from /tmp/ passes
- [ ] No regression in other plugin functionality
- [ ] Validation loop completed (3 iterations max)
