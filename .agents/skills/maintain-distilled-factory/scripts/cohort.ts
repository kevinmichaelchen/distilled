#!/usr/bin/env bun

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const CORE_PACKAGE = "@kevinmichaelchen/distilled";
const MANIFEST_PATH = "docs/sdk-manifest.json";
const decoder = new TextDecoder();

type Mode = "status" | "verify" | "regenerate";

type ManifestEntry = {
  readonly id: string;
  readonly package: string;
  readonly strategy: string;
  readonly version: string;
  readonly operations: number;
};

type PackageJson = {
  readonly name?: string;
  readonly version?: string;
  readonly scripts?: Readonly<Record<string, string>>;
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly devDependencies?: Readonly<Record<string, string>>;
  readonly peerDependencies?: Readonly<Record<string, string>>;
};

type Coverage = {
  readonly operations?: {
    readonly total?: number;
    readonly generated?: number;
    readonly failed?: number;
    readonly unsupported?: number;
  };
};

type GitState = {
  readonly branch: string;
  readonly head: string;
  readonly dirtyCount: number;
};

type Inspection = {
  readonly id: string;
  readonly root: string;
  readonly manifest?: ManifestEntry;
  readonly packageJson?: PackageJson;
  readonly coreRange?: string;
  readonly git?: GitState;
  readonly coverage?: Coverage["operations"];
  readonly blocking: string[];
  readonly health: string[];
};

type Cli = {
  readonly mode: Mode;
  readonly dryRun: boolean;
  readonly allowDirty: boolean;
  readonly providers: readonly string[];
};

const usage = `Usage:
  bun cohort.ts status [--providers id,id]
  bun cohort.ts verify [--providers id,id] [--dry-run] [--allow-dirty]
  bun cohort.ts regenerate [--providers id,id] [--dry-run] [--allow-dirty]

Modes:
  status       Read repository, package, Git, and coverage state only.
  verify       Run each repository's own check and build scripts.
  regenerate   Run provider generate, check, and build scripts.

This helper never installs, commits, pushes, dispatches, or publishes.`;

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function parseCli(argv: readonly string[]): Cli {
  if (argv.length === 0 || argv.includes("--help") || argv.includes("-h")) {
    console.log(usage);
    process.exit(0);
  }

  const [rawMode, ...rest] = argv;
  if (!(rawMode === "status" || rawMode === "verify" || rawMode === "regenerate")) {
    fail(`Unknown mode: ${rawMode ?? "<missing>"}\n\n${usage}`);
  }

  let dryRun = false;
  let allowDirty = false;
  const providers: string[] = [];
  for (let index = 0; index < rest.length; index += 1) {
    const argument = rest[index];
    if (argument === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (argument === "--allow-dirty") {
      allowDirty = true;
      continue;
    }

    const inline = argument.startsWith("--providers=")
      ? argument.slice("--providers=".length)
      : undefined;
    if (argument === "--providers" || argument === "--provider") {
      const value = rest[index + 1];
      if (!value) fail(`${argument} requires a comma-separated value.`);
      providers.push(...value.split(","));
      index += 1;
      continue;
    }
    if (inline !== undefined) {
      providers.push(...inline.split(","));
      continue;
    }
    fail(`Unknown argument: ${argument}\n\n${usage}`);
  }

  const normalized = providers.map((provider) => provider.trim()).filter(Boolean);
  if (normalized.includes("all") && normalized.length > 1) {
    fail('Use "all" by itself or list provider ids without it.');
  }
  if (rawMode === "status" && dryRun) {
    fail("status is already read-only; omit --dry-run.");
  }
  if (rawMode === "status" && allowDirty) {
    fail("status does not mutate worktrees; omit --allow-dirty.");
  }

  return {
    mode: rawMode,
    dryRun,
    allowDirty,
    providers: [...new Set(normalized)],
  };
}

async function readJson<T>(path: string): Promise<T> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not read ${path}: ${message}`, { cause: error });
  }
}

async function findFactoryRoot(): Promise<string> {
  let current = resolve(import.meta.dir);
  while (true) {
    const packagePath = resolve(current, "package.json");
    const manifestPath = resolve(current, MANIFEST_PATH);
    if (existsSync(packagePath) && existsSync(manifestPath)) {
      const packageJson = await readJson<PackageJson>(packagePath);
      if (packageJson.name === CORE_PACKAGE) return current;
    }

    const parent = dirname(current);
    if (parent === current) {
      fail(`Could not find the ${CORE_PACKAGE} repository above ${import.meta.dir}.`);
    }
    current = parent;
  }
}

function capture(command: string[], cwd: string): string {
  const result = Bun.spawnSync(command, {
    cwd,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = decoder.decode(result.stdout).trim();
  const stderr = decoder.decode(result.stderr).trim();
  if (result.exitCode !== 0) {
    throw new Error(stderr || stdout || `${command.join(" ")} exited ${result.exitCode}`);
  }
  return stdout;
}

function inspectGit(root: string): GitState {
  const branch = capture(["git", "branch", "--show-current"], root) || "detached";
  const head = capture(["git", "rev-parse", "--short", "HEAD"], root);
  const dirty = capture(
    ["git", "status", "--porcelain=v1", "--untracked-files=all"],
    root,
  );
  return {
    branch,
    head,
    dirtyCount: dirty ? dirty.split(/\r?\n/u).length : 0,
  };
}

function coreRange(packageJson: PackageJson): string | undefined {
  return (
    packageJson.dependencies?.[CORE_PACKAGE] ??
    packageJson.devDependencies?.[CORE_PACKAGE] ??
    packageJson.peerDependencies?.[CORE_PACKAGE]
  );
}

async function inspect(
  id: string,
  root: string,
  requiredScripts: readonly string[],
  manifest?: ManifestEntry,
  coveragePolicy: "strict" | "report" = "strict",
): Promise<Inspection> {
  const blocking: string[] = [];
  const health: string[] = [];
  if (!existsSync(root)) {
    blocking.push(`repository is missing at ${root}`);
    return { id, root, manifest, blocking, health };
  }

  let packageJson: PackageJson | undefined;
  try {
    packageJson = await readJson<PackageJson>(resolve(root, "package.json"));
  } catch (error) {
    blocking.push(error instanceof Error ? error.message : String(error));
  }

  let git: GitState | undefined;
  try {
    git = inspectGit(root);
  } catch (error) {
    blocking.push(`Git inspection failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (packageJson) {
    for (const script of requiredScripts) {
      if (!packageJson.scripts?.[script]) blocking.push(`package.json is missing script "${script}"`);
    }
    if (manifest) {
      if (packageJson.name !== manifest.package) {
        blocking.push(`package name is ${packageJson.name ?? "missing"}; expected ${manifest.package}`);
      }
      if (packageJson.version !== manifest.version) {
        health.push(`package version is ${packageJson.version ?? "missing"}; manifest has ${manifest.version}`);
      }
    }
  }

  const range = packageJson && manifest ? coreRange(packageJson) : undefined;
  if (packageJson && manifest && !range) {
    blocking.push(`package.json does not declare ${CORE_PACKAGE}`);
  }

  let coverage: Coverage["operations"];
  if (manifest) {
    const coverageProblems = coveragePolicy === "strict" ? blocking : health;
    const coveragePath = resolve(root, "src/services/coverage.json");
    const expectsCoverage = !manifest.strategy.toLowerCase().includes("typed");
    if (existsSync(coveragePath)) {
      try {
        coverage = (await readJson<Coverage>(coveragePath)).operations;
        if (!coverage) {
          coverageProblems.push("coverage.json has no operations summary");
        } else {
          for (const field of ["total", "generated", "failed", "unsupported"] as const) {
            if (typeof coverage[field] !== "number" || !Number.isFinite(coverage[field])) {
              coverageProblems.push(`coverage operations.${field} must be a finite number`);
            }
          }
          if (typeof coverage.generated === "number" && coverage.generated !== manifest.operations) {
            coverageProblems.push(
              `coverage generated ${coverage.generated}; manifest has ${manifest.operations}`,
            );
          }
          if (typeof coverage.total === "number" && typeof coverage.generated === "number" && coverage.total < coverage.generated) {
            coverageProblems.push(
              `coverage total ${coverage.total} is less than generated ${coverage.generated}`,
            );
          }
          if (typeof coverage.failed === "number" && coverage.failed !== 0) {
            coverageProblems.push(`coverage reports ${coverage.failed} failed operations`);
          }
          if (typeof coverage.unsupported === "number" && coverage.unsupported !== 0) {
            coverageProblems.push(
              `coverage reports ${coverage.unsupported} unsupported operations`,
            );
          }
        }
      } catch (error) {
        coverageProblems.push(error instanceof Error ? error.message : String(error));
      }
    } else if (expectsCoverage) {
      coverageProblems.push(`missing ${coveragePath}`);
    }
  }

  return {
    id,
    root,
    manifest,
    packageJson,
    coreRange: range,
    git,
    coverage,
    blocking,
    health,
  };
}

function printInspection(item: Inspection): void {
  const git = item.git
    ? `${item.git.branch}@${item.git.head} ${item.git.dirtyCount === 0 ? "clean" : `dirty(${item.git.dirtyCount})`}`
    : "unavailable";
  const version = item.packageJson?.version ?? "unavailable";
  const range = item.manifest ? ` core=${item.coreRange ?? "missing"}` : "";
  const coverage = item.coverage
    ? ` coverage=${item.coverage.generated ?? "?"}/${item.coverage.total ?? "?"}` +
      ` failed=${item.coverage.failed ?? "?"} unsupported=${item.coverage.unsupported ?? "?"}`
    : "";
  console.log(`${item.id}: version=${version}${range} git=${git}${coverage}`);
  console.log(`  ${item.root}`);
  for (const issue of item.blocking) console.error(`  ERROR: ${issue}`);
  for (const issue of item.health) console.error(`  HEALTH: ${issue}`);
}

function selectProviders(
  manifest: readonly ManifestEntry[],
  requested: readonly string[],
): readonly ManifestEntry[] {
  const byId = new Map(manifest.map((entry) => [entry.id, entry]));
  if (byId.size !== manifest.length) fail("SDK manifest contains duplicate provider ids.");
  if (requested.length === 0 || requested[0] === "all") return manifest;
  for (const id of requested) {
    if (!byId.has(id)) fail(`Unknown provider "${id}". Expected: ${[...byId.keys()].join(", ")}`);
  }
  const selected = new Set(requested);
  return manifest.filter((entry) => selected.has(entry.id));
}

function providerRoot(factoryRoot: string, entry: ManifestEntry): string {
  const prefix = "@kevinmichaelchen/";
  if (!entry.package.startsWith(prefix)) {
    fail(`Cannot derive a repository name from package ${entry.package}.`);
  }
  return resolve(dirname(factoryRoot), entry.package.slice(prefix.length));
}

async function runScript(root: string, script: string, dryRun: boolean): Promise<number> {
  const command = [Bun.which("bun") ?? process.execPath, "run", script];
  if (dryRun) {
    console.log(`[dry-run] ${root}: bun run ${script}`);
    return 0;
  }
  console.log(`\n[${root}] bun run ${script}`);
  const child = Bun.spawn(command, {
    cwd: root,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  return child.exited;
}

async function main(): Promise<void> {
  const cli = parseCli(process.argv.slice(2));
  const factoryRoot = await findFactoryRoot();
  const manifest = await readJson<readonly ManifestEntry[]>(
    resolve(factoryRoot, MANIFEST_PATH),
  );
  if (!Array.isArray(manifest)) fail(`${MANIFEST_PATH} must contain an array.`);

  const providers = selectProviders(manifest, cli.providers);
  const core = await inspect("core", factoryRoot, ["check", "build"]);
  const providerInspections = await Promise.all(
    providers.map((entry) =>
      inspect(
        entry.id,
        providerRoot(factoryRoot, entry),
        ["generate", "check", "build"],
        entry,
        cli.mode === "regenerate" ? "report" : "strict",
      ),
    ),
  );
  const inspections = [core, ...providerInspections];

  console.log(`Distilled cohort (${providers.length} provider${providers.length === 1 ? "" : "s"})`);
  for (const item of inspections) printInspection(item);

  const blocking = inspections.flatMap((item) => item.blocking.map((issue) => `${item.id}: ${issue}`));
  const unhealthy = inspections.flatMap((item) => item.health.map((issue) => `${item.id}: ${issue}`));
  if (cli.mode === "status") {
    if (blocking.length > 0 || unhealthy.length > 0) process.exit(1);
    return;
  }
  if (blocking.length > 0) {
    fail(`Cannot run ${cli.mode}; fix the structural errors above first.`);
  }
  const dirty = inspections.filter((item) => (item.git?.dirtyCount ?? 0) > 0);
  if (!cli.dryRun && dirty.length > 0 && !cli.allowDirty) {
    fail(
      `Refusing ${cli.mode} because these selected worktrees are dirty: ${dirty
        .map((item) => item.id)
        .join(", ")}. Inspect staged and unstaged diffs, submodules, and write-path overlap; then rerun with --allow-dirty only if preserving those changes is safe.`,
    );
  }

  const failures: string[] = [];
  const units = [
    { id: "core", root: factoryRoot, scripts: ["check", "build"] },
    ...providerInspections.map((item) => ({
      id: item.id,
      root: item.root,
      scripts: cli.mode === "regenerate" ? ["generate", "check", "build"] : ["check", "build"],
    })),
  ];

  for (const unit of units) {
    for (const script of unit.scripts) {
      const exitCode = await runScript(unit.root, script, cli.dryRun);
      if (exitCode !== 0) {
        failures.push(`${unit.id}: bun run ${script} exited ${exitCode}`);
        break;
      }
    }
  }

  if (failures.length > 0) {
    console.error("\nCohort command failures:");
    for (const failure of failures) console.error(`- ${failure}`);
    process.exit(1);
  }

  if (cli.dryRun) return;

  const finalInspections = await Promise.all(
    providers.map((entry) =>
      inspect(
        entry.id,
        providerRoot(factoryRoot, entry),
        ["generate", "check", "build"],
        entry,
        "strict",
      ),
    ),
  );
  const finalIssues = finalInspections.flatMap((item) => [
    ...item.blocking.map((issue) => `${item.id}: ${issue}`),
    ...item.health.map((issue) => `${item.id}: ${issue}`),
  ]);
  if (finalIssues.length > 0) {
    console.error("\nPost-run cohort issues:");
    for (const issue of finalIssues) console.error(`- ${issue}`);
    process.exit(1);
  }
}

await main();
