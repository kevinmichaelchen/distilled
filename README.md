# distilled

Shared infrastructure for Kevin's standalone Distilled SDK repositories.

This package intentionally pins and re-exports `@distilled.cloud/core@0.29.0`, the runtime maintained in Alchemy's `distilled` monorepo. Keeping the façade thin gives the standalone repositories the topology requested here while preserving Alchemy's actual Effect 4 behavior:

- Runtime `Schema.Codec` request and response validation.
- HTTP traits consumed by `API.make` and `API.makePaginated`.
- Yieldable operations, pagination streams, retry policies, categorized errors, sensitive fields, tracing, and debug logging.
- Deterministic OpenAPI 2/3 generation with documented RFC 6902 patch envelopes.

Vendor repositories import subpaths such as `@kevinmichaelchen/distilled/client` and `@kevinmichaelchen/distilled/openapi/generate`. No forked runtime code lives here. `scripts/generate-openapi.ts` is vendored verbatim from audited Alchemy commit `bf5f2b4` because `@distilled.cloud/core@0.29.0` declares that export but omits `scripts/` from its published npm files. Upgrades are deliberate diffs against Alchemy's source.
