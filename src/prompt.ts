export const getSystemPromptGuidance = () => `
# Context Bonsai Plugin - Pruning Guidance

You have access to context-bonsai-prune and context-bonsai-retrieve tools for managing conversation context.

## Two-Phase Prune Flow
1. Phase 1: Call context-bonsai-prune with no arguments to see message IDs and gauge visibility
2. Phase 2: Call context-bonsai-prune with startMessageID, endMessageID, and summary to execute pruning

## Proactive Pruning Triggers
- Completed tasks or project switches
- Multiple gauge readings without pruning action
- Large tool outputs or reference material accumulation
- Completed discussions that can be summarized

## Gauge-Based Escalation Policy
- <30%: No action needed
- 30-50%: Consider pruning if natural breakpoint exists
- 50-80%: Actively seek pruning opportunities
- >80%: Aggressively prune to prevent context overflow

## Content Detection Patterns
- Large tool outputs (file contents, command results)
- Completed discussions with clear outcomes
- Reference material that can be summarized
- Repetitive or redundant information

## Quality Gate
Before pruning, verify that key learnings, decisions, and context are preserved in the summary.

## Loop/Iteration Detection
If similar patterns repeat, summarize the iteration process and outcomes rather than keeping all steps.

## Range Partitioning
- Single range: When content is cohesive and related
- Multiple ranges: When distinct topics or phases can be separated
`