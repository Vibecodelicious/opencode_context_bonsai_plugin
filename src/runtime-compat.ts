import type { WithParts } from './test/fixtures'

export const LOAD_MESSAGES_COMPAT_ERROR = 'Compatibility error: unable to load session messages in this runtime.'
export const UPDATE_MESSAGE_COMPAT_ERROR = 'Compatibility error: message updates are unsupported in this runtime.'

export type MessageMutator = (draft: any) => void
export type InjectedUpdater = (ctx: any, id: string, mutate: MessageMutator) => Promise<void>

export type CompatDiagnosticEvent =
  | { type: 'injector_probe'; injector: string; available: boolean }
  | { type: 'injector_probe_error'; injector: string; error: string }
  | { type: 'injector_selected'; injector: string }
  | { type: 'injector_none_selected' }
  | { type: 'injector_invoke_error'; injector: string; error: string }

type CompatDiagnosticHook = (event: CompatDiagnosticEvent) => void

interface UpdateInjector {
  name: string
  isAvailable(runtime: any): boolean
  inject(runtime: any): InjectedUpdater
}

export interface InjectorCandidate {
  name: string
  candidatePaths: string[]
  requiredSymbols: string[]
  injectShape: string
}

export interface RuntimeCompat {
  loadMessages(ctx: any): Promise<WithParts[]>
  updateMessage(ctx: any, id: string, mutate: MessageMutator): Promise<void>
}

function normalizeMessages(messages: any[]): WithParts[] {
  return messages.map((msg: any) => ({
    id: msg.info.id,
    sessionID: msg.info.sessionID,
    role: msg.info.role,
    parts: msg.parts,
    metadata: msg.info.metadata ?? {},
    createdAt: new Date(msg.info.time?.created ?? Date.now())
  }))
}

function isCompatMessage(message: string): boolean {
  return message === LOAD_MESSAGES_COMPAT_ERROR || message === UPDATE_MESSAGE_COMPAT_ERROR
}

export function isRuntimeCompatError(error: unknown): error is Error {
  return error instanceof Error && isCompatMessage(error.message)
}

export function createRuntimeCompat(options?: { injectedUpdater?: InjectedUpdater }): RuntimeCompat {
  const injectedUpdater = options?.injectedUpdater

  return {
    async loadMessages(ctx: any): Promise<WithParts[]> {
      if (ctx?.messages !== undefined) {
        return normalizeMessages(ctx.messages)
      }

      const loadSessionMessages = ctx?.client?.session?.messages
      if (typeof loadSessionMessages === 'function') {
        const response = await loadSessionMessages({ path: { id: ctx.sessionID } })
        const data = response?.data ?? response
        return normalizeMessages(data)
      }

      throw new Error(LOAD_MESSAGES_COMPAT_ERROR)
    },

    async updateMessage(ctx: any, id: string, mutate: MessageMutator): Promise<void> {
      if (ctx?.updateMessage !== undefined) {
        await ctx.updateMessage(id, mutate)
        return
      }

      if (injectedUpdater) {
        await injectedUpdater(ctx, id, mutate)
        return
      }

      throw new Error(UPDATE_MESSAGE_COMPAT_ERROR)
    }
  }
}

type LocatedFunction = { fn: (...args: any[]) => any; owner: any; path: string }

function getPathValue(target: any, path: string): any {
  return path.split('.').reduce((current: any, key) => current?.[key], target)
}

function locateFunction(runtime: any, candidatePaths: string[]): LocatedFunction | undefined {
  for (const path of candidatePaths) {
    const ownerPath = path.split('.').slice(0, -1).join('.')
    const key = path.split('.').at(-1)
    if (!key) continue

    const owner = ownerPath === '' ? runtime : getPathValue(runtime, ownerPath)
    const fn = owner?.[key]
    if (typeof fn === 'function') {
      return { fn, owner, path }
    }
  }

  return undefined
}

export const INJECTOR_CANDIDATES: InjectorCandidate[] = [
  {
    name: 'session.updateMessageAtomic bridge injector',
    candidatePaths: ['internals.session.updateMessageAtomic', 'session.updateMessageAtomic'],
    requiredSymbols: ['updateMessageAtomic', 'sessionID', 'messageID', 'mutate'],
    injectShape: 'Invoke atomic updater with tool-context bridge payload.'
  },
  {
    name: 'session.updateMessage mutate bridge injector',
    candidatePaths: ['internals.session.updateMessage', 'session.updateMessage'],
    requiredSymbols: ['updateMessage', 'sessionID', 'messageID', 'mutate'],
    injectShape: 'Invoke updateMessage with mutate bridge payload.'
  },
  {
    name: 'message-route patch injector',
    candidatePaths: ['internals.messageRoute.patchUpdateMessage', 'messageRoute.patchUpdateMessage'],
    requiredSymbols: ['patchUpdateMessage', 'messageBridge.createMutateBridge'],
    injectShape: 'Patch message-route client using runtime mutate-bridge symbol.'
  }
]

const updateInjectors: UpdateInjector[] = [
  {
    name: INJECTOR_CANDIDATES[0].name,
    isAvailable: runtime => locateFunction(runtime, INJECTOR_CANDIDATES[0].candidatePaths) !== undefined,
    inject: runtime => {
      const located = locateFunction(runtime, INJECTOR_CANDIDATES[0].candidatePaths)
      if (!located) {
        throw new Error('selected injector target disappeared')
      }

      return async (ctx, id, mutate) => {
        await located.fn.call(located.owner, {
          sessionID: ctx.sessionID,
          messageID: id,
          mutate,
          toolContext: ctx
        })
      }
    }
  },
  {
    name: INJECTOR_CANDIDATES[1].name,
    isAvailable: runtime => locateFunction(runtime, INJECTOR_CANDIDATES[1].candidatePaths) !== undefined,
    inject: runtime => {
      const located = locateFunction(runtime, INJECTOR_CANDIDATES[1].candidatePaths)
      if (!located) {
        throw new Error('selected injector target disappeared')
      }

      return async (ctx, id, mutate) => {
        await located.fn.call(located.owner, {
          sessionID: ctx.sessionID,
          messageID: id,
          mutate,
          toolContext: ctx
        })
      }
    }
  },
  {
    name: INJECTOR_CANDIDATES[2].name,
    isAvailable: runtime => {
      const patchTarget = locateFunction(runtime, INJECTOR_CANDIDATES[2].candidatePaths)
      const bridgeFactory = getPathValue(runtime, 'messageBridge.createMutateBridge')
      return patchTarget !== undefined && typeof bridgeFactory === 'function'
    },
    inject: runtime => {
      const patchTarget = locateFunction(runtime, INJECTOR_CANDIDATES[2].candidatePaths)
      const bridgeFactory = getPathValue(runtime, 'messageBridge.createMutateBridge')
      if (!patchTarget || typeof bridgeFactory !== 'function') {
        throw new Error('selected injector target disappeared')
      }

      return async (ctx, id, mutate) => {
        const mutateBridge = bridgeFactory(mutate)
        await patchTarget.fn.call(patchTarget.owner, {
          sessionID: ctx.sessionID,
          messageID: id,
          mutateBridge,
          toolContext: ctx
        })
      }
    }
  }
]

export function buildRuntimeCompat(input: { client?: any; onCompatDiagnostic?: CompatDiagnosticHook }): RuntimeCompat {
  const onCompatDiagnostic = input.onCompatDiagnostic
  let selectedInjector: UpdateInjector | undefined

  for (const injector of updateInjectors) {
    let available = false

    try {
      available = injector.isAvailable(input.client)
    } catch (error) {
      onCompatDiagnostic?.({
        type: 'injector_probe_error',
        injector: injector.name,
        error: error instanceof Error ? error.message : String(error)
      })
      continue
    }

    onCompatDiagnostic?.({ type: 'injector_probe', injector: injector.name, available })

    if (available) {
      selectedInjector = injector
      onCompatDiagnostic?.({ type: 'injector_selected', injector: injector.name })
      break
    }
  }

  if (!selectedInjector) {
    onCompatDiagnostic?.({ type: 'injector_none_selected' })
  }

  const selectedInjectorName = selectedInjector?.name
  const selectedInjectedUpdater = selectedInjector?.inject(input.client)

  const injectedUpdater: InjectedUpdater | undefined =
    selectedInjectedUpdater === undefined
      ? undefined
      : async (ctx, id, mutate) => {
          if (typeof ctx?.sessionID !== 'string') {
            throw new Error(UPDATE_MESSAGE_COMPAT_ERROR)
          }

          if (ctx.sessionID.trim() === '') {
            throw new Error(UPDATE_MESSAGE_COMPAT_ERROR)
          }

          try {
            await selectedInjectedUpdater(ctx, id, mutate)
          } catch (error) {
            onCompatDiagnostic?.({
              type: 'injector_invoke_error',
              injector: selectedInjectorName ?? 'unknown injector',
              error: error instanceof Error ? error.message : String(error)
            })
            throw error
          }
        }

  return createRuntimeCompat({ injectedUpdater })
}
