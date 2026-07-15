import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

type Sdk = {
  readonly id: string;
  readonly name: string;
  readonly package: string;
  readonly version: string;
  readonly operations: number;
  readonly source: string;
  readonly strategy: string;
  readonly authentication: string;
  readonly implementationVisibility: string;
  readonly specificationVisibility: string;
};

const root = resolve(import.meta.dir, "..");
const manifestPath = resolve(root, "docs/sdk-manifest.json");
const supportMatrixPath = resolve(root, "docs/sdks/support-matrix.mdx");
const args = new Set(process.argv.slice(2));
const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as ReadonlyArray<Sdk>;

const renderSupportMatrix = (sdks: ReadonlyArray<Sdk>): string => `---
title: SDK support matrix
description: Versions, operation counts, source strategies, and authentication requirements for every Distilled SDK.
sidebar:
  label: Support matrix
  icon: table-properties
  order: 2
---

All Distilled SDKs are independently versioned preview releases. Operation counts refer to generated operation modules, not every exported schema or type.

| SDK | Version | Operations | Authoritative input | Authentication |
| --- | ---: | ---: | --- | --- |
${sdks.map((sdk) => `| [${sdk.name}](/sdks/${sdk.id}) | [${sdk.version}](https://www.npmjs.com/package/${sdk.package}) | ${sdk.operations.toLocaleString("en-US")} | ${sdk.source} | ${sdk.authentication} |`).join("\n")}

## Source posture

| SDK | Factory strategy | Implementation | Specification |
| --- | --- | --- | --- |
${sdks.map((sdk) => `| ${sdk.name} | ${sdk.strategy} | ${sdk.implementationVisibility} | ${sdk.specificationVisibility} |`).join("\n")}

:::note[Public packages, intentionally private factory inputs]
The npm packages are public, Apache-2.0 licensed, and include their generated TypeScript source. Provider implementation and mirrored-specification repositories are currently private unless the table says otherwise, so anonymous GitHub visitors cannot inspect those links yet.
:::

## Runtime contract

Every package targets Effect 4, ships compiled ESM and declarations for standard Node.js runtimes, exposes TypeScript source directly to Bun, and publishes through npm trusted publishing with GitHub OIDC.
`;

const expectedMatrix = renderSupportMatrix(manifest);

if (args.has("--write")) {
  await writeFile(supportMatrixPath, expectedMatrix);
  console.log("Updated docs/sdks/support-matrix.mdx");
} else {
  const actualMatrix = await readFile(supportMatrixPath, "utf8").catch(() => "");
  if (actualMatrix !== expectedMatrix) {
    throw new Error("SDK support matrix is stale. Run `bun run docs:generate`.");
  }
}

for (const sdk of manifest) {
  const page = await readFile(resolve(root, `docs/sdks/${sdk.id}.mdx`), "utf8");
  const required = [
    `badge: ${sdk.version}`,
    `${sdk.operations.toLocaleString("en-US")} operations`,
    `https://www.npmjs.com/package/${sdk.package}`,
  ];
  for (const value of required) {
    if (!page.includes(value)) {
      throw new Error(`docs/sdks/${sdk.id}.mdx is missing manifest value: ${value}`);
    }
  }
}

if (args.has("--registry")) {
  const versions = await Promise.all(manifest.map(async (sdk) => {
    const response = await fetch(`https://registry.npmjs.org/${encodeURIComponent(sdk.package)}/latest`);
    if (!response.ok) throw new Error(`npm registry returned ${response.status} for ${sdk.package}`);
    const metadata = await response.json() as { version?: string };
    return [sdk, metadata.version] as const;
  }));
  for (const [sdk, published] of versions) {
    if (published !== sdk.version) {
      throw new Error(`${sdk.package}: manifest has ${sdk.version}, npm has ${published ?? "no version"}`);
    }
  }
}

console.log(`Verified documentation metadata for ${manifest.length} SDKs.`);
