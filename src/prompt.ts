export const getSystemPromptGuidance = () => `
# Context Bonsai Plugin - Pruning Guidance

You have access to context-bonsai-prune and context-bonsai-retrieve tools for managing conversation context.

## Two-Phase Prune Flow
1. Phase 1: Call context-bonsai-prune with no arguments to see message IDs and gauge visibility
2. Phase 2: Use pattern selection with summary, index_terms, and optional reason:
   - Pattern mode: from_pattern + to_pattern

## Selector Guidance
- Pattern mode is the primary flow and must resolve to one unique start and end message each.
- Use specific patterns to avoid ambiguity errors.

## Summary Quality
Write 1-3 sentences focusing on decisions made, outcomes reached, and key learnings. Avoid play-by-play descriptions.

## Index Terms
Provide 3-8 keywords covering topics discussed, tools used, files touched, and outcomes achieved.

## Proactive Pruning Triggers
- Completed tasks or project switches
- Multiple gauge readings without pruning action
- Large tool outputs or reference material accumulation
- Completed discussions that can be summarized

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
