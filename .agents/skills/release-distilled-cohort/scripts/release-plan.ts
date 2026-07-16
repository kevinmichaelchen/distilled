#!/usr/bin/env bun

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const CORE_PACKAGE = "@kevinmichaelchen/distilled";
const MANIFEST_PATH = "docs/sdk-manifest.json";
const PUBLISH_WORKFLOW = ".github/workflows/publish.yml";
const decoder = new TextDecoder();

type ManifestEntry = {
  readonly id: string;
  readonly package: string;
  readonly version: string;
  readonly operations: number;
  readonly strategy: string;
};

type PackageJson = {
  readonly name?: string;
  readonly version?: string;
  readonly scripts?: Readonly<Record<string, string>>;
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly devDependencies?: Readonly<Record<string, string>>;
  readonly peerDependencies?: Readonly<Record<string, string>>;
};

type Cli = {
  readonly registry: boolean;
  readonly json: boolean;
  readonly coreOnly: boolean;
  readonly providers: readonly string[];
};

type GitState = {
  readonly branch: string;
  readonly sha: string;
  readonly upstream?: string;
  readonly ahead?: number;
  readonly behind?: number;
  readonly dirtyCount: number;
  readonly docsDirtyCount: number;
  readonly submodules: readonly string[];
  readonly submoduleError?: string;
};

type WorkflowState = {
  readonly path: string;
  readonly valid: boolean;
  readonly problems: readonly string[];
};

type RegistryState = {
  readonly latest?: string;
  readonly localVersionPublished?: boolean;
  readonly publishedGitHead?: string;
  readonly requiredCoreVersion?: string;
  readonly requiredCorePublished?: boolean;
  readonly error?: string;
};

type LedgerEntry = {
  readonly id: string;
  readonly repository: string;
  readonly root: string;
  readonly package: string;
  readonly version: string;
  readonly manifestVersion?: string;
  readonly operations?: number;
  readonly strategy?: string;
  readonly coreRange?: string;
  readonly resolvedCoreVersion?: string;
  readonly git: GitState;
  readonly workflow: WorkflowState;
  registry?: RegistryState;
  readonly blockers: string[];
  readonly notes: string[];
};

type RegistryDocument = {
  readonly ["dist-tags"]?: Readonly<Record<string, string>>;
  readonly versions?: Readonly<
    Record<
      string,
      {
        readonly gitHead?: string;
      }
    >
  >;
};

type RegistryLookup = {
  readonly state: RegistryState;
  readonly versions: ReadonlySet<string>;
};

const usage = `Usage:
  bun release-plan.ts [--providers id,id] [--registry] [--json]
  bun release-plan.ts --core-only [--registry] [--json]

Options:
  --providers  Limit the provider ledger; the shared core is always included.
  --core-only  Inspect only a shared-core release.
  --registry   Read current package versions from the public npm registry.
  --json       Emit the ledger as JSON.

This command is read-only. It never edits, commits, pushes, dispatches, or publishes.`;

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function parseCli(argv: readonly string[]): Cli {
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(usage);
    process.exit(0);
  }

  let registry = false;
  let json = false;
  let coreOnly = false;
  const providers: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--registry") {
      registry = true;
      continue;
    }
    if (argument === "--json") {
      json = true;
      continue;
    }
    if (argument === "--core-only") {
      coreOnly = true;
      continue;
    }
    if (argument === "--providers" || argument === "--provider") {
      const value = argv[index + 1];
      if (!value) fail(`${argument} requires a comma-separated value.`);
      providers.push(...value.split(","));
      index += 1;
      continue;
    }
    if (argument.startsWith("--providers=")) {
      providers.push(...argument.slice("--providers=".length).split(","));
      continue;
    }
    fail(`Unknown argument: ${argument}\n\n${usage}`);
  }

  const normalized = [...new Set(providers.map((id) => id.trim()).filter(Boolean))];
  if (normalized.includes("all") && normalized.length > 1) {
    fail('Use "all" by itself or list provider ids without it.');
  }
  if (coreOnly && normalized.length > 0) {
    fail("--core-only cannot be combined with --providers.");
  }
  return { registry, json, coreOnly, providers: normalized };
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
    if (existsSync(packagePath) && existsSync(resolve(current, MANIFEST_PATH))) {
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

function run(command: readonly string[], cwd: string): {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
} {
  const result = Bun.spawnSync([...command], {
    cwd,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    exitCode: result.exitCode,
    stdout: decoder.decode(result.stdout).trim(),
    stderr: decoder.decode(result.stderr).trim(),
  };
}

function capture(command: readonly string[], cwd: string): string {
  const result = run(command, cwd);
  if (result.exitCode !== 0) {
    throw new Error(result.stderr || result.stdout || `${command.join(" ")} exited ${result.exitCode}`);
  }
  return result.stdout;
}

function lines(value: string): readonly string[] {
  return value ? value.split(/\r?\n/u).filter(Boolean) : [];
}

function inspectGit(root: string): GitState {
  const branch = capture(["git", "branch", "--show-current"], root) || "detached";
  const sha = capture(["git", "rev-parse", "HEAD"], root);
  const dirty = lines(capture(["git", "status", "--porcelain=v1", "--untracked-files=all"], root));
  const docsDirty = lines(
    capture(["git", "status", "--porcelain=v1", "--untracked-files=all", "--", "docs"], root),
  );
  const submoduleResult = run(["git", "submodule", "status", "--recursive"], root);
  const upstreamResult = run(["git", "rev-parse", "--abbrev-ref", "@{upstream}"], root);

  let upstream: string | undefined;
  let ahead: number | undefined;
  let behind: number | undefined;
  if (upstreamResult.exitCode === 0) {
    upstream = upstreamResult.stdout;
    const counts = capture(
      ["git", "rev-list", "--left-right", "--count", "HEAD...@{upstream}"],
      root,
    ).split(/\s+/u);
    ahead = Number(counts[0]);
    behind = Number(counts[1]);
  }

  return {
    branch,
    sha,
    upstream,
    ahead,
    behind,
    dirtyCount: dirty.length,
    docsDirtyCount: docsDirty.length,
    submodules: submoduleResult.exitCode === 0 ? lines(submoduleResult.stdout) : [],
    submoduleError:
      submoduleResult.exitCode === 0
        ? undefined
        : submoduleResult.stderr || submoduleResult.stdout || "git submodule status failed",
  };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function isPublishCommand(value: unknown): boolean {
  return (
    typeof value === "string" &&
    value.split(/\r?\n/u).some((line) => /^\s*npm\s+publish(?:\s|$)/u.test(line))
  );
}

function environmentName(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  const environment = asRecord(value);
  return typeof environment?.name === "string" ? environment.name : undefined;
}

function findNpmTokenAuth(value: unknown, path = "workflow", found = new Set<string>()): Set<string> {
  const tokenPattern = /NODE_AUTH_TOKEN|NPM_TOKEN|_authToken|npm-token/iu;
  if (typeof value === "string") {
    if (tokenPattern.test(value)) found.add(path);
    return found;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => findNpmTokenAuth(item, `${path}[${index}]`, found));
    return found;
  }
  const record = asRecord(value);
  if (!record) return found;
  for (const [key, item] of Object.entries(record)) {
    const childPath = `${path}.${key}`;
    if (tokenPattern.test(key)) found.add(childPath);
    findNpmTokenAuth(item, childPath, found);
  }
  return found;
}

async function readWorkflow(root: string): Promise<WorkflowState> {
  const path = resolve(root, PUBLISH_WORKFLOW);
  if (!existsSync(path)) {
    return { path, valid: false, problems: [`missing ${PUBLISH_WORKFLOW}`] };
  }
  const content = await readFile(path, "utf8");
  const problems: string[] = [];
  let document: Record<string, unknown> | undefined;
  try {
    document = asRecord(Bun.YAML.parse(content));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { path, valid: false, problems: [`invalid YAML: ${message}`] };
  }
  if (!document) return { path, valid: false, problems: ["workflow root is not an object"] };
  const tokenAuth = [...findNpmTokenAuth(document)];
  if (tokenAuth.length > 0) {
    problems.push(`token-based npm authentication is forbidden: ${tokenAuth.join(", ")}`);
  }

  const trigger = document.on;
  const triggerNames =
    typeof trigger === "string"
      ? [trigger]
      : Array.isArray(trigger)
        ? trigger.filter((name): name is string => typeof name === "string")
        : Object.keys(asRecord(trigger) ?? {});
  if (triggerNames.length !== 1 || triggerNames[0] !== "workflow_dispatch") {
    problems.push(
      `workflow triggers must be dispatch-only; found ${triggerNames.join(", ") || "none"}`,
    );
  }

  const jobs = asRecord(document.jobs);
  if (!jobs) return { path, valid: false, problems: [...problems, "missing jobs object"] };
  const publishJobs = Object.entries(jobs).filter(([, value]) => {
    const job = asRecord(value);
    const steps = Array.isArray(job?.steps) ? job.steps : [];
    return steps.some((step) => isPublishCommand(asRecord(step)?.run));
  });
  if (publishJobs.length !== 1) {
    problems.push(`expected exactly one job with an npm publish step; found ${publishJobs.length}`);
  }

  const publishJob = asRecord(publishJobs[0]?.[1]);
  if (publishJob) {
    const permissions = asRecord(publishJob.permissions) ?? asRecord(document.permissions);
    if (permissions?.["id-token"] !== "write") problems.push("missing effective id-token: write");
    if (permissions?.contents !== "read") problems.push("missing effective contents: read");
    if (environmentName(publishJob.environment) !== "npm") {
      problems.push("publish job does not use the npm environment");
    }

    const steps = Array.isArray(publishJob.steps) ? publishJob.steps : [];
    const setupNode = steps
      .map(asRecord)
      .find((step) => typeof step?.uses === "string" && step.uses.startsWith("actions/setup-node@"));
    const setupNodeWith = asRecord(setupNode?.with);
    if (String(setupNodeWith?.["node-version"] ?? "") !== "24") {
      problems.push("publish job does not configure Node 24");
    }
  }

  const references: string[] = [];
  for (const value of Object.values(jobs)) {
    const job = asRecord(value);
    if (typeof job?.uses === "string") references.push(job.uses);
    const steps = Array.isArray(job?.steps) ? job.steps : [];
    for (const step of steps) {
      const reference = asRecord(step)?.uses;
      if (typeof reference === "string") references.push(reference);
    }
  }
  for (const reference of references) {
    if (!reference.startsWith("./") && !/@[0-9a-f]{40}$/u.test(reference)) {
      problems.push(`action is not commit-pinned: ${reference}`);
    }
  }
  return { path, valid: problems.length === 0, problems };
}

function coreRange(packageJson: PackageJson): string | undefined {
  return (
    packageJson.dependencies?.[CORE_PACKAGE] ??
    packageJson.devDependencies?.[CORE_PACKAGE] ??
    packageJson.peerDependencies?.[CORE_PACKAGE]
  );
}

async function resolvedCoreVersion(root: string): Promise<string | undefined> {
  const lockPath = resolve(root, "bun.lock");
  if (!existsSync(lockPath)) return undefined;
  try {
    const document = asRecord(Bun.JSONC.parse(await readFile(lockPath, "utf8")));
    const packages = asRecord(document?.packages);
    const entry = packages?.[CORE_PACKAGE];
    if (!Array.isArray(entry) || typeof entry[0] !== "string") return undefined;
    const prefix = `${CORE_PACKAGE}@`;
    return entry[0].startsWith(prefix) ? entry[0].slice(prefix.length) : undefined;
  } catch {
    return undefined;
  }
}

function providerRoot(factoryRoot: string, packageName: string): string {
  const prefix = "@kevinmichaelchen/";
  if (!packageName.startsWith(prefix)) {
    fail(`Cannot derive a repository name from package ${packageName}.`);
  }
  return resolve(dirname(factoryRoot), packageName.slice(prefix.length));
}

function repositoryName(packageName: string): string {
  return packageName === CORE_PACKAGE
    ? "kevinmichaelchen/distilled"
    : `kevinmichaelchen/${packageName.slice("@kevinmichaelchen/".length)}`;
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

async function makeLedgerEntry(
  id: string,
  root: string,
  manifest?: ManifestEntry,
  coreVersion?: string,
): Promise<LedgerEntry> {
  if (!existsSync(root)) fail(`Missing repository for ${id}: ${root}`);
  const packageJson = await readJson<PackageJson>(resolve(root, "package.json"));
  if (!packageJson.name || !packageJson.version) {
    fail(`${root}/package.json must declare name and version.`);
  }

  const git = inspectGit(root);
  const workflow = await readWorkflow(root);
  const blockers: string[] = [];
  const notes: string[] = [];
  if (manifest && packageJson.name !== manifest.package) {
    blockers.push(`package name ${packageJson.name} does not match manifest ${manifest.package}`);
  }
  if (manifest && packageJson.version !== manifest.version) {
    notes.push(
      `Blume manifest still has ${manifest.version}; synchronize it after npm confirms ${packageJson.version}`,
    );
  }
  for (const script of ["check", "build"]) {
    if (!packageJson.scripts?.[script]) blockers.push(`package.json is missing script "${script}"`);
  }
  if (git.dirtyCount > 0) blockers.push(`worktree has ${git.dirtyCount} changed path(s)`);
  if (!git.upstream) blockers.push("branch has no configured upstream");
  if ((git.ahead ?? 0) > 0) blockers.push(`branch is ${git.ahead} commit(s) ahead of upstream`);
  if ((git.behind ?? 0) > 0) blockers.push(`branch is ${git.behind} commit(s) behind upstream`);
  for (const problem of workflow.problems) blockers.push(`publish workflow: ${problem}`);
  const range = manifest ? coreRange(packageJson) : undefined;
  const lockedCore = manifest ? await resolvedCoreVersion(root) : undefined;
  if (manifest && !range) blockers.push(`missing dependency on ${CORE_PACKAGE}`);
  if (manifest && !lockedCore) blockers.push(`bun.lock does not resolve ${CORE_PACKAGE}`);
  if (manifest && range && lockedCore) {
    try {
      if (!Bun.semver.satisfies(lockedCore, range)) {
        blockers.push(`core dependency ${range} does not accept locked core ${lockedCore}`);
      }
    } catch {
      blockers.push(`core dependency is not a valid semver range: ${range}`);
    }
  }
  if (manifest && lockedCore && coreVersion && lockedCore !== coreVersion) {
    notes.push(`provider lock resolves core ${lockedCore}; sibling core is ${coreVersion}`);
  }
  for (const pin of git.submodules) {
    if (/^[+\-U]/u.test(pin)) {
      blockers.push(`source submodule is not at its recorded clean pin: ${pin}`);
    }
  }
  if (manifest && git.submoduleError) {
    blockers.push(`source submodule inspection failed: ${git.submoduleError}`);
  } else if (manifest && git.submodules.length === 0) {
    blockers.push("no source submodule pin was reported");
  }

  return {
    id,
    repository: repositoryName(packageJson.name),
    root,
    package: packageJson.name,
    version: packageJson.version,
    manifestVersion: manifest?.version,
    operations: manifest?.operations,
    strategy: manifest?.strategy,
    coreRange: range,
    resolvedCoreVersion: lockedCore,
    git,
    workflow,
    blockers,
    notes,
  };
}

async function lookupRegistry(packageName: string, localVersion: string): Promise<RegistryLookup> {
  try {
    const encoded = packageName.replace("/", "%2f");
    const response = await fetch(`https://registry.npmjs.org/${encoded}`, {
      headers: { accept: "application/json" },
    });
    if (!response.ok) throw new Error(`npm registry returned HTTP ${response.status}`);
    const document = (await response.json()) as RegistryDocument;
    const versions = new Set(Object.keys(document.versions ?? {}));
    const publishedGitHead = document.versions?.[localVersion]?.gitHead;
    return {
      state: {
        latest: document["dist-tags"]?.latest,
        localVersionPublished: versions.has(localVersion),
        publishedGitHead,
      },
      versions,
    };
  } catch (error) {
    return {
      state: { error: error instanceof Error ? error.message : String(error) },
      versions: new Set(),
    };
  }
}

function printEntry(entry: LedgerEntry): void {
  const git = `${entry.git.branch}@${entry.git.sha.slice(0, 8)}`;
  const upstream = entry.git.upstream
    ? `${entry.git.upstream} ahead=${entry.git.ahead ?? "?"} behind=${entry.git.behind ?? "?"}`
    : "no-upstream";
  const manifest = entry.manifestVersion ? ` manifest=${entry.manifestVersion}` : "";
  const core = entry.coreRange
    ? ` core=${entry.coreRange} locked=${entry.resolvedCoreVersion ?? "unknown"}`
    : "";
  console.log(`\n${entry.id}: ${entry.package}@${entry.version}${manifest}${core}`);
  console.log(`  repo=${entry.repository} git=${git} ${upstream} dirty=${entry.git.dirtyCount}`);
  console.log(`  workflow=${entry.workflow.valid ? "OIDC-ready" : "invalid"}`);
  if (entry.operations !== undefined) {
    console.log(`  operations=${entry.operations} strategy=${entry.strategy ?? "unknown"}`);
  }
  for (const pin of entry.git.submodules) console.log(`  source=${pin}`);
  if (entry.registry) {
    if (entry.registry.error) console.log(`  npm=error (${entry.registry.error})`);
    else {
      console.log(
        `  npm=latest:${entry.registry.latest ?? "unknown"} local-published:${entry.registry.localVersionPublished ? "yes" : "no"}`,
      );
      if (entry.registry.publishedGitHead) {
        console.log(`  npm-git-head=${entry.registry.publishedGitHead}`);
      }
      if (entry.registry.requiredCoreVersion) {
        console.log(
          `  npm-core=${entry.registry.requiredCoreVersion}:${entry.registry.requiredCorePublished ? "published" : "missing"}`,
        );
      }
    }
  }
  for (const note of entry.notes) console.log(`  NOTE: ${note}`);
  for (const blocker of entry.blockers) console.log(`  BLOCKER: ${blocker}`);
}

async function main(): Promise<void> {
  const cli = parseCli(process.argv.slice(2));
  const factoryRoot = await findFactoryRoot();
  const manifest = await readJson<readonly ManifestEntry[]>(resolve(factoryRoot, MANIFEST_PATH));
  if (!Array.isArray(manifest)) fail(`${MANIFEST_PATH} must contain an array.`);
  const selected = cli.coreOnly ? [] : selectProviders(manifest, cli.providers);

  const corePackage = await readJson<PackageJson>(resolve(factoryRoot, "package.json"));
  if (!corePackage.name || !corePackage.version) fail("Core package.json must declare name and version.");
  const entries = [
    await makeLedgerEntry("core", factoryRoot),
    ...(await Promise.all(
      selected.map((entry) =>
        makeLedgerEntry(
          entry.id,
          providerRoot(factoryRoot, entry.package),
          entry,
          corePackage.version,
        ),
      ),
    )),
  ];

  if (cli.registry) {
    const lookups = new Map<string, RegistryLookup>();
    await Promise.all(
      entries.map(async (entry) => {
        lookups.set(entry.package, await lookupRegistry(entry.package, entry.version));
      }),
    );
    const coreLookup = lookups.get(CORE_PACKAGE);
    for (const entry of entries) {
      const lookup = lookups.get(entry.package)!;
      entry.registry = { ...lookup.state };
      if (lookup.state.error) entry.blockers.push(`npm registry: ${lookup.state.error}`);
      if (entry.id === "core" && lookup.state.localVersionPublished) {
        const message = `core ${entry.version} is already published; bump before releasing it again`;
        if (cli.coreOnly) entry.blockers.push(message);
        else entry.notes.push(message);
      } else if (lookup.state.localVersionPublished) {
        entry.blockers.push(`version ${entry.version} is already published; bump before releasing`);
      }
      if (
        lookup.state.latest &&
        !lookup.state.localVersionPublished &&
        Bun.semver.order(entry.version, lookup.state.latest) < 0
      ) {
        entry.blockers.push(`local version ${entry.version} is older than npm latest ${lookup.state.latest}`);
      }
      if (lookup.state.publishedGitHead) {
        const relation = lookup.state.publishedGitHead === entry.git.sha ? "matches" : "differs from";
        entry.notes.push(`published gitHead ${relation} local HEAD ${entry.git.sha}`);
      }
      const requiredCoreVersion = entry.resolvedCoreVersion;
      if (requiredCoreVersion) {
        const published = coreLookup?.state.error
          ? undefined
          : coreLookup?.versions.has(requiredCoreVersion);
        entry.registry = {
          ...entry.registry,
          requiredCoreVersion,
          requiredCorePublished: published,
        };
        if (published === false) {
          entry.blockers.push(`required core ${requiredCoreVersion} is not published on npm`);
        } else if (published === undefined) {
          entry.notes.push(`required core ${requiredCoreVersion} could not be verified because npm state is unknown`);
        }
      }
    }
  }

  const dispatchCandidates = cli.registry
    ? entries.filter(
        (entry) =>
          entry.registry?.localVersionPublished === false &&
          !entry.registry.error &&
          (entry.id === "core" || entry.registry.requiredCorePublished === true) &&
          entry.blockers.length === 0,
      )
    : [];
  const result = {
    registryChecked: cli.registry,
    releaseOrder: cli.coreOnly
      ? [
          "Publish changed core and confirm npm",
          "Synchronize and deploy Blume after registry confirmation",
        ]
      : [
          "Publish changed core and confirm npm",
          "Publish only authorized providers",
          "Synchronize and deploy Blume after registry confirmation",
        ],
    entries,
    suggestedCommands: {
      localVerification: entries.flatMap((entry) => [
        `${entry.root}: bun run check`,
        `${entry.root}: bun run build`,
      ]),
      authorizedDispatchOnly: dispatchCandidates.map(
        (entry) => `gh workflow run publish.yml --repo ${entry.repository} --ref ${entry.git.branch}`,
      ),
      postRegistryDocs: [
        "bun run docs:generate",
        "bun run docs:check:registry",
        "bun run docs:build",
      ],
    },
  };

  if (cli.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`Distilled release plan (${selected.length} provider${selected.length === 1 ? "" : "s"})`);
    console.log(`Registry check: ${cli.registry ? "enabled" : "disabled (offline)"}`);
    for (const entry of entries) printEntry(entry);
    console.log("\nRelease order:");
    result.releaseOrder.forEach((step, index) => console.log(`${index + 1}. ${step}`));
    if (!cli.registry) {
      console.log("\nRun with --registry before calculating any workflow dispatch candidate.");
    } else if (result.suggestedCommands.authorizedDispatchOnly.length === 0) {
      console.log("\nNo package is currently a safe workflow dispatch candidate.");
    } else {
      console.log("\nWorkflow dispatch candidates (never run without explicit publish authorization):");
      result.suggestedCommands.authorizedDispatchOnly.forEach((command) => console.log(`- ${command}`));
    }
  }

  const blockers = entries.flatMap((entry) => entry.blockers.map((blocker) => `${entry.id}: ${blocker}`));
  if (blockers.length > 0) {
    if (!cli.json) console.log(`\nRelease is not ready: ${blockers.length} blocker(s).`);
    process.exit(1);
  }
  if (!cli.json) console.log("\nRelease inputs are locally ready. Publication still requires explicit authorization.");
}

await main();
