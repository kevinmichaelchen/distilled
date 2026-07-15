import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
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
    const generated = await readFile(join(outputDir, "teamsget.ts"), "utf8");
    expect(generated).toContain('"enterprise-team": Schema.String.pipe(T.PathParam())');
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
    const generated = await readFile(join(outputDir, "AlertsListToplineAlerts.ts"), "utf8");
    expect(generated).toContain("export const AlertsListToplineAlerts");
    expect(generated).toContain('path: "/console/v1/alerts"');
  });
});
