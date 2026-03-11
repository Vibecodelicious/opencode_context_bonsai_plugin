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

  it('classifies marker-tagged context updateMessage as injected path', async () => {
    const diagnostics: any[] = []
    const updater = mock(async () => {})
    ;(updater as any).__contextBonsaiInjected = true
    ;(updater as any).__contextBonsaiInjector = 'injected-test'
    ;(updater as any).__contextBonsaiSource = 'module'
    const compat = createRuntimeCompat({ onCompatDiagnostic: event => diagnostics.push(event) })

    await compat.updateMessage({ updateMessage: updater } as any, 'msg1', () => {})

    expect(diagnostics).toContainEqual({
      type: 'update_path',
      path: 'injectedUpdater',
      injector: 'injected-test',
      source: 'module'
    })
  })

  it('selects module injector first and emits source metadata', async () => {
    const diagnostics: any[] = []
    const atomic = mock(async () => {})
    const compat = await buildRuntimeCompat({
      client: {},
      resolveInternal: specifier => {
        if (specifier === '@opencode-ai/opencode/session') {
          return { Session: { updateMessageAtomic: atomic } }
        }
        throw new Error(`cannot load ${specifier}`)
      },
      onCompatDiagnostic: event => diagnostics.push(event)
    })

    await compat.updateMessage({ sessionID: 's1' } as any, 'msg1', () => {})

    expect(atomic).toHaveBeenCalledTimes(1)
    expect(diagnostics).toContainEqual({
      type: 'injector_source',
      injector: 'module:Session.updateMessageAtomic(@opencode-ai/opencode/session)',
      source: 'module',
      specifier: '@opencode-ai/opencode/session',
      exportPath: 'Session.updateMessageAtomic'
    })
    expect(diagnostics).toContainEqual({
      type: 'update_path',
      path: 'injectedUpdater',
      injector: 'module:Session.updateMessageAtomic(@opencode-ai/opencode/session)',
      source: 'module'
    })
  })

  it('injects ctx.updateMessage at execute-time through registry patch', async () => {
    const diagnostics: any[] = []
    const atomic = mock(async () => {})
    const registryModule = {
      fromPlugin(plugin: any) {
        return {
          execute(args: any, ctx: any) {
            return plugin.execute(args, ctx)
          }
        }
      }
    }

    const compat = await buildRuntimeCompat({
      client: {},
      resolveInternal: specifier => {
        if (specifier === '@opencode-ai/opencode/session') {
          return { Session: { updateMessageAtomic: atomic } }
        }
        if (specifier === '@opencode-ai/opencode/tool/registry') {
          return registryModule
        }
        throw new Error('module missing')
      },
      onCompatDiagnostic: event => diagnostics.push(event)
    })

    const tool = registryModule.fromPlugin({
      execute: async (_args: any, ctx: any) => {
        await compat.updateMessage(ctx, 'msg1', () => {})
      }
    })

    const ctx: any = { sessionID: 's1' }
    await tool.execute({}, ctx)

    expect(typeof ctx.updateMessage).toBe('function')
    expect((ctx.updateMessage as any).__contextBonsaiInjected).toBe(true)
    expect(atomic).toHaveBeenCalledTimes(1)
    expect(diagnostics).toContainEqual({
      type: 'update_path',
      path: 'injectedUpdater',
      injector: 'module:Session.updateMessageAtomic(@opencode-ai/opencode/session)',
      source: 'module'
    })
  })

  it('falls back to object-path probing when module probes miss', async () => {
    const diagnostics: any[] = []
    const updateMessage = mock(async () => {})
    const compat = await buildRuntimeCompat({
      client: { session: { updateMessage } },
      resolveInternal: () => {
        const error: any = new Error('module missing')
        error.code = 'ERR_MODULE_NOT_FOUND'
        throw error
      },
      onCompatDiagnostic: event => diagnostics.push(event)
    })

    await compat.updateMessage({ sessionID: 's1' } as any, 'msg1', () => {})

    expect(updateMessage).toHaveBeenCalledTimes(1)
    expect(diagnostics).toContainEqual({
      type: 'injector_selected',
      injector: INJECTOR_CANDIDATES[1].name
    })
    expect(diagnostics).toContainEqual({
      type: 'injector_source',
      injector: INJECTOR_CANDIDATES[1].name,
      source: 'object-path'
    })
  })

  it('continues probing after adapter_build_failed and still constructs compat', async () => {
    const diagnostics: any[] = []
    const updateMessage = mock(async () => {})
    const compat = await buildRuntimeCompat({
      client: { session: { updateMessage } },
      resolveInternal: specifier => {
        if (specifier === '@opencode-ai/opencode/message-route') {
          return { MessageRoute: { patchUpdateMessage: async () => {} } }
        }
        const error: any = new Error('module missing')
        error.code = 'ERR_MODULE_NOT_FOUND'
        throw error
      },
      onCompatDiagnostic: event => diagnostics.push(event)
    })

    await compat.updateMessage({ sessionID: 's1' } as any, 'msg1', () => {})

    expect(updateMessage).toHaveBeenCalledTimes(1)
    const buildFailedEvents = diagnostics.filter(event =>
      event.type === 'injector_probe_error' && String(event.error).includes('adapter_build_failed')
    )
    expect(buildFailedEvents.length).toBeGreaterThan(0)
  })

  it('returns exact compatibility update error when no injector is available', async () => {
    const diagnostics: any[] = []
    const compat = await buildRuntimeCompat({
      client: {},
      resolveInternal: () => {
        const error: any = new Error('module missing')
        error.code = 'ERR_MODULE_NOT_FOUND'
        throw error
      },
      onCompatDiagnostic: event => diagnostics.push(event)
    })

    await expect(compat.updateMessage({ sessionID: 's1' } as any, 'msg1', () => {})).rejects.toThrow(UPDATE_MESSAGE_COMPAT_ERROR)
    expect(diagnostics).toContainEqual({ type: 'injector_none_selected' })
  })

  it('caches selected injector at construction and does not re-probe', async () => {
    const diagnostics: any[] = []
    const updateMessage = mock(async () => {})
    const updateMessageAtomic = mock(async () => {})
    const client: any = { session: { updateMessage } }
    const compat = await buildRuntimeCompat({
      client,
      resolveInternal: () => {
        const error: any = new Error('module missing')
        error.code = 'ERR_MODULE_NOT_FOUND'
        throw error
      },
      onCompatDiagnostic: event => diagnostics.push(event)
    })

    client.session.updateMessageAtomic = updateMessageAtomic

    await compat.updateMessage({ sessionID: 's1' } as any, 'msg1', () => {})
    await compat.updateMessage({ sessionID: 's1' } as any, 'msg2', () => {})

    expect(updateMessage).toHaveBeenCalledTimes(2)
    expect(updateMessageAtomic).not.toHaveBeenCalled()
    expect(diagnostics.filter(event => event.type === 'injector_selected')).toHaveLength(1)
  })

  it('rejects missing or empty sessionID in injected path', async () => {
    const atomic = mock(async () => {})
    const compat = await buildRuntimeCompat({
      client: {},
      resolveInternal: specifier => {
        if (specifier === '@opencode-ai/opencode/session') {
          return { Session: { updateMessageAtomic: atomic } }
        }
        throw new Error('module missing')
      }
    })

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
    const compat = await buildRuntimeCompat({
      client: { session: { updateMessage } },
      resolveInternal: specifier => {
        if (specifier === '@opencode-ai/opencode/session') {
          return { Session: { updateMessageAtomic } }
        }
        throw new Error('module missing')
      },
      onCompatDiagnostic: event => diagnostics.push(event)
    })

    await expect(compat.updateMessage({ sessionID: 's1' } as any, 'msg1', () => {})).rejects.toThrow('atomic failed')

    expect(updateMessage).not.toHaveBeenCalled()
    expect(diagnostics).toContainEqual({
      type: 'injector_invoke_error',
      injector: 'module:Session.updateMessageAtomic(@opencode-ai/opencode/session)',
      error: 'adapter_invoke_failed: atomic failed'
    })
  })
})
