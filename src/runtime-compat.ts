import type { WithParts } from './test/fixtures'

export const LOAD_MESSAGES_COMPAT_ERROR = 'Compatibility error: unable to load session messages in this runtime.'
export const UPDATE_MESSAGE_COMPAT_ERROR = 'Compatibility error: message updates are unsupported in this runtime.'

export type MessageMutator = (draft: any) => void
export type InjectedUpdater = (ctx: any, id: string, mutate: MessageMutator) => Promise<void>
export type InjectorSource = 'module' | 'object-path'

const INJECTED_CONTEXT_MARKER = '__contextBonsaiInjected'
const INJECTED_CONTEXT_INJECTOR = '__contextBonsaiInjector'
const INJECTED_CONTEXT_SOURCE = '__contextBonsaiSource'

export type CompatDiagnosticEvent =
  | { type: 'injector_targets'; injector: string; targets: Array<{ path: string; kind: string }> }
  | { type: 'injector_probe'; injector: string; available: boolean }
  | { type: 'injector_probe_error'; injector: string; error: string }
  | { type: 'injector_selected'; injector: string }
  | { type: 'injector_source'; injector: string; source: InjectorSource; specifier?: string; exportPath?: string }
  | { type: 'injector_none_selected' }
  | { type: 'injector_invoke_error'; injector: string; error: string }
  | { type: 'update_path'; path: 'ctx.updateMessage' | 'injectedUpdater' | 'unsupported'; injector?: string; source?: InjectorSource }

type CompatDiagnosticHook = (event: CompatDiagnosticEvent) => void

interface ObjectPathInjector {
  name: string
  isAvailable(runtime: any): boolean
  inject(runtime: any): RawInjectedUpdater
}

type RawInjectedUpdater = (ctx: any, id: string, mutate: MessageMutator) => Promise<void>

interface SelectedInjector {
  name: string
  source: InjectorSource
  specifier?: string
  exportPath?: string
  updater: RawInjectedUpdater
}

interface BuildRuntimeCompatInput {
  client?: any
  onCompatDiagnostic?: CompatDiagnosticHook
  resolveInternal?: (specifier: string) => Promise<any> | any
}

interface ModuleProbeCandidate {
  name: string
  specifier: string
  exportPath: string
  bridgePath?: string
  createUpdater(args: {
    targetFn: (...args: any[]) => any
    targetOwner: any
    bridgeFactory?: (...args: any[]) => any
  }): RawInjectedUpdater
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

export function createRuntimeCompat(options?: {
  injectedUpdater?: InjectedUpdater
  injectedUpdaterMeta?: { injector: string; source: InjectorSource }
  onCompatDiagnostic?: CompatDiagnosticHook
}): RuntimeCompat {
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
      const contextUpdater = ctx?.updateMessage

      if (typeof contextUpdater === 'function') {
        const isInjected = (contextUpdater as any)?.[INJECTED_CONTEXT_MARKER] === true
        const markerInjector = isInjected ? (contextUpdater as any)?.[INJECTED_CONTEXT_INJECTOR] : undefined
        const markerSource = isInjected ? (contextUpdater as any)?.[INJECTED_CONTEXT_SOURCE] : undefined

        if (isInjected) {
          options?.onCompatDiagnostic?.({
            type: 'update_path',
            path: 'injectedUpdater',
            injector: typeof markerInjector === 'string' ? markerInjector : undefined,
            source: markerSource === 'module' || markerSource === 'object-path' ? markerSource : undefined
          })
        } else {
          options?.onCompatDiagnostic?.({ type: 'update_path', path: 'ctx.updateMessage' })
        }

        await contextUpdater(id, mutate)
        return
      }

      if (injectedUpdater) {
        options?.onCompatDiagnostic?.({
          type: 'update_path',
          path: 'injectedUpdater',
          injector: options.injectedUpdaterMeta?.injector,
          source: options.injectedUpdaterMeta?.source
        })
        await injectedUpdater(ctx, id, mutate)
        return
      }

      options?.onCompatDiagnostic?.({ type: 'update_path', path: 'unsupported' })
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

function markInjectedContextUpdater(fn: Function, injector: string, source: InjectorSource): void {
  Object.defineProperty(fn, INJECTED_CONTEXT_MARKER, {
    value: true,
    enumerable: false,
    configurable: false,
    writable: false
  })
  Object.defineProperty(fn, INJECTED_CONTEXT_INJECTOR, {
    value: injector,
    enumerable: false,
    configurable: false,
    writable: false
  })
  Object.defineProperty(fn, INJECTED_CONTEXT_SOURCE, {
    value: source,
    enumerable: false,
    configurable: false,
    writable: false
  })
}

function isModuleNotFoundError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const anyError = error as any
  return anyError?.code === 'ERR_MODULE_NOT_FOUND' || anyError?.code === 'MODULE_NOT_FOUND'
}

function normalizeProbeError(classification: string, error?: unknown): string {
  if (error instanceof Error) {
    return `${classification}: ${error.message}`
  }
  if (error !== undefined) {
    return `${classification}: ${String(error)}`
  }
  return classification
}

function getModuleRoots(moduleNamespace: any): any[] {
  const roots: any[] = []
  if (moduleNamespace !== undefined) {
    roots.push(moduleNamespace)
    if (moduleNamespace?.default !== undefined) {
      roots.push(moduleNamespace.default)
    }
  }
  return roots
}

function defaultResolveInternal(specifier: string): Promise<any> {
  const importer = new Function('target', 'return import(target)') as (target: string) => Promise<any>
  return importer(specifier)
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

const MODULE_INJECTOR_CANDIDATES: ModuleProbeCandidate[] = [
  {
    name: 'module:Session.updateMessageAtomic(@opencode-ai/opencode/session)',
    specifier: '@opencode-ai/opencode/session',
    exportPath: 'Session.updateMessageAtomic',
    createUpdater: ({ targetFn, targetOwner }) => async (ctx, id, mutate) => {
      await targetFn.call(targetOwner, { sessionID: ctx.sessionID, messageID: id, mutate, toolContext: ctx })
    }
  },
  {
    name: 'module:Session.updateMessageAtomic(@opencode-ai/opencode/session/index)',
    specifier: '@opencode-ai/opencode/session/index',
    exportPath: 'Session.updateMessageAtomic',
    createUpdater: ({ targetFn, targetOwner }) => async (ctx, id, mutate) => {
      await targetFn.call(targetOwner, { sessionID: ctx.sessionID, messageID: id, mutate, toolContext: ctx })
    }
  },
  {
    name: 'module:Session.updateMessageAtomic(opencode/session)',
    specifier: 'opencode/session',
    exportPath: 'Session.updateMessageAtomic',
    createUpdater: ({ targetFn, targetOwner }) => async (ctx, id, mutate) => {
      await targetFn.call(targetOwner, { sessionID: ctx.sessionID, messageID: id, mutate, toolContext: ctx })
    }
  },
  {
    name: 'module:Session.updateMessageAtomic(opencode/session/index)',
    specifier: 'opencode/session/index',
    exportPath: 'Session.updateMessageAtomic',
    createUpdater: ({ targetFn, targetOwner }) => async (ctx, id, mutate) => {
      await targetFn.call(targetOwner, { sessionID: ctx.sessionID, messageID: id, mutate, toolContext: ctx })
    }
  },
  {
    name: 'module:Session.updateMessage(@opencode-ai/opencode/session)',
    specifier: '@opencode-ai/opencode/session',
    exportPath: 'Session.updateMessage',
    createUpdater: ({ targetFn, targetOwner }) => async (ctx, id, mutate) => {
      await targetFn.call(targetOwner, { sessionID: ctx.sessionID, messageID: id, mutate, toolContext: ctx })
    }
  },
  {
    name: 'module:Session.updateMessage(@opencode-ai/opencode/session/index)',
    specifier: '@opencode-ai/opencode/session/index',
    exportPath: 'Session.updateMessage',
    createUpdater: ({ targetFn, targetOwner }) => async (ctx, id, mutate) => {
      await targetFn.call(targetOwner, { sessionID: ctx.sessionID, messageID: id, mutate, toolContext: ctx })
    }
  },
  {
    name: 'module:Session.updateMessage(opencode/session)',
    specifier: 'opencode/session',
    exportPath: 'Session.updateMessage',
    createUpdater: ({ targetFn, targetOwner }) => async (ctx, id, mutate) => {
      await targetFn.call(targetOwner, { sessionID: ctx.sessionID, messageID: id, mutate, toolContext: ctx })
    }
  },
  {
    name: 'module:Session.updateMessage(opencode/session/index)',
    specifier: 'opencode/session/index',
    exportPath: 'Session.updateMessage',
    createUpdater: ({ targetFn, targetOwner }) => async (ctx, id, mutate) => {
      await targetFn.call(targetOwner, { sessionID: ctx.sessionID, messageID: id, mutate, toolContext: ctx })
    }
  },
  {
    name: 'module:MessageRoute.patchUpdateMessage(@opencode-ai/opencode/message-route)',
    specifier: '@opencode-ai/opencode/message-route',
    exportPath: 'MessageRoute.patchUpdateMessage',
    bridgePath: 'MessageBridge.createMutateBridge',
    createUpdater: ({ targetFn, targetOwner, bridgeFactory }) => {
      if (typeof bridgeFactory !== 'function') {
        throw new Error('missing MessageBridge.createMutateBridge')
      }
      return async (ctx, id, mutate) => {
        const mutateBridge = bridgeFactory(mutate)
        await targetFn.call(targetOwner, {
          sessionID: ctx.sessionID,
          messageID: id,
          mutateBridge,
          toolContext: ctx
        })
      }
    }
  },
  {
    name: 'module:MessageRoute.patchUpdateMessage(opencode/message-route)',
    specifier: 'opencode/message-route',
    exportPath: 'MessageRoute.patchUpdateMessage',
    bridgePath: 'MessageBridge.createMutateBridge',
    createUpdater: ({ targetFn, targetOwner, bridgeFactory }) => {
      if (typeof bridgeFactory !== 'function') {
        throw new Error('missing MessageBridge.createMutateBridge')
      }
      return async (ctx, id, mutate) => {
        const mutateBridge = bridgeFactory(mutate)
        await targetFn.call(targetOwner, {
          sessionID: ctx.sessionID,
          messageID: id,
          mutateBridge,
          toolContext: ctx
        })
      }
    }
  }
]

const REGISTRY_PATCH_TARGETS = [
  { specifier: '@opencode-ai/opencode/tool/registry', exportPath: 'PluginToolRegistry.fromPlugin' },
  { specifier: '@opencode-ai/opencode/tool/registry', exportPath: 'fromPlugin' },
  { specifier: 'opencode/tool/registry', exportPath: 'PluginToolRegistry.fromPlugin' },
  { specifier: 'opencode/tool/registry', exportPath: 'fromPlugin' }
] as const

const updateInjectors: ObjectPathInjector[] = [
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

const registryPatchState: {
  patched: boolean
  original?: (...args: any[]) => any
  target?: (...args: any[]) => any
} = {
  patched: false
}

async function selectModuleInjector(input: BuildRuntimeCompatInput): Promise<SelectedInjector | undefined> {
  const resolveInternal = input.resolveInternal ?? defaultResolveInternal
  const moduleCache = new Map<string, any>()

  for (const candidate of MODULE_INJECTOR_CANDIDATES) {
    input.onCompatDiagnostic?.({
      type: 'injector_targets',
      injector: candidate.name,
      targets: [{ path: `${candidate.specifier}:${candidate.exportPath}`, kind: 'module-probe' }]
    })

    let moduleNamespace: any
    if (moduleCache.has(candidate.specifier)) {
      moduleNamespace = moduleCache.get(candidate.specifier)
    } else {
      try {
        moduleNamespace = await resolveInternal(candidate.specifier)
        moduleCache.set(candidate.specifier, moduleNamespace)
      } catch (error) {
        const classification = isModuleNotFoundError(error) ? 'module_not_found' : 'module_not_found'
        input.onCompatDiagnostic?.({
          type: 'injector_probe_error',
          injector: candidate.name,
          error: normalizeProbeError(classification, error)
        })
        input.onCompatDiagnostic?.({ type: 'injector_probe', injector: candidate.name, available: false })
        continue
      }
    }

    const roots = getModuleRoots(moduleNamespace)
    let targetFn: ((...args: any[]) => any) | undefined
    let targetOwner: any
    let bridgeFactory: ((...args: any[]) => any) | undefined

    for (const root of roots) {
      const located = locateFunction(root, [candidate.exportPath])
      if (!located) {
        continue
      }
      targetFn = located.fn
      targetOwner = located.owner
      bridgeFactory = candidate.bridgePath ? getPathValue(root, candidate.bridgePath) : undefined
      break
    }

    if (!targetFn) {
      input.onCompatDiagnostic?.({
        type: 'injector_probe_error',
        injector: candidate.name,
        error: normalizeProbeError('export_path_missing', `${candidate.specifier}:${candidate.exportPath}`)
      })
      input.onCompatDiagnostic?.({ type: 'injector_probe', injector: candidate.name, available: false })
      continue
    }

    let updater: RawInjectedUpdater
    try {
      updater = candidate.createUpdater({ targetFn, targetOwner, bridgeFactory })
    } catch (error) {
      input.onCompatDiagnostic?.({
        type: 'injector_probe_error',
        injector: candidate.name,
        error: normalizeProbeError('adapter_build_failed', error)
      })
      input.onCompatDiagnostic?.({ type: 'injector_probe', injector: candidate.name, available: false })
      continue
    }

    input.onCompatDiagnostic?.({ type: 'injector_probe', injector: candidate.name, available: true })
    input.onCompatDiagnostic?.({ type: 'injector_selected', injector: candidate.name })
    input.onCompatDiagnostic?.({
      type: 'injector_source',
      injector: candidate.name,
      source: 'module',
      specifier: candidate.specifier,
      exportPath: candidate.exportPath
    })

    return {
      name: candidate.name,
      source: 'module',
      specifier: candidate.specifier,
      exportPath: candidate.exportPath,
      updater
    }
  }

  return undefined
}

function selectObjectPathInjector(input: BuildRuntimeCompatInput): SelectedInjector | undefined {
  const onCompatDiagnostic = input.onCompatDiagnostic
  let selectedInjector: ObjectPathInjector | undefined

  for (const injector of updateInjectors) {
    const candidate = INJECTOR_CANDIDATES.find(item => item.name === injector.name)
    if (candidate) {
      const targets = candidate.candidatePaths.map(path => {
        let kind = 'undefined'
        try {
          const value = getPathValue(input.client, path)
          kind = value === undefined ? 'undefined' : typeof value
        } catch (error) {
          kind = `throws:${error instanceof Error ? error.message : String(error)}`
        }
        return { path, kind }
      })
      if (candidate.name === INJECTOR_CANDIDATES[2].name) {
        let bridgeKind = 'undefined'
        try {
          const bridgeFactory = getPathValue(input.client, 'messageBridge.createMutateBridge')
          bridgeKind = bridgeFactory === undefined ? 'undefined' : typeof bridgeFactory
        } catch (error) {
          bridgeKind = `throws:${error instanceof Error ? error.message : String(error)}`
        }
        targets.push({
          path: 'messageBridge.createMutateBridge',
          kind: bridgeKind,
        })
      }
      onCompatDiagnostic?.({ type: 'injector_targets', injector: injector.name, targets })
    }

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
        onCompatDiagnostic?.({ type: 'injector_source', injector: injector.name, source: 'object-path' })
        break
      }
  }

  if (!selectedInjector) return undefined

  return {
    name: selectedInjector.name,
    source: 'object-path',
    updater: selectedInjector.inject(input.client)
  }
}

async function patchRegistryFromPlugin(input: BuildRuntimeCompatInput, selectedInjector: SelectedInjector | undefined, injectedUpdater: InjectedUpdater | undefined): Promise<void> {
  if (!selectedInjector || !injectedUpdater) {
    return
  }

  if (registryPatchState.patched) {
    return
  }

  const resolveInternal = input.resolveInternal ?? defaultResolveInternal
  for (const target of REGISTRY_PATCH_TARGETS) {
    let registryNamespace: any
    try {
      registryNamespace = await resolveInternal(target.specifier)
    } catch {
      continue
    }

    for (const root of getModuleRoots(registryNamespace)) {
      const located = locateFunction(root, [target.exportPath])
      if (!located) {
        continue
      }

      const original = located.fn
      if ((original as any).__contextBonsaiRegistryPatched === true) {
        registryPatchState.patched = true
        registryPatchState.original = original
        registryPatchState.target = located.fn
        return
      }

      const wrappedFromPlugin = function(this: any, ...args: any[]) {
        const toolInstance = original.apply(this, args)
        if (!toolInstance || typeof toolInstance.execute !== 'function') {
          return toolInstance
        }

        if ((toolInstance.execute as any).__contextBonsaiExecutePatched === true) {
          return toolInstance
        }

        const originalExecute = toolInstance.execute
        const wrappedExecute = async function(this: any, executeArgs: any, ctx: any) {
          if (ctx && typeof ctx.updateMessage !== 'function') {
            const contextUpdater = async (id: string, mutate: MessageMutator) => {
              await injectedUpdater(ctx, id, mutate)
            }
            markInjectedContextUpdater(contextUpdater, selectedInjector.name, selectedInjector.source)
            ctx.updateMessage = contextUpdater
          }
          return await originalExecute.call(this, executeArgs, ctx)
        }

        Object.defineProperty(wrappedExecute, '__contextBonsaiExecutePatched', {
          value: true,
          enumerable: false,
          configurable: false,
          writable: false
        })

        toolInstance.execute = wrappedExecute
        return toolInstance
      }

      Object.defineProperty(wrappedFromPlugin, '__contextBonsaiRegistryPatched', {
        value: true,
        enumerable: false,
        configurable: false,
        writable: false
      })

      located.owner[located.path.split('.').at(-1)!] = wrappedFromPlugin
      registryPatchState.patched = true
      registryPatchState.original = original
      registryPatchState.target = wrappedFromPlugin
      return
    }
  }
}

export async function buildRuntimeCompat(input: BuildRuntimeCompatInput): Promise<RuntimeCompat> {
  const onCompatDiagnostic = input.onCompatDiagnostic
  const moduleSelectedInjector = await selectModuleInjector(input)
  const selectedInjector = moduleSelectedInjector ?? selectObjectPathInjector(input)

  if (!selectedInjector) {
    input.onCompatDiagnostic?.({ type: 'injector_none_selected' })
  }

  const selectedInjectorName = selectedInjector?.name
  const selectedInjectedUpdater = selectedInjector?.updater

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
            const sourceClassifiedError = normalizeProbeError('adapter_invoke_failed', error)
            onCompatDiagnostic?.({
              type: 'injector_invoke_error',
              injector: selectedInjectorName ?? 'unknown injector',
              error: sourceClassifiedError
            })
            throw error
          }
        }

  await patchRegistryFromPlugin(input, selectedInjector, injectedUpdater)

  return createRuntimeCompat({
    injectedUpdater,
    injectedUpdaterMeta: selectedInjector
      ? {
          injector: selectedInjector.name,
          source: selectedInjector.source
        }
      : undefined,
    onCompatDiagnostic,
  } as any)
}
