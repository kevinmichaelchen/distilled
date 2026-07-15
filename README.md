# distilled

The shared runtime and deterministic generator for Effect-native SDKs.

The factory reads an immutable vendor OpenAPI snapshot, applies ordered RFC 6902 patches in memory, and emits:

- OpenAPI-derived TypeScript types.
- One Effect-returning function per `operationId`.
- A stable operation manifest for review and coverage tooling.

Vendor knowledge belongs in SDK-repository patches and handwritten policy, never in a spec mirror.

This bootstrap targets stable Effect 3. Effect 4 is still published under npm's `beta` tag as of July 2026, so adopting it is intentionally deferred until the runtime API is stable.
