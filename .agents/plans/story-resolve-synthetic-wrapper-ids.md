# Story: Resolve Synthetic Wrapper Message IDs to Parent IDs

## Goal

Enable the plugin to handle pruning of synthetic wrapper messages (tool attachment displays) by resolving their ephemeral IDs to stable parent assistant message IDs using monotonic ID ordering.

## User Model

### User Gamut
- Plugin users with long-running sessions containing tool calls with attachments (examples only)
- Developers debugging issues with large file reads
- Users working with image-heavy workflows (screenshots, diagrams)
- Teams doing extensive web research with cached content
- Users with sessions approaching context limits who need surgical pruning

### User-Needs Gamut
- Need to prune large tool results to stay under context limits
- Want to remove verbose debugging output while keeping conclusions
- Need to archive completed work phases without losing ability to reference them
- Want fine-grained control over what stays in active context
- Need pruning to work reliably without manual ID translation

### Ambiguities From User Model
- None identified - all users benefit from transparent synthetic ID resolution

## Context References

### Relevant Codebase Files (must read)
- `src/prune.ts:31-65` - Current validation logic that checks message existence
- `src/prune.ts:76-145` - Main prune tool execute function
- `src/test/fixtures.ts` - Test fixture types including WithParts
- `docs/plugin-only-solutions.md` - Detailed analysis of the solution approach
- `docs/synthetic-message-id-problem.md` - Problem description and context

### OpenCode Reference Files (for understanding)
- `/home/basil/projects/opencode_context_management/opencode_backup/packages/opencode/src/session/message-v2.ts:730-755` - Synthetic wrapper generation
- `/home/basil/projects/opencode_context_management/opencode_backup/packages/opencode/src/id/id.ts` - ID generation implementation

### New Files to Create
- None - modifications to existing files only

## Acceptance Criteria

- [ ] When prune receives a message ID that doesn't exist in storage, it attempts to resolve it to a parent
- [ ] Resolution finds assistant messages with completed tool calls that have attachments
- [ ] Resolution selects the parent with largest ID < synthetic ID
- [ ] Resolution uses simple string comparison (not localeCompare) for ID ordering
- [ ] If no parent found, returns clear error message
- [ ] Existing tests pass
- [ ] New tests cover synthetic ID resolution scenarios
- [ ] Multiple synthetic wrappers per parent are handled correctly
- [ ] Non-synthetic missing IDs still produce appropriate errors

## Implementation Plan

### Phase 1: Add Resolution Function
- Create `resolveToStoredMessage()` function in prune.ts
- Check if message ID exists in messages array
- If not, filter to assistant messages with tool attachments
- Use simple string comparison to find parent with largest ID < synthetic ID
- Return parent ID or throw descriptive error

### Phase 2: Integrate with Validation
- Modify `validatePruneInput()` to call resolution before validation
- Resolve both from_id and to_id
- Continue with existing validation logic using resolved IDs
- Preserve error messages for truly invalid IDs

### Phase 3: Update Execute Function
- Call resolution in execute() before writing archive metadata
- Use resolved IDs for all operations
- Ensure archive metadata written to correct parent message

### Phase 4: Testing and Validation
- Add unit tests for resolveToStoredMessage()
- Test with single synthetic wrapper
- Test with multiple synthetic wrappers per parent
- Test with no candidate parents (error case)
- Test with non-synthetic missing IDs
- Verify existing tests still pass

## Step-by-Step Tasks

1. Add `resolveToStoredMessage()` function after `findMessageIndex()`:
   - Parameter: `messages: WithParts[]`, `messageId: string`
   - Return type: `string` (returns resolved message ID or throws)
   - Check if message exists using `findMessageIndex(messages, messageId) !== null`
   - If exists, return messageId unchanged
   - Filter to assistant messages: `messages.filter(msg => msg.role === 'assistant' && msg.parts.some(...))`
   - Part filter: `part.type === 'tool' && part.state?.status === 'completed' && part.state?.attachments && part.state.attachments.length > 0`
   - Filter candidates: `candidates.filter(msg => msg.id < messageId)`
   - Sort: `candidates.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)`
   - Get largest: `const parent = sorted[sorted.length - 1]`
   - If no parent: throw `new Error(\`Cannot resolve synthetic message ID ${messageId} to parent - no candidate assistant messages with attachments found\`)`
   - Return `parent.id`

2. Modify `validatePruneInput()` signature and implementation:
   - Change return type to: `{ error: string } | { resolvedFromId: string; resolvedToId: string; fromIndex: number; toIndex: number }`
   - Add try-catch block at start of function body
   - Inside try: `const resolvedFromId = resolveToStoredMessage(messages, fromId)`
   - Inside try: `const resolvedToId = resolveToStoredMessage(messages, toId)`
   - In catch: `return { error: e.message }`
   - Calculate indices: `const fromIndex = findMessageIndex(messages, resolvedFromId)!`
   - Calculate indices: `const toIndex = findMessageIndex(messages, resolvedToId)!`
   - Update all existing validation error returns to: `return { error: "message" }`
   - On success return: `return { resolvedFromId, resolvedToId, fromIndex, toIndex }`

3. Update `execute()` function:
   - Change validation call: `const result = validatePruneInput(messages, args.from_id, args.to_id, PLUGIN_ID)`
   - Check error: `if ('error' in result) return \`Validation error: ${result.error}\``
   - Use resolved IDs: `result.resolvedFromId`, `result.resolvedToId`
   - Use indices: `result.fromIndex`, `result.toIndex`
   - Update updateMessage call: `await (ctx as any).updateMessage(result.resolvedFromId, ...)`
   - Update same-step prunes: `currentPrunes.add(result.resolvedFromId)`
   - Calculate range size: `const rangeSize = result.toIndex - result.fromIndex + 1`
   - Success message: `const idsChanged = args.from_id !== result.resolvedFromId || args.to_id !== result.resolvedToId`
   - If idsChanged: `return \`Archived ${rangeSize} messages from ${args.from_id} (resolved to ${result.resolvedFromId}) to ${args.to_id} (resolved to ${result.resolvedToId}).\\nSummary: ${args.summary}\\nIndex terms: ${args.index_terms.join(', ')}\``
   - Else: use existing success message format

4. Add imports and test helpers in `src/test/fixtures.ts`:
   - Add import: `import type { ToolPart, FilePart } from '@opencode-ai/sdk/v2'` (if not already present)
   - Add `createFilePart(id: string): FilePart` - returns minimal FilePart with required fields
   - Add `createToolPart(id: string, attachmentCount: number): ToolPart` - returns ToolPart with status 'completed' and array of FileParts
   - Add `createAssistantWithAttachments(id: string, sessionID: string, attachmentCount: number): WithParts` - returns assistant message with tool part containing attachments
   - Add `createSyntheticWrapperScenario()` - returns array with assistant message followed by user messages simulating synthetic wrappers

5. Add test file `src/test/prune-resolution.test.ts`:
   - Import: `describe, test, expect` from 'bun:test'
   - Import test helpers from './fixtures'
   - Test: "resolves synthetic ID to correct parent with single wrapper"
   - Test: "resolves multiple synthetic wrappers to correct parents"
   - Test: "throws error when no candidate parents exist"
   - Test: "returns unchanged ID when message exists in storage"
   - Test: "throws error when synthetic ID smaller than all stored IDs"
   - Test: "handles assistant with multiple tool parts correctly"

6. Update existing tests in `src/prune.test.ts`:
   - Update assertions that check validatePruneInput return value to handle new object format
   - Add test: "validation with synthetic ID resolution succeeds"
   - Add test: "success message shows resolved IDs when different from original"

7. Run test suite: `bun test`

## Testing Strategy

### Unit Tests
- `resolveToStoredMessage()` with various scenarios
- Edge cases: empty messages array, no tool attachments, all IDs greater than synthetic

### Integration Tests  
- Full prune flow with synthetic IDs
- Verify archive metadata written to correct parent
- Verify range validation works with resolved IDs

### Manual Testing
- Test with actual OpenCode session containing tool attachments
- Verify Phase 1 shows synthetic wrapper IDs
- Verify Phase 2 correctly resolves and archives

## Validation Commands

```bash
# Run all tests
bun test

# Run specific test file
bun test src/prune-resolution.test.ts

# Type check
bun run tsc --noEmit
```

## Validation Loop Results

### Iteration 1

**Missing details check:**
- Added specific error message formats for resolution failures
- Clarified validatePruneInput() return type change to object with resolved IDs and indices
- Added test helper functions needed in fixtures.ts
- Specified exact success message format for resolved vs original IDs
- Added edge case handling for synthetic ID smaller than all stored IDs
- Clarified that resolution happens inside validatePruneInput() with try-catch

**Ambiguity check:**
- Resolved: Resolution timing - happens in validatePruneInput() with try-catch
- Resolved: Error handling - different messages for resolution vs validation failures
- Resolved: Success message - show both original and resolved when different
- Resolved: Partial resolution - fail fast if either ID can't be resolved
- Resolved: No caching needed - resolve on each call
- Resolved: Return structure - object with resolvedFromId, resolvedToId, fromIndex, toIndex
- Resolved: Function placement - after findMessageIndex(), private function

### Iteration 2

**Missing details check:**
- Fixed return type to discriminated union: `{ error: string } | { resolvedFromId: string; resolvedToId: string; fromIndex: number; toIndex: number }`
- Added required type imports for ToolPart and FilePart in fixtures.ts
- Specified complete test helper signatures with parameter types
- Clarified success message comparison uses strict equality (`!==`)
- Added type guard for error checking: `'error' in result`
- Specified exact sort implementation without `.pop()`
- Moved test file to correct location: `src/test/prune-resolution.test.ts`
- Removed ambiguous "Resolution failed:" prefix - use error.message directly

**Ambiguity check:**
- Resolved: Return type structure - discriminated union with required properties
- Resolved: Error message precedence - resolution errors returned immediately, validation errors after
- Resolved: Success message logic - strict equality check for ID comparison
- Resolved: Test helper specifications - complete signatures with types
- Resolved: Try-catch placement - single block at start of validatePruneInput
- Resolved: Index calculation - happens after resolution, inside validatePruneInput
- Resolved: Edge cases - all covered by error handling in resolution function

### Iteration 3

**Missing details check:** ✅ No missing details found - plan is complete and implementation-ready

**Ambiguity check:** ✅ No ambiguities found - single clear implementation path

**Iterations run:** 3/3

**Status:** ✅ VALIDATED - Ready for implementation
