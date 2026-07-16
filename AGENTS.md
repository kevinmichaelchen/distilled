# Distilled shared-core runbook

This repository provides the shared protocol-based core for the Distilled SDKs. Keep its public architecture aligned with the latest `alchemy-run/distilled` core.

- Keep `api.ts`, the `Protocol` service, traits, HTTP helpers, pagination, retry, errors, and generated operation shapes aligned with Alchemy.
- Keep provider behavior in provider protocol layers; the shared core supplies protocol-neutral machinery.
- Keep `scripts/generate-openapi.ts` focused on producing the same operation and schema layout from OpenAPI inputs.
- Regenerate every vendor SDK when the shared generated contract changes.
- This project uses Effect 4. Verify APIs against the installed source; do not infer them from Effect 3.
- Vendor behavior belongs in the vendor SDK's credentials, protocol, errors, retry service, or patch files.
- Mirrored upstream specifications are immutable and live in separate `distilled-spec-*` repositories.
