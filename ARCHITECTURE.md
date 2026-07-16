# Software factory architecture

The shared package and provider SDKs follow Alchemy's current Distilled
protocol architecture.

## Stable boundary

`distilled` owns the provider-neutral Effect runtime, HTTP traits, protocol
contracts, pagination, retry semantics, common error categories, and OpenAPI
generation. Each provider owns credentials, its Protocol layer, error-envelope
decoding, retry tag, optional pagination policy, patches, and generated service
modules.

Generated operations contain schemas and traits, but no handwritten transport
logic. `API.make` asks the provider Protocol to encode a request and decode its
response.

## Source decision rule

| Authoritative source | Repository strategy | Generator strategy | Example |
| --- | --- | --- | --- |
| Maintained OpenAPI document | Small mirror pinned as an SDK submodule | Shared OpenAPI-to-Protocol generator | Jira |
| Maintained OpenAPI repository too large for a practical submodule | Mirror the exact bundled document | Shared OpenAPI-to-Protocol generator | GitHub |
| No maintained OpenAPI, but an official typed SDK exists | Pin the official SDK directly | Provider-specific typed-source generator | Slack |

Do not scrape prose into a pseudo-spec when a maintained machine-readable or
typed source exists.

## Repository topology

```text
distilled                         protocol engine + generators
├── distilled-spec-jira          official Atlassian OpenAPI mirror
│   └── distilled-jira           Protocol + patches + generated services
├── distilled-spec-github        official GitHub OpenAPI bundle mirror
│   └── distilled-github         Protocol + patches + generated services
└── distilled-slack              official typed SDK + generated services
```

Generated files are committed. CI regenerates and fails on drift. Source
updates advance exact submodule commits rather than following a moving branch
at build time.
