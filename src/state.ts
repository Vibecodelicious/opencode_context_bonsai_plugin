const tokenCache = new Map<string, {inputTokens: number, outputTokens: number} | null>()
const modelLimitCache = new Map<string, number | null>()
const idVisibility = new Map<string, boolean>()
const sameStepPrunes = new Map<string, Set<string>>()
const turnCount = new Map<string, number>()

export const getTokenCache = (sessionID: string) => tokenCache.get(sessionID) ?? null
export const setTokenCache = (sessionID: string, value: {inputTokens: number, outputTokens: number} | null) => tokenCache.set(sessionID, value)

export const getModelLimitCache = (sessionID: string) => modelLimitCache.get(sessionID) ?? null
export const setModelLimitCache = (sessionID: string, value: number | null) => modelLimitCache.set(sessionID, value)

export const getIdVisibility = (sessionID: string) => idVisibility.get(sessionID) ?? false
export const setIdVisibility = (sessionID: string, value: boolean) => idVisibility.set(sessionID, value)

export const getSameStepPrunes = (sessionID: string) => sameStepPrunes.get(sessionID) ?? new Set<string>()
export const setSameStepPrunes = (sessionID: string, value: Set<string>) => sameStepPrunes.set(sessionID, value)

export const getTurnCount = (sessionID: string) => turnCount.get(sessionID) ?? 0
export const setTurnCount = (sessionID: string, value: number) => turnCount.set(sessionID, value)

export const clearSameStepPrunes = (sessionID: string) => {
  sameStepPrunes.set(sessionID, new Set<string>())
}