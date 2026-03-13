import { describe, it, expect, mock } from 'bun:test'
import { makeUserMessage, makeAssistantMessage } from './test/fixtures'
import {
  createRuntimeCompat,
  buildRuntimeCompat,
  INJECTOR_CANDIDATES,
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

  it('uses native updateMessage before injected updater', async () => {
    const injectedUpdater = mock(async () => {})
    const nativeUpdater = mock(async () => {})
    const compat = createRuntimeCompat({ injectedUpdater })

    await compat.updateMessage({ updateMessage: nativeUpdater } as any, 'msg1', () => {})

    expect(nativeUpdater).toHaveBeenCalledTimes(1)
    expect(injectedUpdater).not.toHaveBeenCalled()
  })

  it('selects first injector family and emits injector diagnostics', async () => {
    const diagnostics: any[] = []
    const atomic = mock(async () => {})
    const compat = buildRuntimeCompat({
      client: { session: { updateMessageAtomic: atomic } },
      onCompatDiagnostic: event => diagnostics.push(event)
    })

    await compat.updateMessage({ sessionID: 's1' } as any, 'msg1', () => {})

    expect(atomic).toHaveBeenCalledTimes(1)
    expect(atomic).toHaveBeenCalledWith({
      sessionID: 's1',
      messageID: 'msg1',
      mutate: expect.any(Function),
      toolContext: expect.anything()
    })
    expect(diagnostics).toContainEqual({
      type: 'injector_selected',
      injector: INJECTOR_CANDIDATES[0].name
    })
  })

  it('falls through to second injector family when first is unavailable', async () => {
    const diagnostics: any[] = []
    const updateMessage = mock(async () => {})
    const compat = buildRuntimeCompat({
      client: { session: { updateMessage } },
      onCompatDiagnostic: event => diagnostics.push(event)
    })

    await compat.updateMessage({ sessionID: 's1' } as any, 'msg1', () => {})

    expect(updateMessage).toHaveBeenCalledTimes(1)
    expect(diagnostics).toContainEqual({
      type: 'injector_probe',
      injector: INJECTOR_CANDIDATES[0].name,
      available: false
    })
    expect(diagnostics).toContainEqual({
      type: 'injector_selected',
      injector: INJECTOR_CANDIDATES[1].name
    })
  })

  it('selects third injector family when first two are unavailable', async () => {
    const diagnostics: any[] = []
    const patchUpdateMessage = mock(async () => {})
    const createMutateBridge = mock((mutate: any) => mutate)
    const compat = buildRuntimeCompat({
      client: {
        messageRoute: { patchUpdateMessage },
        messageBridge: { createMutateBridge }
      },
      onCompatDiagnostic: event => diagnostics.push(event)
    })

    await compat.updateMessage({ sessionID: 's1' } as any, 'msg1', () => {})

    expect(createMutateBridge).toHaveBeenCalledTimes(1)
    expect(patchUpdateMessage).toHaveBeenCalledTimes(1)
    expect(diagnostics).toContainEqual({
      type: 'injector_selected',
      injector: INJECTOR_CANDIDATES[2].name
    })
  })

  it('continues probing when early injector probe throws', async () => {
    const diagnostics: any[] = []
    const updateMessage = mock(async () => {})
    const internalsSession = {
      get updateMessageAtomic() {
        throw new Error('boom during probe')
      },
      updateMessage
    }
    const compat = buildRuntimeCompat({
      client: {
        internals: { session: internalsSession },
        session: { updateMessage }
      },
      onCompatDiagnostic: event => diagnostics.push(event)
    })

    await compat.updateMessage({ sessionID: 's1' } as any, 'msg1', () => {})

    expect(updateMessage).toHaveBeenCalledTimes(1)
    expect(diagnostics).toContainEqual({
      type: 'injector_probe_error',
      injector: INJECTOR_CANDIDATES[0].name,
      error: 'boom during probe'
    })
    expect(diagnostics).toContainEqual({
      type: 'injector_selected',
      injector: INJECTOR_CANDIDATES[1].name
    })
  })

  it('returns exact compatibility update error when no injector is available', async () => {
    const diagnostics: any[] = []
    const compat = buildRuntimeCompat({ client: {}, onCompatDiagnostic: event => diagnostics.push(event) })

    await expect(compat.updateMessage({ sessionID: 's1' } as any, 'msg1', () => {})).rejects.toThrow(UPDATE_MESSAGE_COMPAT_ERROR)

    expect(diagnostics).toContainEqual({ type: 'injector_none_selected' })
  })

  it('caches selected injector at construction and does not re-probe', async () => {
    const diagnostics: any[] = []
    const updateMessage = mock(async () => {})
    const updateMessageAtomic = mock(async () => {})
    const client: any = { session: { updateMessage } }
    const compat = buildRuntimeCompat({ client, onCompatDiagnostic: event => diagnostics.push(event) })

    client.session.updateMessageAtomic = updateMessageAtomic

    await compat.updateMessage({ sessionID: 's1' } as any, 'msg1', () => {})
    await compat.updateMessage({ sessionID: 's1' } as any, 'msg2', () => {})

    expect(updateMessage).toHaveBeenCalledTimes(2)
    expect(updateMessageAtomic).not.toHaveBeenCalled()
    expect(diagnostics.filter(event => event.type === 'injector_selected')).toHaveLength(1)
    expect(diagnostics.filter(event => event.type === 'injector_probe')).toHaveLength(2)
  })

  it('rejects missing or empty sessionID in injected path', async () => {
    const atomic = mock(async () => {})
    const compat = buildRuntimeCompat({ client: { session: { updateMessageAtomic: atomic } } })

    await expect(compat.updateMessage({} as any, 'msg1', () => {})).rejects.toThrow(UPDATE_MESSAGE_COMPAT_ERROR)
    await expect(compat.updateMessage({ sessionID: '   ' } as any, 'msg1', () => {})).rejects.toThrow(UPDATE_MESSAGE_COMPAT_ERROR)
    expect(atomic).not.toHaveBeenCalled()
  })

  it('does not fallback after selected injected updater throws', async () => {
    const diagnostics: any[] = []
    const atomicError = new Error('atomic failed')
    const updateMessageAtomic = mock(async () => {
      throw atomicError
    })
    const updateMessage = mock(async () => {})
    const compat = buildRuntimeCompat({
      client: { session: { updateMessageAtomic, updateMessage } },
      onCompatDiagnostic: event => diagnostics.push(event)
    })

    await expect(compat.updateMessage({ sessionID: 's1' } as any, 'msg1', () => {})).rejects.toThrow('atomic failed')

    expect(updateMessage).not.toHaveBeenCalled()
    expect(diagnostics).toContainEqual({
      type: 'injector_invoke_error',
      injector: INJECTOR_CANDIDATES[0].name,
      error: 'atomic failed'
    })
  })
})
