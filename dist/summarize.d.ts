import type { LanguageModel } from 'ai';
import type { WithParts } from './test/fixtures';
export declare function summarizeRange(messages: WithParts[], languageModel: LanguageModel): Promise<{
    summary: string;
    indexTerms: string[];
}>;
