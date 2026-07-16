import { afterEach, describe, expect, test } from "bun:test";
import { access, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  generateFromOpenAPI,
  OpenAPIGenerationError,
} from "../scripts/generate-openapi.ts";
import * as T from "../src/traits.ts";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const writeClientStub = async (root: string): Promise<string> => {
  await symlink(resolve("node_modules"), join(root, "node_modules"), "dir");
  const clientPath = join(root, "client.ts");
  await writeFile(
    clientPath,
    `export const API = {
  make: (makeConfig: () => unknown) => makeConfig(),
  makePaginated: (makeConfig: () => unknown) => makeConfig(),
};
`,
  );
  return clientPath.slice(0, -3);
};

const importGenerated = async (filePath: string): Promise<Record<string, any>> =>
  import(`${pathToFileURL(filePath).href}?test=${crypto.randomUUID()}`);

describe("OpenAPI generator adaptations", () => {
  test("quotes non-identifier parameter names in runtime structs", async () => {
    const root = await mkdtemp(join(tmpdir(), "distilled-openapi-"));
    roots.push(root);
    const specPath = join(root, "openapi.json");
    const outputDir = join(root, "operations");
    const patchDir = join(root, "patches");
    await mkdir(patchDir);
    await Bun.write(specPath, JSON.stringify({
      openapi: "3.0.3",
      info: { title: "test", version: "1" },
      paths: {
        "/teams/{enterprise-team}": {
          get: {
            operationId: "teams/get",
            parameters: [{ name: "enterprise-team", in: "path", required: true, schema: { type: "string" } }],
            responses: { "204": { description: "ok" } },
          },
        },
      },
    }));

    await generateFromOpenAPI({ specPath, patchDir, outputDir, importPrefix: ".." });
    const generated = await readFile(join(outputDir, "teamsGet.ts"), "utf8");
    expect(generated).toContain('"enterprise-team": Schema.String.pipe(T.PathParam())');
    expect(generated).toContain("export const teamsGet");
  });

  test("derives stable operation names when a vendor omits operationId", async () => {
    const root = await mkdtemp(join(tmpdir(), "distilled-openapi-"));
    roots.push(root);
    const specPath = join(root, "openapi.json");
    const outputDir = join(root, "operations");
    const patchDir = join(root, "patches");
    await mkdir(patchDir);
    await Bun.write(specPath, JSON.stringify({
      openapi: "3.0.3",
      info: { title: "test", version: "1" },
      paths: {
        "/console/v1/alerts": {
          get: {
            tags: ["Alerts"],
            summary: "List Topline Alerts",
            responses: { "200": { description: "ok" } },
          },
        },
      },
    }));

    await generateFromOpenAPI({ specPath, patchDir, outputDir, importPrefix: ".." });
    const generated = await readFile(join(outputDir, "alertsListToplineAlerts.ts"), "utf8");
    expect(generated).toContain("export const alertsListToplineAlerts");
    expect(generated).toContain('path: "/console/v1/alerts"');
  });

  test("routes OAS3 query and header parameters outside a POST body", async () => {
    const root = await mkdtemp(join(tmpdir(), "distilled-openapi-"));
    roots.push(root);
    const specPath = join(root, "openapi.json");
    const outputDir = join(root, "operations");
    const patchDir = join(root, "patches");
    await mkdir(patchDir);
    const clientImport = await writeClientStub(root);
    await Bun.write(specPath, JSON.stringify({
      openapi: "3.0.3",
      info: { title: "test", version: "1" },
      paths: {
        "/issues": {
          post: {
            operationId: "issues.create",
            parameters: [
              { name: "updateHistory", in: "query", schema: { type: "boolean" } },
              { name: "Atlassian-Transfer-Id", in: "header", required: true, schema: { type: "string" } },
            ],
            requestBody: {
              required: true,
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    required: ["fields"],
                    properties: {
                      fields: { type: "object", additionalProperties: true },
                    },
                  },
                },
              },
            },
            responses: { "204": { description: "ok" } },
          },
        },
      },
    }));

    generateFromOpenAPI({
      specPath,
      patchDir,
      outputDir,
      importPrefix: "..",
      clientImport,
      traitsImport: resolve("src/traits"),
    });

    const generatedPath = join(outputDir, "issuesCreate.ts");
    const generated = await readFile(generatedPath, "utf8");
    expect(generated).toContain(
      'updateHistory: Schema.optional(Schema.Boolean).pipe(T.QueryParam("updateHistory"))',
    );
    expect(generated).toContain(
      '"Atlassian-Transfer-Id": Schema.String.pipe(T.HeaderParam("Atlassian-Transfer-Id"))',
    );

    const module = await importGenerated(generatedPath);
    const inputSchema = module.IssuesCreateInput;
    const parts = T.buildRequestParts(
      inputSchema.ast,
      T.getHttpTrait(inputSchema.ast)!,
      {
        updateHistory: true,
        "Atlassian-Transfer-Id": "transfer-123",
        fields: { summary: "Generated request shape" },
      },
      inputSchema,
    );
    expect(parts.query).toEqual({ updateHistory: "true" });
    expect(parts.headers).toEqual({
      "Atlassian-Transfer-Id": "transfer-123",
    });
    expect(parts.body).toEqual({
      fields: { summary: "Generated request shape" },
    });
  });

  test("annotates Swagger 2 query and header parameters with wire names", async () => {
    const root = await mkdtemp(join(tmpdir(), "distilled-openapi-"));
    roots.push(root);
    const specPath = join(root, "swagger.json");
    const outputDir = join(root, "operations");
    const patchDir = join(root, "patches");
    await mkdir(patchDir);
    await Bun.write(specPath, JSON.stringify({
      swagger: "2.0",
      info: { title: "test", version: "1" },
      paths: {
        "/search": {
          post: {
            operationId: "search.run",
            parameters: [
              { name: "page-size", in: "query", type: "integer" },
              { name: "X-Trace-Id", in: "header", type: "string", required: true },
              {
                name: "body",
                in: "body",
                schema: {
                  type: "object",
                  properties: { phrase: { type: "string" } },
                },
              },
            ],
            responses: { "204": { description: "ok" } },
          },
        },
      },
    }));

    generateFromOpenAPI({ specPath, patchDir, outputDir, importPrefix: ".." });
    const generated = await readFile(join(outputDir, "searchRun.ts"), "utf8");
    expect(generated).toContain(
      '"page-size": Schema.optional(Schema.Number).pipe(T.QueryParam("page-size"))',
    );
    expect(generated).toContain(
      '"X-Trace-Id": Schema.String.pipe(T.HeaderParam("X-Trace-Id"))',
    );
  });

  test("generates HEAD, OPTIONS, and TRACE with deterministic coverage", async () => {
    const root = await mkdtemp(join(tmpdir(), "distilled-openapi-"));
    roots.push(root);
    const specPath = join(root, "openapi.json");
    const outputDir = join(root, "operations");
    const patchDir = join(root, "patches");
    await mkdir(patchDir);
    const clientImport = await writeClientStub(root);
    await Bun.write(specPath, JSON.stringify({
      openapi: "3.1.0",
      info: { title: "method probe", version: "2026-07" },
      paths: {
        "/probe": {
          head: {
            operationId: "probe.head",
            responses: { "204": { description: "ok" } },
          },
          options: {
            operationId: "probe.options",
            responses: { "204": { description: "ok" } },
          },
          trace: {
            operationId: "probe.trace",
            responses: { "204": { description: "ok" } },
          },
        },
        "/legacy": {
          get: {
            operationId: "legacy.get",
            deprecated: true,
            responses: { "204": { description: "ok" } },
          },
        },
      },
    }));

    const coverage = generateFromOpenAPI({
      specPath,
      patchDir,
      outputDir,
      importPrefix: "..",
      clientImport,
      traitsImport: resolve("src/traits"),
    });

    expect(await readFile(join(outputDir, "probeHead.ts"), "utf8")).toContain(
      'T.Http({ method: "HEAD", path: "/probe" })',
    );
    expect(await readFile(join(outputDir, "probeOptions.ts"), "utf8")).toContain(
      'method: "OPTIONS" as unknown as T.HttpMethod',
    );
    expect(await readFile(join(outputDir, "probeTrace.ts"), "utf8")).toContain(
      'method: "TRACE" as unknown as T.HttpMethod',
    );
    expect(coverage.operations).toMatchObject({
      total: 4,
      deprecated: 1,
      skippedDeprecated: 1,
      attempted: 3,
      generated: 3,
      failed: 0,
      unsupported: 0,
    });
    expect(coverage.operations.byMethod.HEAD.generated).toBe(1);
    expect(coverage.operations.byMethod.OPTIONS.generated).toBe(1);
    expect(coverage.operations.byMethod.TRACE.generated).toBe(1);
    expect(
      JSON.parse(await readFile(join(outputDir, "coverage.json"), "utf8")),
    ).toEqual(coverage);

    const optionsModule = await importGenerated(join(outputDir, "probeOptions.ts"));
    expect(
      T.getHttpTrait(optionsModule.ProbeOptionsInput.ast)?.method as
        | string
        | undefined,
    ).toBe("OPTIONS");
  });

  test("aggregates operation failures without replacing existing output", async () => {
    const root = await mkdtemp(join(tmpdir(), "distilled-openapi-"));
    roots.push(root);
    const specPath = join(root, "openapi.json");
    const outputDir = join(root, "operations");
    const patchDir = join(root, "patches");
    await mkdir(patchDir);
    await mkdir(outputDir);
    await writeFile(join(outputDir, "sentinel.ts"), "export const sentinel = true;\n");
    await Bun.write(specPath, JSON.stringify({
      openapi: "3.0.3",
      info: { title: "test", version: "1" },
      paths: {
        "/one": {
          get: {
            operationId: "duplicate.operation",
            responses: { "204": { description: "ok" } },
          },
        },
        "/two": {
          get: {
            operationId: "duplicate.operation",
            responses: { "204": { description: "ok" } },
          },
        },
        "/three": {
          get: {
            operationId: "duplicate.operation",
            responses: { "204": { description: "ok" } },
          },
        },
      },
    }));

    let failure: unknown;
    try {
      generateFromOpenAPI({ specPath, patchDir, outputDir, importPrefix: ".." });
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(OpenAPIGenerationError);
    const generationError = failure as OpenAPIGenerationError;
    expect(generationError.errors).toHaveLength(2);
    expect(generationError.coverage.operations).toMatchObject({
      total: 3,
      attempted: 3,
      generated: 1,
      failed: 2,
    });
    expect(await readdir(outputDir)).toEqual(["sentinel.ts"]);
    expect(await readFile(join(outputDir, "sentinel.ts"), "utf8")).toBe(
      "export const sentinel = true;\n",
    );
  });

  test("removes stale generated operations before writing", async () => {
    const root = await mkdtemp(join(tmpdir(), "distilled-openapi-"));
    roots.push(root);
    const specPath = join(root, "openapi.json");
    const outputDir = join(root, "operations");
    const patchDir = join(root, "patches");
    await mkdir(patchDir);
    await mkdir(outputDir);
    await writeFile(join(outputDir, "LegacyName.ts"), "export const stale = true;\n");
    await Bun.write(specPath, JSON.stringify({
      openapi: "3.0.3",
      info: { title: "test", version: "1" },
      paths: {
        "/health": {
          get: {
            operationId: "Health.Check",
            responses: { "204": { description: "ok" } },
          },
        },
      },
    }));

    await generateFromOpenAPI({ specPath, patchDir, outputDir, importPrefix: ".." });
    expect(await readFile(join(outputDir, "healthCheck.ts"), "utf8")).toContain(
      "export const healthCheck",
    );
    expect(await readFile(join(outputDir, "healthCheck.ts"), "utf8")).toStartWith(
      "// Generated by @kevinmichaelchen/distilled.",
    );
    expect(access(join(outputDir, "LegacyName.ts"))).rejects.toThrow();
  });
});
