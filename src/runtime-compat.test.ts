import { describe, it, expect, mock } from 'bun:test'
import { makeUserMessage, makeAssistantMessage } from './test/fixtures'
import {
  createRuntimeCompat,
  buildRuntimeCompat,
  LOAD_MESSAGES_COMPAT_ERROR,
  UPDATE_MESSAGE_COMPAT_ERROR
} from './runtime-compat'

function toPluginMessage(msg: any) {
  return {
    info: {
      id: msg.id,
      sessionID: msg.sessionID,
      role: msg.role,
      metadata: msg.metadata,
      time: { created: msg.createdAt.getTime() }
    },
    parts: msg.parts
  }
}

describe('runtime compatibility', () => {
  it('loads from ctx.messages first when available', async () => {
    const compat = createRuntimeCompat()
    const messages = [
      makeUserMessage('msg1', 's1', 'hello'),
      makeAssistantMessage('msg2', 's1', 'world')
    ]
    const fallback = mock(async () => {
      throw new Error('should not be called')
    })

    const loaded = await compat.loadMessages({
      sessionID: 's1',
      messages: messages.map(toPluginMessage),
      client: { session: { messages: fallback } }
    } as any)

    expect(loaded.map(msg => msg.id)).toEqual(['msg1', 'msg2'])
    expect(fallback).not.toHaveBeenCalled()
  })

  it('falls back to client.session.messages when ctx.messages is absent', async () => {
    const compat = createRuntimeCompat()
    const messages = [
      makeAssistantMessage('msgB', 's1', 'b'),
      makeUserMessage('msgA', 's1', 'a')
    ]
    const loadSessionMessages = mock(async () => ({ data: messages.map(toPluginMessage) }))

    const loaded = await compat.loadMessages({
      sessionID: 's1',
      client: { session: { messages: loadSessionMessages } }
    } as any)

    expect(loadSessionMessages).toHaveBeenCalledWith({ path: { id: 's1' } })
    expect(loaded.map(msg => msg.id)).toEqual(['msgB', 'msgA'])
  })

  it('returns exact load compatibility error when no read capability exists', async () => {
    const compat = createRuntimeCompat()
    await expect(compat.loadMessages({ sessionID: 's1' } as any)).rejects.toThrow(LOAD_MESSAGES_COMPAT_ERROR)
  })

  it('does not fallback when ctx.messages path is present but throws', async () => {
    const compat = createRuntimeCompat()
    const clientLoader = mock(async () => [])

    await expect(
      compat.loadMessages({
        sessionID: 's1',
        messages: null,
        client: { session: { messages: clientLoader } }
      } as any)
    ).rejects.toThrow('messages.map')

    expect(clientLoader).not.toHaveBeenCalled()
  })

  it('uses native updateMessage before injected updater', async () => {
    const injectedUpdater = mock(async () => {})
    const nativeUpdater = mock(async () => {})
    const compat = createRuntimeCompat({ injectedUpdater })

    await compat.updateMessage({ updateMessage: nativeUpdater } as any, 'msg1', () => {})

    expect(nativeUpdater).toHaveBeenCalledTimes(1)
    expect(injectedUpdater).not.toHaveBeenCalled()
  })

  it('uses injected updater when native updateMessage is absent', async () => {
    const injectedUpdater = mock(async () => {})
    const compat = createRuntimeCompat({ injectedUpdater })

    await compat.updateMessage({ sessionID: 's1' } as any, 'msg1', () => {})

    expect(injectedUpdater).toHaveBeenCalledTimes(1)
  })

  it('returns exact update compatibility error when write capability is unavailable', async () => {
    const compat = createRuntimeCompat()
    await expect(compat.updateMessage({ sessionID: 's1' } as any, 'msg1', () => {})).rejects.toThrow(
      UPDATE_MESSAGE_COMPAT_ERROR
    )
  })

  it('does not fallback when native updateMessage throws', async () => {
    const injectedUpdater = mock(async () => {})
    const compat = createRuntimeCompat({ injectedUpdater })
    const nativeError = new Error('native failure')

    await expect(
      compat.updateMessage(
        {
          updateMessage: async () => {
            throw nativeError
          }
        } as any,
        'msg1',
        () => {}
      )
    ).rejects.toThrow(nativeError.message)

    expect(injectedUpdater).not.toHaveBeenCalled()
  })

  it('builder injects updater from initialization client', async () => {
    const calls: any[] = []
    const atomicUpdater = async (ctx: any, id: string, mutate: (draft: any) => void) => {
      calls.push([ctx, id, mutate])
    }
    const compat = buildRuntimeCompat({ client: { session: { updateMessageAtomic: atomicUpdater } } })

    await compat.updateMessage({ sessionID: 's1' } as any, 'msg1', () => {})

    expect(calls).toHaveLength(1)
    expect(calls[0]?.[0]).toEqual(expect.anything())
    expect(calls[0]?.[1]).toBe('msg1')
    expect(calls[0]?.[2]).toEqual(expect.any(Function))
  })

  it('selects first available adapter deterministically', async () => {
    let atomicCalls = 0
    const updateMessageAtomic = async (_ctx: any, _id: string, _mutate: (draft: any) => void) => {
      atomicCalls += 1
      throw new Error('first signature rejected')
    }
    const updateMessage = mock(async () => {})
    const compat = buildRuntimeCompat({ client: { session: { updateMessageAtomic, updateMessage } } })

    await expect(compat.updateMessage({ sessionID: 's1' } as any, 'msg1', () => {})).rejects.toThrow('first signature rejected')

    expect(atomicCalls).toBe(1)
    expect(updateMessage).not.toHaveBeenCalled()
  })

  it('supports object ctx/id/mutate signature variant', async () => {
    let callArg: any
    const updateMessageAtomic = async ({ ctx, id, mutate }: { ctx: any; id: string; mutate: (draft: any) => void }) => {
      callArg = { ctx, id, mutate }
    }
    const compat = buildRuntimeCompat({
      client: {
        session: {
          updateMessageAtomic
        }
      }
    })

    await compat.updateMessage({ sessionID: 's1' } as any, 'msg1', () => {})

    expect(callArg).toEqual({
      ctx: expect.objectContaining({ sessionID: 's1' }),
      id: 'msg1',
      mutate: expect.any(Function)
    })
  })

  it('supports sessionID/messageID signature variant with deterministic selection', async () => {
    const diagnostics: any[] = []
    let callArg: any
    const updateMessageAtomic = async ({
      sessionID,
      messageID,
      mutate
    }: {
      sessionID: string
      messageID: string
      mutate: (draft: any) => void
    }) => {
      callArg = { sessionID, messageID, mutate }
    }

    const compat = buildRuntimeCompat({
      client: {
        session: {
          updateMessageAtomic
        }
      },
      onCompatDiagnostic: event => diagnostics.push(event)
    })

    await compat.updateMessage({ sessionID: 's1' } as any, 'msg1', () => {})

    expect(diagnostics).toContainEqual({
      type: 'adapter_selected',
      adapter: 'client.session.updateMessageAtomic({ sessionID: ctx.sessionID, messageID: id, mutate })'
    })
    expect(callArg).toEqual({
      sessionID: 's1',
      messageID: 'msg1',
      mutate: expect.any(Function)
    })
  })

  it('supports updateMessage fallback adapters when atomic is unavailable', async () => {
    const updateMessage = mock(async () => {})
    const compat = buildRuntimeCompat({ client: { session: { updateMessage } } })

    await compat.updateMessage({ sessionID: 's1' } as any, 'msg1', () => {})

    expect(updateMessage).toHaveBeenCalledTimes(1)
    expect(updateMessage).toHaveBeenCalledWith({
      ctx: expect.objectContaining({ sessionID: 's1' }),
      id: 'msg1',
      mutate: expect.any(Function)
    })
  })

  it('handles probe exceptions and emits diagnostics', async () => {
    const diagnostics: any[] = []
    const compat = buildRuntimeCompat({
      client: {
        get session() {
          throw new Error('session probe failed')
        }
      },
      onCompatDiagnostic: event => diagnostics.push(event)
    })

    await expect(compat.updateMessage({ sessionID: 's1' } as any, 'msg1', () => {})).rejects.toThrow(UPDATE_MESSAGE_COMPAT_ERROR)

    expect(diagnostics.some(event => event.type === 'adapter_probe_error')).toBeTrue()
    expect(diagnostics.some(event => event.type === 'adapter_none_selected')).toBeTrue()
  })

  it('does not fallback when selected adapter throws and emits invoke diagnostics', async () => {
    const diagnostics: any[] = []
    const atomicUpdater = async (_ctx: any, _id: string, _mutate: (draft: any) => void) => {
      throw new Error('adapter invoke failed')
    }
    const compat = buildRuntimeCompat({
      client: { session: { updateMessageAtomic: atomicUpdater } },
      onCompatDiagnostic: event => diagnostics.push(event)
    })

    await expect(compat.updateMessage({ sessionID: 's1' } as any, 'msg1', () => {})).rejects.toThrow('adapter invoke failed')

    expect(diagnostics).toContainEqual({
      type: 'adapter_invoke_error',
      adapter: 'client.session.updateMessageAtomic(ctx, id, mutate)',
      error: 'adapter invoke failed'
    })
  })

  it('returns exact compatibility error when selected adapter requires missing sessionID', async () => {
    const updateMessageAtomic = async ({ sessionID: _sessionID, messageID: _messageID }: { sessionID: string; messageID: string }) => {}
    const compat = buildRuntimeCompat({
      client: {
        session: {
          updateMessageAtomic
        }
      }
    })

    await expect(compat.updateMessage({} as any, 'msg1', () => {})).rejects.toThrow(UPDATE_MESSAGE_COMPAT_ERROR)
  })

  it('emits adapter probe and selected diagnostics in order', async () => {
    const diagnostics: any[] = []
    const atomicUpdater = async (_ctx: any, _id: string, _mutate: (draft: any) => void) => {}

    const compat = buildRuntimeCompat({
      client: { session: { updateMessageAtomic: atomicUpdater } },
      onCompatDiagnostic: event => diagnostics.push(event)
    })

    await compat.updateMessage({ sessionID: 's1' } as any, 'msg1', () => {})

    expect(diagnostics[0]).toEqual({
      type: 'adapter_probe',
      adapter: 'client.session.updateMessageAtomic(ctx, id, mutate)',
      available: true
    })
    expect(diagnostics[1]).toEqual({
      type: 'adapter_selected',
      adapter: 'client.session.updateMessageAtomic(ctx, id, mutate)'
    })
  })
})
