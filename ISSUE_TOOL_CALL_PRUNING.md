# Issue: Tool Call Results Not Being Pruned

## Problem

When messages containing tool calls are pruned, the tool call results remain visible in the LLM's context. This defeats the purpose of pruning since the tool output can contain sensitive information that was meant to be removed.

## Root Cause

The plugin's pruning logic operates at two different stages:

1. **`messages.transform` hook**: Operates on plugin `Message` format (with `parts` array)
   - Successfully removes follower messages in the pruned range
   - Replaces anchor message parts with placeholder text

2. **`model-messages.transform` hook**: Operates on final `ModelMessage[]` format sent to LLM
   - Currently only used for gauge injection
   - Does NOT remove tool call results

Tool calls and their results exist in the `ModelMessage[]` format, not in the plugin `Message` format. The conversion from plugin messages to model messages happens between these two hooks, so tool call results are never touched by the pruning logic.

## Evidence

Test case from `/tmp/failed_prune_for_tool_call_result_extended.json`:

1. User asked to prune messages containing sensitive content
2. LLM called `context-bonsai-prune` tool with summary containing test phrase
3. Original message was successfully pruned
4. Tool call result remained visible in context with the phrase "Archived the message that disclosed..."
5. Multiple pruning rounds were needed to finally remove all references

## Attempted Fix

**Commit**: `4f9fd4b40` in `/home/basil/projects/opencode_context_management/opencode/`

Added `experimental.chat.model-messages.transform` hook to OpenCode core that:
- Runs after `MessageV2.toModelMessages()` conversion
- Receives final `ModelMessage[]` array before sending to LLM
- Provides `sessionID` in input for state access

## What's Missing

The plugin needs to implement pruning logic in the `model-messages.transform` hook to:

1. Identify which message IDs are in pruned ranges (using archive metadata)
2. Remove `ModelMessage` entries where the message ID falls within a pruned range
3. Handle tool call results that are part of assistant messages in pruned ranges

## Solution Requirements

Add pruning logic to `experimental.chat.model-messages.transform` hook in `src/index.ts`:

- Access archive metadata to determine pruned ranges
- Filter out `ModelMessage[]` entries with IDs in pruned ranges
- Ensure tool call results are removed along with their parent messages
- Preserve placeholder messages (anchor messages with archive metadata)

## Related Files

- `/home/basil/projects/opencode_context_bonsai_plugin/src/index.ts` - Plugin hooks
- `/home/basil/projects/opencode_context_bonsai_plugin/src/prune.ts` - Prune tool implementation
- `/home/basil/projects/opencode_context_management/opencode/packages/opencode/src/session/prompt.ts` - Hook invocation
- `/tmp/failed_prune_for_tool_call_result_extended.json` - Test case demonstrating the issue
