# Software factory architecture

This workspace follows the architecture observed at the current HEAD of Alchemy's `distilled`, `distilled-spec-neon`, and `distilled-neon` repositories.

## Stable boundary

`distilled` pins Alchemy's Effect 4 core runtime and owns only shared generator adaptations. Each vendor SDK owns credentials, error mapping, retries, patches, generated operations, and an exact upstream source pin.

## Source decision rule

| Upstream API source | Repository strategy | Generator strategy | Example |
| --- | --- | --- | --- |
| Maintained OpenAPI document | Small immutable-history mirror, pinned as an SDK submodule | Shared Alchemy OpenAPI generator | JIRA |
| Maintained OpenAPI repository too large for practical downstream submodules | Mirror only the exact bundled document consumed by generation | Shared Alchemy OpenAPI generator | GitHub |
| No maintained OpenAPI, but an official typed SDK exists | Pin the official SDK directly as an SDK submodule | Vendor-specific TypeScript AST generator | Slack |

Do not create a `distilled-spec-*` mirror when the official source repository itself is the compact, authoritative input. Do not scrape documentation into a pseudo-spec when a maintained typed SDK is available.

## Repository topology

```text
distilled                         shared Effect 4 runtime façade + generators
├── distilled-spec-jira          official Atlassian OpenAPI mirror
│   └── distilled-jira           pinned spec + patches + generated operations
├── distilled-spec-github        official versioned GitHub OpenAPI bundle mirror
│   └── distilled-github         pinned spec + patches + generated operations
└── distilled-slack              pinned slackapi/node-slack-sdk + AST-generated operations
```

Generated files are committed so source changes are reviewable. CI regenerates and fails on drift. Spec/source updates advance explicit submodule commits rather than following a moving branch at SDK build time.
