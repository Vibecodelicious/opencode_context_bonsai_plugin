export declare const getTokenCache: (sessionID: string) => {
    totalTokens: number;
} | null;
export declare const setTokenCache: (sessionID: string, value: {
    totalTokens: number;
} | null) => Map<string, {
    totalTokens: number;
} | null>;
export declare const getModelLimitCache: (sessionID: string) => number | null;
export declare const setModelLimitCache: (sessionID: string, value: number | null) => Map<string, number | null>;
export declare const getIdVisibility: (sessionID: string) => boolean;
export declare const setIdVisibility: (sessionID: string, value: boolean) => Map<string, boolean>;
export declare const getSameStepPrunes: (sessionID: string) => Set<string>;
export declare const setSameStepPrunes: (sessionID: string, value: Set<string>) => Map<string, Set<string>>;
export declare const getTurnCount: (sessionID: string) => number;
export declare const setTurnCount: (sessionID: string, value: number) => Map<string, number>;
export declare const clearSameStepPrunes: (sessionID: string) => void;
export declare const clearSessionState: (sessionID: string) => void;
