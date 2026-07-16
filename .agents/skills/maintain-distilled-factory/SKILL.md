---
name: maintain-distilled-factory
description: Coordinate Alchemy-alignment audits, shared Effect 4 runtime or OpenAPI-generator changes, and cross-provider regeneration for the Distilled repository family. Use when changing the shared Protocol, API, traits, HTTP behavior, errors, retry, pagination, generated operation shape, or scripts/generate-openapi.ts; when comparing against the latest alchemy-run/distilled implementation; or when verifying every provider after a shared change. Do not use for provider-only fixes, ordinary documentation edits, or publishing.
---

# Maintain the Distilled factory

## Establish the boundary

1. Read `AGENTS.md`, `docs/guides/protocol-architecture.mdx`, and
   `docs/reference/generator.mdx`.
2. Inventory every in-scope repository before changing it. Record
   `git status --short`, `git worktree list --porcelain`, the current branch and
   SHA, and `git submodule status --recursive`. Preserve all existing worktrees,
   changes, untracked files, and submodule pins; never reset or clean them.
3. Keep provider-neutral behavior in `distilled`; keep credentials, wire
   envelopes, provider errors, and provider policy in the provider repository.
4. Keep authoritative inputs in `distilled-spec-*` or the pinned upstream
   submodule, semantic patches and provider behavior in `distilled-*`, and
   generated services under generator ownership. Never repair generated output
   directly.
5. Inspect `node_modules/effect/package.json` and the installed Effect 4 source
   before using an API. Do not infer Effect 4 behavior from Effect 3 examples.
6. Fetch or inspect every relevant Alchemy branch, identify the newest
   applicable implementation, and pin the comparison to its remote, branch,
   and commit SHA. Do not assume a branch name proves recency.
7. Add focused shared tests for request, response, error, retry, pagination, or
   generated-contract changes.

## Assess impact

Use this matrix before selecting repositories or checks:

| Surface | Ownership and trigger | Proportional validation |
| --- | --- | --- |
| Shared core | `distilled/src` owns provider-neutral API, Protocol, traits, HTTP, errors, retry, and pagination. | Run focused tests, then core `check` and `build`. Verify affected providers when the public runtime contract moves. |
| Seven OpenAPI SDKs | Auth0, Avalara, Basis Theory, GitHub, Jira, OpenSearch, and Statsig consume `scripts/generate-openapi.ts`. | Regenerate all seven for generator or operation-shape changes. Require clean checks and review `coverage.json` totals, failures, unsupported methods, patches, and generated diffs. |
| Slack | `distilled-slack` derives services from the pinned official TypeScript SDK and uses its WebClient path, not the OpenAPI generator. | Run Slack generation and checks only when shared API/service shape or Slack's typed-source adapter changes. Do not require OpenAPI `coverage.json`. |
| Specifications | `distilled-spec-*` and provider submodules own pinned authoritative input. | Inventory pins and raw diffs. Update only when explicitly in scope; never mutate a mirror from the shared-core workflow. |
| Blume site | `docs/sdk-manifest.json` owns published SDK versions and operation counts; Blume owns public architecture, release notes, and guides. | When versions, counts, package surface, or architecture change, update the manifest, run `bun run docs:generate`, `bun run docs:check`, and `bun run docs:build`. Run the registry check only when published versions should already exist. |

Do not expand a provider-local fix into a cohort rewrite. Conversely, do not
accept a shared generated-contract change after testing only one provider.

## Verify the cohort

Run the helper from the `distilled` repository:

```bash
bun .agents/skills/maintain-distilled-factory/scripts/cohort.ts status
bun .agents/skills/maintain-distilled-factory/scripts/cohort.ts verify
bun .agents/skills/maintain-distilled-factory/scripts/cohort.ts regenerate
```

The repo-owned helper resolves this `distilled` checkout from its own location
and expects provider repositories to be sibling directories named after their
npm packages, matching the documented `ghq` layout. If a checkout uses a
different topology, inventory and run the same repository-local commands
manually; do not create aliases or move worktrees implicitly.

- Use `status` for a read-only inventory of the shared package and every SDK.
- Use `verify` to delegate `check` and `build` to the shared package and each
  selected provider.
- Use `regenerate` to delegate `generate`, `check`, and `build` to each selected
  provider after verifying the shared package.
- Add `--providers jira,github` to select providers.
- Add `--dry-run` to `verify` or `regenerate` to print the command plan without
  running package scripts.
- Keep the default dirty-worktree refusal. Before using `--allow-dirty`, inspect
  `git status`, staged and unstaged diffs, submodule state, and the paths each
  package script can write. Use the flag only when the in-scope changes are
  understood and do not overlap unrelated work.

Derive the cohort from `docs/sdk-manifest.json`. Treat each repository's
`package.json` scripts as canonical; do not duplicate their checks in the skill.
Review generated diffs and `src/services/coverage.json` after regeneration.
If providers require an unpublished core version, stop at the release boundary
and report it; do not introduce a filesystem override or publish from this
skill.

## Guardrails

- Never edit a provider's `src/services` or pinned specification by hand.
- Never advance specification submodules as part of cohort verification.
- Never install dependencies implicitly.
- Never use `--allow-dirty` as a substitute for understanding existing changes.
  The helper never resets, cleans, stashes, or restores a worktree.
- Never commit, tag, push, dispatch workflows, or publish from this skill or its
  helper.
- Expect provider `check` scripts to regenerate services while checking drift;
  use `--dry-run` when only a read-only plan is authorized.
- Stop and report missing repositories, scripts, invalid coverage, or failed
  package commands without hiding partial results.
