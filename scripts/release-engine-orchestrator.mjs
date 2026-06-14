#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const argv = process.argv.slice(2);

function usage() {
  console.log(`Usage:
  node scripts/release-engine-orchestrator.mjs [--repo <path> ...] <plan|check|gates> [release-engine args]

Examples:
  node scripts/release-engine-orchestrator.mjs --repo . --repo ../vault-seed plan --only-required --json
  node scripts/release-engine-orchestrator.mjs --repo ../agents-lab check --only-required --json
`);
}

const parse = () => {
  const opts = {
    repos: [],
    args: [],
    command: "plan",
    passthrough: [],
  };

  let i = 0;
  while (i < argv.length) {
    const token = argv[i];

    if (token === "--repo") {
      i += 1;
      if (i >= argv.length) {
        throw new Error("--repo requires a path");
      }
      opts.repos.push(argv[i]);
      i += 1;
      continue;
    }

    if (token === "--help" || token === "-h") {
      opts.showHelp = true;
      i += 1;
      continue;
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

    if (!opts.commandSet) {
      // backward-compatible default command remains `plan`; treat first arg as command if unknown.
      opts.command = token;
      opts.commandSet = true;
      i += 1;
      continue;
    }

    opts.passthrough.push(token);
    i += 1;
  }

  if (!opts.repos.length) {
    opts.repos.push(".");
  }

  return opts;
};

function runForRepo(repoDir, command, passthrough, engineCli) {
  const resolvedRepo = path.resolve(repoDir);
  if (!fs.existsSync(resolvedRepo)) {
    return {
      repo: repoDir,
      command,
      ok: false,
      exitCode: 1,
      stdout: "",
      stderr: `Repository not found: ${resolvedRepo}`,
    };
  }

  const args = [engineCli, command, ...passthrough];
  const result = spawnSync(process.execPath, args, {
    cwd: resolvedRepo,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  return {
    repo: resolvedRepo,
    command,
    ok: result.status === 0,
    exitCode: result.status ?? 1,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
  };
}

function main() {
  let options;
  try {
    options = parse();
  } catch (error) {
    console.error(error.message);
    usage();
    process.exit(1);
  }

  if (options.showHelp) {
    usage();
    process.exit(0);
  }

  const engineCli = path.join(process.cwd(), "packages", "release-engine", "src", "cli.mjs");

  const results = options.repos.map((repo) => runForRepo(repo, options.command, options.passthrough, engineCli));

  const allOk = results.every((result) => result.ok);
  const payload = {
    command: options.command,
    repos: results,
    ok: allOk,
  };

  console.log(JSON.stringify(payload, null, 2));

  process.exit(allOk ? 0 : 1);
}

main();
