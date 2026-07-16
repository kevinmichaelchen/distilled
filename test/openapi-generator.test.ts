import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  generateFromOpenAPI,
  OpenAPIGenerationError,
  type GeneratorConfig,
} from "../scripts/generate-openapi.ts";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

const fixture = async (spec: unknown) => {
  const root = await mkdtemp(join(tmpdir(), "distilled-openapi-"));
  roots.push(root);
  const specPath = join(root, "openapi.json");
  const patchDir = join(root, "patches");
  const outputDir = join(root, "services");
  await mkdir(patchDir);
  await writeFile(specPath, JSON.stringify(spec));
  const config: GeneratorConfig = {
    specPath,
    patchDir,
    outputDir,
    importPrefix: "..",
    protocolName: "TestProtocol",
    paginatedProtocolName: "TestPaginatedProtocol",
    operationErrorType: "TestOpError",
    operationContextType: "TestOpContext",
    includeOperationErrors: true,
    statusToErrorClass: { "400": "BadRequest" },
    defaultErrorStatuses: new Set(),
  };
  return { root, outputDir, config };
};

describe("OpenAPI service generator", () => {
  test("groups operations by primary tag and emits the beta operation contract", async () => {
    const { outputDir, config } = await fixture({
      openapi: "3.1.0",
      info: { title: "Example", version: "1" },
      paths: {
        "/teams/{enterprise-team}": {
          get: {
            tags: ["Team Management"],
            operationId: "teams.get",
            parameters: [
              {
                name: "enterprise-team",
                in: "path",
                required: true,
                schema: { type: "string" },
              },
              {
                name: "page-size",
                in: "query",
                schema: { type: "integer" },
              },
              {
                name: "X-Trace-Id",
                in: "header",
                required: true,
                schema: { type: "string" },
              },
            ],
            responses: {
              "200": {
                description: "ok",
                content: {
                  "application/json": {
                    schema: {
                      type: "object",
                      properties: { id: { type: "string" } },
                    },
                  },
                },
              },
              "400": { description: "bad request" },
            },
          },
        },
      },
    });

    const coverage = generateFromOpenAPI(config);
    const generated = await readFile(
      join(outputDir, "team_management.ts"),
      "utf8",
    );
    expect(generated).toContain(
      'import * as S from "@kevinmichaelchen/distilled/schema"',
    );
    expect(generated).toContain(
      "export const TeamsGetInput = /*@__PURE__*/ S.suspend(() =>",
    );
    expect(generated).toContain(
      ').annotate({ identifier: "TeamsGetInput" }) as unknown as S.Codec<TeamsGetInput>;',
    );
    expect(generated).toContain(
      'T.Http({ method: "GET", uri: "/teams/{enterprise-team}", code: 200 })',
    );
    expect(generated).toContain('T.Label("enterprise-team")');
    expect(generated).toContain('T.Query("page-size")');
    expect(generated).toContain('T.Header("X-Trace-Id")');
    expect(generated).toContain("export type TeamsGetError = BadRequest | TestOpError");
    expect(generated).toContain("export const teamsGet: API.OperationMethod<");
    expect(generated).toContain("input: TeamsGetInput");
    expect(generated).toContain("output: TeamsGetOutput");
    expect(generated).toContain("protocol: TestProtocol");
    expect(generated).toContain("retry: Retry.Retry");
    expect(await readFile(join(outputDir, "index.ts"), "utf8")).toContain(
      'export * as team_management from "./team_management.ts";',
    );
    expect(coverage.operations.generated).toBe(1);
  });

  test("derives missing operation names and supports every HTTP method", async () => {
    const operations = Object.fromEntries(
      ["get", "post", "put", "patch", "delete", "head", "options", "trace"].map(
        (method) => [
          method,
          {
            tags: ["Probe"],
            summary: `${method} probe`,
            responses: { "204": { description: "ok" } },
          },
        ],
      ),
    );
    const { outputDir, config } = await fixture({
      openapi: "3.1.0",
      info: { title: "Probe", version: "1" },
      paths: { "/probe": operations },
    });
    const coverage = generateFromOpenAPI(config);
    const generated = await readFile(join(outputDir, "probe.ts"), "utf8");
    for (const method of [
      "GET",
      "POST",
      "PUT",
      "PATCH",
      "DELETE",
      "HEAD",
      "OPTIONS",
      "TRACE",
    ]) {
      expect(generated).toContain(`method: "${method}"`);
      expect(coverage.operations.byMethod[method as keyof typeof coverage.operations.byMethod].generated).toBe(1);
    }
    expect(generated.match(/retry: Retry\.Retry/g)).toHaveLength(4);
    expect(coverage.operations.generated).toBe(8);
  });

  test("emits direct Redacted schemas", async () => {
    const { outputDir, config } = await fixture({
      openapi: "3.0.3",
      info: { title: "Secrets", version: "1" },
      paths: {
        "/tokens": {
          post: {
            tags: ["Tokens"],
            operationId: "tokens.create",
            requestBody: {
              required: true,
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    required: ["api_key"],
                    properties: { api_key: { type: "string" } },
                  },
                },
              },
            },
            responses: { "204": { description: "ok" } },
          },
        },
      },
    });
    generateFromOpenAPI(config);
    const generated = await readFile(join(outputDir, "tokens.ts"), "utf8");
    expect(generated).toContain("api_key: S.Redacted(S.String)");
    expect(generated).toContain("api_key: Redacted.Redacted<string>");
    expect(generated).not.toContain("SensitiveString");
    expect(generated).not.toContain("sensitive.ts");
  });

  test("emits typed paginated methods and the paginated protocol", async () => {
    const { outputDir, config } = await fixture({
      openapi: "3.0.3",
      info: { title: "Lists", version: "1" },
      paths: {
        "/widgets": {
          get: {
            tags: ["Widgets"],
            operationId: "widgets.list",
            parameters: [
              { name: "next_token", in: "query", schema: { type: "string" } },
            ],
            responses: {
              "200": {
                description: "ok",
                content: {
                  "application/json": {
                    schema: {
                      type: "object",
                      properties: {
                        widgets: { type: "array", items: { type: "string" } },
                        next_token: { type: "string", nullable: true },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });
    generateFromOpenAPI(config);
    const generated = await readFile(join(outputDir, "widgets.ts"), "utf8");
    expect(generated).toContain("API.PaginatedOperationMethod<");
    expect(generated).toContain("API.makePaginated");
    expect(generated).toContain("protocol: TestPaginatedProtocol");
    expect(generated).toContain('pagination: { mode: "token"');
  });

  test("models any successful 2xx response and records its status", async () => {
    const { outputDir, config } = await fixture({
      openapi: "3.0.3",
      info: { title: "Jobs", version: "1" },
      paths: {
        "/jobs": {
          post: {
            tags: ["Jobs"],
            operationId: "jobs.start",
            responses: {
              "202": {
                description: "accepted",
                content: {
                  "application/json": {
                    schema: {
                      type: "object",
                      required: ["id"],
                      properties: { id: { type: "string" } },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });
    generateFromOpenAPI(config);
    const generated = await readFile(join(outputDir, "jobs.ts"), "utf8");
    expect(generated).toContain('T.Http({ method: "POST", uri: "/jobs", code: 202 })');
    expect(generated).toContain("export interface JobsStartOutput { id: string }");
  });

  test("binds scalar and array request bodies as the whole HTTP body", async () => {
    const { outputDir, config } = await fixture({
      openapi: "3.0.3",
      info: { title: "Values", version: "1" },
      paths: {
        "/values": {
          put: {
            tags: ["Values"],
            operationId: "values.replace",
            requestBody: {
              required: true,
              content: {
                "application/json": {
                  schema: { type: "array", items: { type: "string" } },
                },
              },
            },
            responses: { "204": { description: "ok" } },
          },
        },
      },
    });
    generateFromOpenAPI(config);
    const generated = await readFile(join(outputDir, "values.ts"), "utf8");
    expect(generated).toContain("body: ReadonlyArray<string>");
    expect(generated).toContain("body: S.Array(S.String).pipe(T.HttpBody())");
  });

  test("fails closed and leaves the previous projection untouched", async () => {
    const { outputDir, config } = await fixture({
      openapi: "3.0.3",
      info: { title: "Broken", version: "1" },
      paths: {
        "/one": {
          get: {
            operationId: "same",
            responses: { "204": { description: "ok" } },
          },
        },
        "/two": {
          get: {
            operationId: "same",
            responses: { "204": { description: "ok" } },
          },
        },
      },
    });
    await mkdir(outputDir);
    await writeFile(join(outputDir, "sentinel.txt"), "unchanged");
    expect(() => generateFromOpenAPI(config)).toThrow(OpenAPIGenerationError);
    expect(await readFile(join(outputDir, "sentinel.txt"), "utf8")).toBe(
      "unchanged",
    );
  });
});
