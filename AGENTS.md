# Distilled shared-core runbook

This repository is a versioned façade over Alchemy's published `@distilled.cloud/core`. Read the source pinned by `package.json` in `node_modules/@distilled.cloud/core` and the matching `alchemy-run/distilled` commit before changing public exports.

- Do not reimplement Alchemy runtime or generator behavior here.
- Keep runtime façade modules as direct re-exports.
- Keep `scripts/generate-openapi.ts` reviewable as a verbatim vendored file; limit local edits to its import path and attribution header.
- Upgrade `@distilled.cloud/core` deliberately and regenerate every vendor SDK in the same change set.
- This project uses Effect 4. Verify APIs against the installed source; do not infer them from Effect 3.
- Vendor behavior belongs in the vendor SDK's credentials, client, errors, retry service, or patch files.
- Mirrored upstream specifications are immutable and live in separate `distilled-spec-*` repositories.
