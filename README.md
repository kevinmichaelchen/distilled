# distilled

Shared protocol engine and generators for Kevin's standalone Distilled SDKs.

`@kevinmichaelchen/distilled` follows Alchemy's current protocol architecture:

- `API.make` creates callable, yieldable Effect operations.
- Schema traits describe paths, query parameters, headers, bodies, response
  fields, and error matchers.
- Provider-owned Protocol layers supply credentials, base URLs, wire formats,
  and error decoding for every request.
- Pagination streams and retry policy are shared while provider policy remains
  local to each SDK.
- The OpenAPI 2/3 generator emits resource service modules with explicit
  operation error and context types.

Provider packages contain handwritten `credentials.ts`, `errors.ts`,
`traits.ts`, `protocol.ts`, `pagination.ts` when needed, and `retry.ts`. Their
generated `services/` directories are complete projections of exact source
pins plus reviewed RFC 6902 patches.

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the repository topology and source
decision rule.

## Documentation

The SDK catalog, architecture guides, blog, and changelog are published at
[kevinmichaelchen.github.io/distilled](https://kevinmichaelchen.github.io/distilled/).

Run `bun run docs:dev` to work on the Blume site locally or
`bun run docs:build` to build it. `docs/sdk-manifest.json` is the canonical
source for public SDK versions and operation counts; run
`bun run docs:generate` after changing it.
