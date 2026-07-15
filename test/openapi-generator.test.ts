import { afterEach, describe, expect, test } from "bun:test";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateFromOpenAPI } from "../scripts/generate-openapi.ts";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

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
    expect(access(join(outputDir, "LegacyName.ts"))).rejects.toThrow();
  });
});
