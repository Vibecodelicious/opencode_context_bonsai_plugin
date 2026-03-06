import type { WithParts } from './test/fixtures'

export const LOAD_MESSAGES_COMPAT_ERROR = 'Compatibility error: unable to load session messages in this runtime.'
export const UPDATE_MESSAGE_COMPAT_ERROR = 'Compatibility error: message updates are unsupported in this runtime.'

export type MessageMutator = (draft: any) => void
export type InjectedUpdater = (ctx: any, id: string, mutate: MessageMutator) => Promise<void>

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

export function buildRuntimeCompat(input: { client?: any }): RuntimeCompat {
  const updateMessageAtomic = input.client?.session?.updateMessageAtomic
  const injectedUpdater: InjectedUpdater | undefined =
    typeof updateMessageAtomic === 'function'
      ? async (ctx, id, mutate) => {
          await updateMessageAtomic(ctx, id, mutate)
        }
      : undefined

  return createRuntimeCompat({ injectedUpdater })
}
