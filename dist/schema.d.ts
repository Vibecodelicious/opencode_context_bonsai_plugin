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
export type ArchiveValue = NonNullable<z.infer<typeof ArchiveSchema>["archive"]>;
export declare function resolveArchiveFromMetadata(metadata: Record<string, unknown> | undefined): {
    archive: ArchiveValue;
    key: string;
} | null;
export declare function getArchive(msg: WithParts): ArchiveValue | null;
export declare function hasArchive(msg: WithParts): boolean;
export declare function getArchiveFromMetadata(metadata: Record<string, unknown> | undefined): ArchiveValue | null;
export declare function setArchiveMetadata(draft: {
    metadata?: Record<string, unknown>;
}, archive: ArchiveValue): void;
export declare function clearArchiveMetadata(draft: {
    metadata?: Record<string, unknown>;
}): void;
