import { type ToolDefinition } from '@opencode-ai/plugin';
import type { WithParts } from './test/fixtures';
import { type RuntimeCompat } from './runtime-compat';
export declare function resolveToStoredMessage(messages: WithParts[], messageId: string): string;
export declare function createPruneToolDefinition(runtimeCompat: RuntimeCompat): ToolDefinition;
export declare const pruneToolDefinition: ToolDefinition;
