import type { Part, ToolPart, FilePart } from "@opencode-ai/sdk/v2";
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
export declare function createFilePart(id: string): FilePart;
export declare function createToolPart(id: string, attachmentCount: number): ToolPart;
export declare function createAssistantWithAttachments(id: string, sessionID: string, attachmentCount: number): WithParts;
export declare function createSyntheticWrapperScenario(): WithParts[];
