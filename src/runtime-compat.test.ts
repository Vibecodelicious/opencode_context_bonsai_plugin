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
    const atomicUpdater = mock(async () => {})
    const compat = buildRuntimeCompat({ client: { session: { updateMessageAtomic: atomicUpdater } } })

    await compat.updateMessage({ sessionID: 's1' } as any, 'msg1', () => {})

    expect(atomicUpdater).toHaveBeenCalledTimes(1)
  })
})
