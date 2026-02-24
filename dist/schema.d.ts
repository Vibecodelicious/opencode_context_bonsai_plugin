import { z } from "zod";
import type { WithParts } from "./test/fixtures";
export declare const ArchiveSchema: z.ZodObject<{
    archive: z.ZodOptional<z.ZodObject<{
        summary: z.ZodString;
        indexTerms: z.ZodArray<z.ZodString, "many">;
        rangeEnd: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        summary: string;
        indexTerms: string[];
        rangeEnd: string;
    }, {
        summary: string;
        indexTerms: string[];
        rangeEnd: string;
    }>>;
}, "strip", z.ZodTypeAny, {
    archive?: {
        summary: string;
        indexTerms: string[];
        rangeEnd: string;
    } | undefined;
}, {
    archive?: {
        summary: string;
        indexTerms: string[];
        rangeEnd: string;
    } | undefined;
}>;
export declare function getArchive(msg: WithParts, pluginID: string): {
    summary: string;
    indexTerms: string[];
    rangeEnd: string;
} | null;
export declare function hasArchive(msg: WithParts, pluginID: string): boolean;
