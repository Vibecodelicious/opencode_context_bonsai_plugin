# Runtime Discovery Artifact Spec

## Purpose

Provide machine-verifiable evidence for internal module targets used by compatibility injection.

## Generation Contract

- Generator command (single entrypoint):
  - `bun run scripts/discover-runtime-targets.ts --runtime <stock|local> --out /tmp/runtime-discovery-<runtime>.json`
- Runtime-object-path acquisition is executed inside generator via real runtime tool execution:
  - `CONTEXT_BONSAI_DISCOVERY_DUMP=1`
  - `CONTEXT_BONSAI_DISCOVERY_OUT=/tmp/context-bonsai-runtime-dump-<runtime>.json` (or caller-provided override)
  - runtime command invokes `context-bonsai-prune` (phase-1/no-args) through `opencode run`
- Required runtimes:
  - `stock`: `/home/basil/.opencode/bin/opencode`
  - `local`: `/home/basil/projects/opencode_context_management/opencode/packages/opencode/dist/opencode-linux-x64/bin/opencode`
- The same probe matrix must run on both runtimes.

## JSON Schema (logical)

```json
{
  "schemaVersion": "2",
  "generatedAt": "ISO-8601",
  "reproducibilityHash": "sha256-hex (generatedAt excluded)",
  "inspectionCommands": ["ordered command list used for bundle inspection"],
  "inspectionEnvironment": {
    "cwd": "absolute-path",
    "runtimeName": "stock|local",
    "runtimeBinary": "absolute-path"
  },
  "inspectionEvidence": [
    {
      "source": "command|file|runtime",
      "ref": "command string or file path",
      "snippet": "normalized snippet (<=240 chars, whitespace collapsed)",
      "order": 1
    }
  ],
  "runtime": {
    "name": "stock|local",
    "binary": "absolute-path",
    "reportedVersion": "string"
  },
  "probeMatrixVersion": "v1",
  "entries": [
    {
      "id": "REG-001",
      "kind": "registry|updater",
      "specifier": "string",
      "exportPath": "string",
      "expectedContract": "fromPlugin|updateMessageAtomic|updateMessage|patchUpdateMessage",
      "result": {
        "status": "resolved|missing|not_callable|callable|invoke_failed",
        "typeof": "string",
        "arity": 0,
        "ownerType": "string",
        "errorClass": "module_not_found|export_path_missing|not_callable|invoke_failed|null",
        "errorMessage": "string|null"
      }
    }
  ],
  "candidateFindings": [
    {
      "kind": "registry|updater",
      "sourceType": "bundle-symbol|runtime-object-path|import-resolvable",
      "compatSource": "object-path|module",
      "logicalTargetKey": "registry:fromPlugin",
      "identifier": "string",
      "evidence": "string",
      "confidence": 0.0,
      "validationState": "validated|rejected|inconclusive",
      "validationReason": "string"
    }
  ],
  "decisionGate": {
    "status": "READY_FOR_INJECTION_IMPL|DISCOVERY_INCOMPLETE",
    "blockerCodes": [
      "missing_registry_target|missing_updater_target|registry_confidence_below_threshold|updater_confidence_below_threshold|registry_rejected|updater_rejected"
    ]
  },
  "negativeControls": [
    {
      "specifier": "known/bad/specifier",
      "exportPath": "Nope.missing",
      "status": "missing|module_not_found"
    }
  ],
  "summary": {
    "resolvedCount": 0,
    "callableCount": 0,
    "missingCount": 0,
    "invokeFailedCount": 0
  }
}
```

## Validity Rules

- Artifact is invalid if `schemaVersion` or `probeMatrixVersion` missing.
- Artifact is invalid if `reproducibilityHash` is missing.
- Artifact is invalid if `inspectionCommands`, `inspectionEnvironment`, or `inspectionEvidence` is missing.
- Artifact is invalid if any plan target lacks a matching `entries.id` row.
- Artifact is invalid if no `negativeControls` are present.
- For story completion, stock artifact must include required-class terminal outcomes (`validated` or `rejected`) and a decision gate.
- `READY_FOR_INJECTION_IMPL` requires one validated `registry` and one validated `updater` candidate with confidence `>= 0.8`.

## Review/Judge Checklist

- Re-run generator command and compare output hash.
- Confirm `reportedVersion` is captured from the target runtime.
- Confirm negative controls fail as expected.
- Confirm target rows referenced by plan are present and callable.
