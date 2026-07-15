# distilled

Shared infrastructure for Kevin's standalone Distilled SDK repositories.

This package intentionally pins and re-exports `@distilled.cloud/core@0.29.0`, the runtime maintained in Alchemy's `distilled` monorepo. Keeping the façade thin gives the standalone repositories the topology requested here while preserving Alchemy's actual Effect 4 behavior:

- Runtime `Schema.Codec` request and response validation.
- HTTP traits consumed by `API.make` and `API.makePaginated`.
- Yieldable operations, pagination streams, retry policies, categorized errors, sensitive fields, tracing, and debug logging.
- Deterministic OpenAPI 2/3 generation with documented RFC 6902 patch envelopes.

Vendor repositories import subpaths such as `@kevinmichaelchen/distilled/client` and `@kevinmichaelchen/distilled/openapi/generate`. No forked runtime code lives here. `scripts/generate-openapi.ts` is vendored from audited Alchemy commit `bf5f2b4` because `@distilled.cloud/core@0.29.0` declares that export but omits `scripts/` from its published npm files. Local adaptations are limited to regression-tested, cross-vendor generator fixes; the first quotes non-identifier OpenAPI parameter names such as GitHub's `enterprise-team`. Upgrades are deliberate diffs against Alchemy's source.

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the source-strategy decision rule and repository topology.

## Documentation

The Distilled software factory, SDK catalog, architecture guides, blog, and
changelog are prepared for
[kevinmichaelchen.github.io/distilled](https://kevinmichaelchen.github.io/distilled/).
GitHub Pages deployment is gated by repository variable
`ENABLE_GITHUB_PAGES` because the owner's current plan does not support Pages
for private repositories.

Run `bun run docs:dev` to work on the Blume site locally, or
`bun run docs:build` to produce the static site in `dist/`.
