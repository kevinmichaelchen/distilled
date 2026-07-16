---
name: release-distilled-cohort
description: Prepare, execute, reconcile, or verify coordinated npm/OIDC releases of the Distilled core and provider SDKs, including version propagation, workflow monitoring, registry verification, and Blume release documentation. Use only when the user explicitly asks to plan, prepare, publish, resume, or audit a Distilled package release. Do not use for implementation work, provider maintenance, or ordinary documentation edits.
---

# Release the Distilled cohort

## Select the mode

Treat the user's exact wording as the authorization boundary:

1. **Plan or audit**: inspect versions, Git state, npm state, dependencies, and
   workflows. Make no changes.
2. **Prepare**: update explicitly named local versions, lockfiles, release
   notes, and generated projections; run checks, builds, and package dry runs.
   Do not commit, push, dispatch, publish, create a GitHub release, or deploy
   Blume.
3. **Publish**: proceed only when the user explicitly authorizes named packages
   and versions. Ask for missing scope or versions before any external write.

Invoking this skill, saying “get ready,” or approving preparation does not
authorize publication. Treat committing, pushing, workflow dispatch, npm
publication, GitHub releases, and a Blume deployment as distinct external
actions.

## Build the release ledger

Read `AGENTS.md`, `docs/guides/publishing.mdx`,
`docs/guides/protocol-architecture.mdx`, `docs/sdk-manifest.json`, and every
selected repository's `AGENTS.md`, `package.json`, source pin, and
`.github/workflows/publish.yml`.

Run the read-only planner from the shared repository:

```bash
bun .agents/skills/release-distilled-cohort/scripts/release-plan.ts
bun .agents/skills/release-distilled-cohort/scripts/release-plan.ts --registry
```

The repo-owned planner resolves this `distilled` checkout from its own location
and expects provider repositories to be sibling directories named after their
npm packages, matching the documented `ghq` layout. For another topology,
build the same ledger manually; do not relocate or alias worktrees.

- Add `--providers auth0,jira` to narrow the provider set.
- Add `--core-only` when no provider package is in scope.
- Add `--json` for a machine-readable ledger.
- Use `--registry` when current npm state matters; without it the planner makes
  no network requests.

Record repository, commit SHA, branch/upstream state, package and manifest
versions, core dependency, source/submodule pin, operation count, workflow
posture, local dirt, and npm state. The planner only reports; it never writes or
dispatches anything. Refresh remote refs before treating its cached
ahead/behind result as publication proof.

## Prepare and verify

1. Inventory existing work in every selected repository. Never reset, clean,
   stash, or overwrite unrelated changes.
2. Regenerate from pinned sources and review source-pin, patch,
   `src/services`, export-map, operation-count, and OpenAPI `coverage.json`
   changes. Treat Slack as its separate pinned TypeScript/WebClient path.
3. Run each repository's own `check` and `build` scripts. Run a package dry run
   where available. Do not substitute a weaker shared command.
4. Require clean generated drift, zero failed or unsupported OpenAPI
   operations, matching local dependency constraints, and an exact release
   commit pushed to its upstream branch before publication.
5. Stop on dirty overlap, a failed check, a mismatched source pin, an existing
   npm version, or an unpublished required core version. Report the blocker;
   do not silently repair implementation failures.

## Publish only the authorized scope

1. Publish the shared core first only when it changed. Confirm its exact version
   on npm before publishing any provider that requires it.
2. Publish only the explicitly authorized provider packages. Do not release an
   unchanged cohort member merely because other packages changed.
3. Use each repository's committed OIDC `.github/workflows/publish.yml`.
   Never introduce an npm token or run local `npm publish` as a substitute.
4. Confirm the workflow ran against the intended pushed SHA, completed
   successfully, and placed the exact package version on npm. Reconcile npm and
   workflow state before resuming a partial release.

## Finalize Blume after npm

After every authorized package is confirmed on npm:

1. Update `docs/sdk-manifest.json` versions and operation counts.
2. Run `bun run docs:generate` and review the generated support matrix.
3. Add or update changelog, provider, architecture, and blog pages only when
   the release warrants them.
4. Run `bun run docs:check:registry` and `bun run docs:build`.
5. Commit or push the Blume changes only with authorization; pushing `main`
   deploys the public site.

Finish with a ledger of authorized versions and SHAs, workflow results, npm
confirmation, Blume state, and untouched cohort members.
