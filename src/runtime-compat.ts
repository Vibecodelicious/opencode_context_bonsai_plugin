import type { WithParts } from './test/fixtures'

export const LOAD_MESSAGES_COMPAT_ERROR = 'Compatibility error: unable to load session messages in this runtime.'
export const UPDATE_MESSAGE_COMPAT_ERROR = 'Compatibility error: message updates are unsupported in this runtime.'

export type MessageMutator = (draft: any) => void
export type InjectedUpdater = (ctx: any, id: string, mutate: MessageMutator) => Promise<void>

export type CompatDiagnosticEvent =
  | { type: 'adapter_probe'; adapter: string; available: boolean }
  | { type: 'adapter_probe_error'; adapter: string; error: string }
  | { type: 'adapter_selected'; adapter: string }
  | { type: 'adapter_none_selected' }
  | { type: 'adapter_invoke_error'; adapter: string; error: string }

type CompatDiagnosticHook = (event: CompatDiagnosticEvent) => void

interface UpdateAdapter {
  name: string
  isAvailable(client: any): boolean
  requiresSessionID?: boolean
  invoke(args: { client: any; ctx: any; id: string; mutate: MessageMutator }): Promise<void>
}

function hasUpdateMethod(client: any, method: 'updateMessageAtomic' | 'updateMessage'): boolean {
  return !!client?.session && typeof client.session[method] === 'function'
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

const updateAdapters: UpdateAdapter[] = [
  {
    name: 'client.session.updateMessageAtomic(ctx, id, mutate)',
    isAvailable: (client: any) => hasUpdateMethod(client, 'updateMessageAtomic'),
    invoke: async ({ client, ctx, id, mutate }) => {
      await client.session.updateMessageAtomic(ctx, id, mutate)
    }
  },
  {
    name: 'client.session.updateMessageAtomic({ ctx, id, mutate })',
    isAvailable: (client: any) => hasUpdateMethod(client, 'updateMessageAtomic'),
    invoke: async ({ client, ctx, id, mutate }) => {
      await client.session.updateMessageAtomic({ ctx, id, mutate })
    }
  },
  {
    name: 'client.session.updateMessageAtomic({ sessionID: ctx.sessionID, messageID: id, mutate })',
    isAvailable: (client: any) => hasUpdateMethod(client, 'updateMessageAtomic'),
    requiresSessionID: true,
    invoke: async ({ client, ctx, id, mutate }) => {
      await client.session.updateMessageAtomic({ sessionID: ctx.sessionID, messageID: id, mutate })
    }
  },
  {
    name: 'client.session.updateMessage({ ctx, id, mutate })',
    isAvailable: (client: any) => hasUpdateMethod(client, 'updateMessage'),
    invoke: async ({ client, ctx, id, mutate }) => {
      await client.session.updateMessage({ ctx, id, mutate })
    }
  },
  {
    name: 'client.session.updateMessage({ sessionID: ctx.sessionID, messageID: id, mutate })',
    isAvailable: (client: any) => hasUpdateMethod(client, 'updateMessage'),
    requiresSessionID: true,
    invoke: async ({ client, ctx, id, mutate }) => {
      await client.session.updateMessage({ sessionID: ctx.sessionID, messageID: id, mutate })
    }
  }
]

export function buildRuntimeCompat(input: { client?: any; onCompatDiagnostic?: CompatDiagnosticHook }): RuntimeCompat {
  const onCompatDiagnostic = input.onCompatDiagnostic
  let selectedAdapter: UpdateAdapter | undefined

  for (const adapter of updateAdapters) {
    let available = false

    try {
      available = adapter.isAvailable(input.client)
    } catch (error) {
      onCompatDiagnostic?.({
        type: 'adapter_probe_error',
        adapter: adapter.name,
        error: error instanceof Error ? error.message : String(error)
      })
      continue
    }

    onCompatDiagnostic?.({ type: 'adapter_probe', adapter: adapter.name, available })

    if (available) {
      selectedAdapter = adapter
      onCompatDiagnostic?.({ type: 'adapter_selected', adapter: adapter.name })
      break
    }
  }

  if (!selectedAdapter) {
    onCompatDiagnostic?.({ type: 'adapter_none_selected' })
  }

  const injectedUpdater: InjectedUpdater | undefined =
    selectedAdapter === undefined
      ? undefined
      : async (ctx, id, mutate) => {
          if (selectedAdapter.requiresSessionID && typeof ctx?.sessionID !== 'string') {
            throw new Error(UPDATE_MESSAGE_COMPAT_ERROR)
          }

          if (selectedAdapter.requiresSessionID && ctx.sessionID.trim() === '') {
            throw new Error(UPDATE_MESSAGE_COMPAT_ERROR)
          }

          try {
            await selectedAdapter.invoke({ client: input.client, ctx, id, mutate })
          } catch (error) {
            onCompatDiagnostic?.({
              type: 'adapter_invoke_error',
              adapter: selectedAdapter.name,
              error: error instanceof Error ? error.message : String(error)
            })
            throw error
          }
        }

  return createRuntimeCompat({ injectedUpdater })
}
