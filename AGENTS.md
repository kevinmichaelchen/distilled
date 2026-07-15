# Distilled factory runbook

- Keep generation deterministic: identical spec commit plus patches must produce an identical tree.
- Never modify a mirrored spec from this repository.
- Add general OpenAPI behavior here; add vendor quirks in the vendor SDK patch layer.
- Generated files must include `DO NOT EDIT` and be replaced as a complete tree.
- Any generator bug fix requires a focused fixture or runtime test.

## Diagnosis

| Symptom | Change |
| --- | --- |
| Wrong wire path/query/header/body | Fix the shared generator or add missing spec metadata via a vendor patch |
| Wrong generated TypeScript type | Patch the vendor spec first; change the generator only for general OpenAPI semantics |
| Unknown HTTP response | Add vendor error classification in the SDK repository |
| Non-deterministic diff | Sort the generator input/output and add a regression test |
