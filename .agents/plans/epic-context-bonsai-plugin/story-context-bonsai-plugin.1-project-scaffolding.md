# Story: Project Scaffolding

**Epic:** Context Bonsai Plugin
**Size:** Small
**Dependencies:** None

## Story Description

Initialize the npm package structure for the Context Bonsai plugin. The package
must build with Bun, have a working test runner, and be installable by OpenCode
as a plugin (via `opencode.json` `plugin` array or local `.opencode/plugin/`
directory).

## User Model

### User Gamut

- Plugin developers who will read and contribute to this codebase
- OpenCode users who install the plugin via npm or local file reference
- CI systems that build and test the package

### User-Needs Gamut

- Standard npm package conventions (predictable structure, clear entry point)
- Fast builds (Bun-native tooling)
- Reliable test runner for unit and integration tests

### Design Implications

- Use Bun as build tool and test runner (matches OpenCode's own tooling)
- TypeScript with strict mode
- ESM-only (`"type": "module"`)

## Acceptance Criteria

- [ ] `bun install` succeeds
- [ ] `bun run build` produces `dist/index.js` and `dist/index.d.ts`
- [ ] `bun test` runs and passes (with a trivial placeholder test)
- [ ] Package can be referenced from `opencode.json` as `file:///path/to/dist/index.js`
- [ ] `@opencode-ai/plugin` is listed as peerDependency
- [ ] `ai` SDK is listed as dependency (needed for `generateText`, `LanguageModelV2` type)
- [ ] `zod` is listed as dependency (needed for plugin-local schema validation)

## Context References

### Relevant Codebase Files (must read)

- OpenCode plugin package.json: `packages/plugin/package.json` — reference for
  how `@opencode-ai/plugin` is structured
- GitLab auth plugin (real-world example):
  `node_modules/.bun/@gitlab+opencode-gitlab-auth@1.3.3/` — reference for npm
  plugin package structure (`main`, `types`, `files`, peerDependencies)
- Plugin example: `packages/plugin/src/example.ts` — minimal plugin structure

### New Files to Create

- `package.json` — npm package manifest
- `tsconfig.json` — TypeScript configuration
- `src/index.ts` — main entry point (empty Plugin export for now)
- `src/index.test.ts` — placeholder test

### Relevant Documentation

- OpenCode plugin loading code: `packages/opencode/src/plugin/index.ts` — how
  plugins are discovered, installed, and initialized

## Implementation Plan

### Phase 1: Package Initialization

- Create `package.json` with:
  - `name`: `opencode-context-bonsai` (or `@basil/opencode-context-bonsai`)
  - `version`: `0.1.0`
  - `type`: `module`
  - `main`: `dist/index.js`
  - `types`: `dist/index.d.ts`
  - `files`: `["dist"]`
  - `peerDependencies`: `{ "@opencode-ai/plugin": "*" }`
  - `dependencies`: `{ "ai": "^5.0.0", "zod": "^3.23.0" }`
  - Note: `ai` must be v5+ to match upstream OpenCode. The `LanguageModelV2`
    type is imported from `@ai-sdk/provider` (re-exported by `ai`).
    `generateText` is imported from `ai`.
  - `scripts`: `{ "build": "bun build ./src/index.ts --outdir dist --target bun", "test": "bun test" }`
- Create `tsconfig.json` with strict mode, ESM, Bun types

### Phase 2: Entry Point

- Create `src/index.ts` exporting a minimal Plugin factory:
  ```typescript
  import type { Plugin } from "@opencode-ai/plugin"
  export const contextBonsai: Plugin = async (_input) => ({})
  export default contextBonsai
  ```
- Create `src/index.test.ts` with a basic import/type test

### Phase 3: Build Verification

- Run `bun install`, `bun run build`, `bun test`
- Verify `dist/` output contains expected files

## Step-by-Step Tasks

1. Create `package.json`
2. Create `tsconfig.json`
3. Create `src/index.ts` with minimal Plugin export
4. Create `src/index.test.ts` with placeholder test
5. Run `bun install`
6. Run `bun run build` and verify `dist/` output
7. Run `bun test` and verify passing

## Testing Strategy

- Placeholder unit test: import the Plugin factory, verify it returns a Hooks
  object when called
- Build verification: `dist/index.js` exists and is valid ESM

## Validation Commands

- `bun install`
- `bun run build`
- `bun test`
- `ls dist/index.js dist/index.d.ts`

## Completion Checklist

- [ ] All acceptance criteria met
- [ ] Validation commands pass
- [ ] User-model ambiguities resolved or escalated
