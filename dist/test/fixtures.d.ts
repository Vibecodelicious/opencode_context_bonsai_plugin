import type { Part } from "@opencode-ai/sdk";
export interface WithParts {
    id: string;
    sessionID: string;
    role: 'user' | 'assistant';
    parts: Part[];
    metadata: Record<string, unknown>;
    createdAt: Date;
}
export declare function makeUserMessage(id: string, sessionID: string, text: string, opts?: {
    metadata?: Record<string, unknown>;
}): WithParts;
export declare function makeAssistantMessage(id: string, sessionID: string, text: string, opts?: {
    metadata?: Record<string, unknown>;
}): WithParts;
export declare function makeArchivedMessage(id: string, sessionID: string, pluginID: string, archive: {
    summary: string;
    indexTerms: string[];
    rangeEnd: string;
}): WithParts;
