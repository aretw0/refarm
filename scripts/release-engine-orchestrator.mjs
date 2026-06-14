#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const argv = process.argv.slice(2);

function usage() {
  console.log(`Usage:
  node scripts/release-engine-orchestrator.mjs [options] [plan|check|gates] [release-engine args]

Options:
  --repo <path>               Add repository path (can be repeated)
  --repo-manifest <path>      Add repositories from JSON manifest file
  --engine-cli <path>         Override release-engine CLI entrypoint/path
  --policy <path>             Default policy file for repositories without per-repo policy override
  -h, --help                 Show this help

Examples:
  node scripts/release-engine-orchestrator.mjs --repo . --repo ../vault-seed plan --only-required --json
  node scripts/release-engine-orchestrator.mjs --repo ../agents-lab check --only-required --json
  node scripts/release-engine-orchestrator.mjs --repo-manifest ./release-workspaces.example.json check --json
  node scripts/release-engine-orchestrator.mjs --repo-manifest ./release-workspaces.example.json --policy ./release-policy.json check --only-required --json
`);
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertString(value, fieldName, pathLabel) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${fieldName} in ${pathLabel} must be a non-empty string`);
  }
  return value;
}

function normalizeRepoLabel(entry, index) {
  const labelByName =
    typeof entry.name === "string" && entry.name.trim().length > 0
      ? entry.name.trim()
      : null;
  const labelByLabel =
    typeof entry.label === "string" && entry.label.trim().length > 0
      ? entry.label.trim()
      : null;
  return labelByLabel ?? labelByName ?? `repo-${index + 1}`;
}

function normalizeStringList(value, fieldName, indexLabel) {
  if (value === undefined) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw new Error(`${fieldName} at ${indexLabel} must be an array`);
  }

  for (const item of value) {
    if (typeof item !== "string") {
      throw new Error(`${fieldName} at ${indexLabel} must contain only strings`);
    }
  }

  return value;
}

function normalizeObjectEntry(entry, index, indexLabel) {
  if (!isObject(entry)) {
    throw new Error(`Invalid repo manifest entry at ${indexLabel}: expected string or object`);
  }

  const rawPath = assertString(entry.path, "path", indexLabel);

  return {
    path: rawPath,
    label: normalizeRepoLabel(entry, index),
    args: normalizeStringList(entry.args, "args", indexLabel),
    policy: typeof entry.policy === "string" && entry.policy.trim().length > 0
      ? entry.policy
      : undefined,
    engineCli: typeof entry.engineCli === "string" && entry.engineCli.trim().length > 0
      ? entry.engineCli
      : undefined,
  };
}

function normalizeStringEntry(entry, index, indexLabel) {
  return {
    path: assertString(entry, "path", indexLabel),
    label: `repo-${index + 1}`,
    args: [],
    policy: undefined,
    engineCli: undefined,
  };
}

function parseRepoManifest(manifestPath) {
  const absPath = path.resolve(manifestPath);
  if (!fs.existsSync(absPath)) {
    throw new Error(`Repo manifest not found: ${absPath}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(absPath, "utf8"));
  } catch (error) {
    throw new Error(
      `Invalid JSON in repo manifest: ${absPath} (${error instanceof Error ? error.message : String(error)})`
    );
  }

  const normalizeEntries = (entries, containerName) => {
    if (!Array.isArray(entries)) {
      throw new Error(`Invalid repo manifest shape at ${containerName}: expected an array`);
    }

    return entries.map((entry, index) => {
      const indexLabel = `${containerName}[${index}]`;
      if (typeof entry === "string") {
        return normalizeStringEntry(entry, index, indexLabel);
      }

      return normalizeObjectEntry(entry, index, indexLabel);
    });
  };

  if (Array.isArray(parsed)) {
    return normalizeEntries(parsed, "repo list");
  }

  if (isObject(parsed)) {
    if (Array.isArray(parsed.repos)) {
      return normalizeEntries(parsed.repos, "repos");
    }

    if (Array.isArray(parsed.repositories)) {
      return normalizeEntries(parsed.repositories, "repositories");
    }

    if (Array.isArray(parsed.paths) && parsed.paths.every((value) => typeof value === "string")) {
      return parsed.paths.map((repoPath, index) => normalizeStringEntry(repoPath, index, `paths[${index}]`));
    }

    if (Array.isArray(parsed.path) && parsed.path.every((value) => typeof value === "string")) {
      return parsed.path.map((repoPath, index) => normalizeStringEntry(repoPath, index, `path[${index}]`));
    }
  }

  throw new Error(`Invalid repo manifest shape: ${absPath}`);
}

function parse() {
  const opts = {
    repos: [],
    passthrough: [],
    command: "plan",
    commandSet: false,
    engineCli: null,
    policy: null,
    showHelp: false,
  };

  let i = 0;
  while (i < argv.length) {
    const token = argv[i];

    if (token === "--help" || token === "-h") {
      opts.showHelp = true;
      i += 1;
      continue;
    }

    if (token === "--repo") {
      i += 1;
      if (i >= argv.length) {
        throw new Error("--repo requires a path");
      }
      opts.repos.push({ path: argv[i], label: path.basename(path.resolve(argv[i])), args: [] });
      i += 1;
      continue;
    }

    if (token === "--repo-manifest") {
      i += 1;
      if (i >= argv.length) {
        throw new Error("--repo-manifest requires a path");
      }
      opts.repos.push(...parseRepoManifest(argv[i]));
      i += 1;
      continue;
    }

    if (token === "--engine-cli") {
      i += 1;
      if (i >= argv.length) {
        throw new Error("--engine-cli requires a value");
      }
      opts.engineCli = argv[i];
      i += 1;
      continue;
    }

    if (token === "--policy") {
      i += 1;
      if (i >= argv.length) {
        throw new Error("--policy requires a path");
      }
      opts.policy = argv[i];
      i += 1;
      continue;
    }

    if (token === "--") {
      if (!opts.commandSet) {
        opts.commandSet = true;
      }
      i += 1;
      opts.passthrough.push(...argv.slice(i));
      break;
    }

    if (!opts.commandSet && token === "plan") {
      opts.command = "plan";
      opts.commandSet = true;
      i += 1;
      continue;
    }

    if (!opts.commandSet && token === "check") {
      opts.command = "check";
      opts.commandSet = true;
      i += 1;
      continue;
    }

    if (!opts.commandSet && token === "gates") {
      opts.command = "gates";
      opts.commandSet = true;
      i += 1;
      continue;
    }

    if (!opts.commandSet && token.startsWith("-")) {
      // permit common flag-first usage; default command remains `plan`.
      opts.passthrough.push(token);
      i += 1;
      continue;
    }

    if (!opts.commandSet) {
      opts.command = token;
      opts.commandSet = true;
      i += 1;
      continue;
    }

    opts.passthrough.push(token);
    i += 1;
  }

  if (!opts.repos.length) {
    opts.repos.push({
      path: ".",
      label: path.basename(path.resolve(process.cwd())) || "repo-1",
      args: [],
      policy: undefined,
      engineCli: undefined,
    });
  }

  return opts;
}

function resolveEngineForRepo(repoDir, overrideCli, repoEngineCli) {
  if (repoEngineCli) {
    return path.resolve(repoEngineCli);
  }

  if (overrideCli) {
    return path.resolve(overrideCli);
  }

  const localSource = path.join(repoDir, "packages", "release-engine", "src", "cli.mjs");
  if (fs.existsSync(localSource)) {
    return localSource;
  }

  const localBin = path.join(repoDir, "node_modules", ".bin", "release-engine");
  if (fs.existsSync(localBin)) {
    return localBin;
  }

  const fallback = path.join(process.cwd(), "packages", "release-engine", "src", "cli.mjs");
  return fallback;
}

function buildRepoPassThrough(repo, basePassThrough, globalPolicy) {
  const repoArgs = Array.isArray(repo.args) ? [...repo.args] : [];
  const args = [...basePassThrough, ...repoArgs];
  const hasPolicyArg = args.includes("--policy");

  if (hasPolicyArg) {
    return args;
  }

  if (repo.policy) {
    args.push("--policy", repo.policy);
    return args;
  }

  if (globalPolicy) {
    args.push("--policy", globalPolicy);
  }

  return args;
}

function runForRepo(repo, command, basePassThrough, overrideEngineCli, globalPolicy) {
  const resolvedRepo = path.resolve(repo.path);
  if (!fs.existsSync(resolvedRepo)) {
    return {
      repo: repo.path,
      label: repo.label,
      command,
      policy: repo.policy ?? globalPolicy ?? null,
      ok: false,
      exitCode: 1,
      durationMs: 0,
      stdout: "",
      stderr: `Repository not found: ${resolvedRepo}`,
    };
  }

  const engineCli = resolveEngineForRepo(resolvedRepo, overrideEngineCli, repo.engineCli);
  if (!fs.existsSync(engineCli)) {
    return {
      repo: repo.path,
      label: repo.label,
      command,
      policy: repo.policy ?? globalPolicy ?? null,
      commandArgs: [],
      ok: false,
      exitCode: 1,
      durationMs: 0,
      engineCli,
      stdout: "",
      stderr: `release-engine entrypoint not found: ${engineCli}`,
    };
  }

  const commandArgs = buildRepoPassThrough(repo, basePassThrough, globalPolicy);

  const start = Date.now();

  const isNodeScript = engineCli.endsWith(".mjs") || engineCli.endsWith(".js");
  const result = isNodeScript
    ? spawnSync(process.execPath, [engineCli, command, ...commandArgs], {
      cwd: resolvedRepo,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    })
    : spawnSync(engineCli, [command, ...commandArgs], {
      cwd: resolvedRepo,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });

  const durationMs = Date.now() - start;

  return {
    repo: repo.path,
    label: repo.label,
    command,
    policy: repo.policy ?? globalPolicy ?? null,
    commandArgs,
    engineCli,
    ok: result.status === 0,
    exitCode: result.status ?? 1,
    durationMs,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
  };
}

function main() {
  let options;
  try {
    options = parse();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    usage();
    process.exit(1);
  }

  if (options.showHelp) {
    usage();
    process.exit(0);
  }

  const repos = options.repos;
  const results = repos.map((repo) =>
    runForRepo(repo, options.command, options.passthrough, options.engineCli, options.policy)
  );
  const allOk = results.every((result) => result.ok);
  const failed = results.filter((result) => !result.ok);

  const payload = {
    command: options.command,
    repositoryCount: repos.length,
    ok: allOk,
    failedCount: failed.length,
    policy: options.policy,
    repos: results,
  };

  console.log(JSON.stringify(payload, null, 2));

  process.exit(allOk ? 0 : 1);
}

main();
