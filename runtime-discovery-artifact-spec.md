# Runtime Discovery Artifact Spec

## Purpose

Provide machine-verifiable evidence for internal module targets used by compatibility injection.

## Generation Contract

- Generator command (single entrypoint):
  - `bun run scripts/discover-runtime-targets.ts --runtime <stock|local> --out /tmp/runtime-discovery-<runtime>.json`
- Required runtimes:
  - `stock`: `/home/basil/.opencode/bin/opencode`
  - `local`: `/home/basil/projects/opencode_context_management/opencode/packages/opencode/dist/opencode-linux-x64/bin/opencode`
- The same probe matrix must run on both runtimes.

## JSON Schema (logical)

```json
{
  "schemaVersion": "1",
  "generatedAt": "ISO-8601",
  "reproducibilityHash": "sha256-hex (generatedAt excluded)",
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
- Artifact is invalid if any plan target lacks a matching `entries.id` row.
- Artifact is invalid if no `negativeControls` are present.
- For story completion, stock artifact must contain at least one callable registry patch target and one callable updater target.

## Review/Judge Checklist

- Re-run generator command and compare output hash.
- Confirm `reportedVersion` is captured from the target runtime.
- Confirm negative controls fail as expected.
- Confirm target rows referenced by plan are present and callable.
