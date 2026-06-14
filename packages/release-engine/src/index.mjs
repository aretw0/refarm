#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";

export const DEFAULT_POLICY_VERSION = "2026-01";

const DEFAULT_EMBEDDED_CONFIG_CANDIDATES = [
  ".refarm/config.json",
  "refarm.config.json",
];

const DEFAULT_PHASES = [
  {
    id: "preflight",
    name: "Preflight",
    commands: ["echo preflight"],
    required: true,
    riskWeight: 2,
  },
  {
    id: "quality",
    name: "Quality Gates",
    commands: ["echo quality-gates"],
    required: true,
    riskWeight: 3,
  },
  {
    id: "integration",
    name: "Integration smoke",
    commands: ["echo integration-smoke"],
    required: true,
    riskWeight: 4,
  },
  {
    id: "runtime",
    name: "Runtime descriptor release smoke",
    commands: ["echo runtime-descriptor-smoke"],
    required: true,
    riskWeight: 2,
  },
];

const DEFAULT_PROVIDERS = [
  {
    id: "noop",
    type: "noop",
    supportsPublish: false,
    supportsDryRun: false,
  },
];

const BUMP_WEIGHT = {
  patch: 1,
  minor: 2,
  major: 3,
};

function ensureDirExists(baseDir) {
  if (!fs.existsSync(baseDir)) {
    throw new Error(`Directory not found: ${baseDir}`);
  }
}

function readEmbeddedConfig(cwd = process.cwd()) {
  for (const candidate of DEFAULT_EMBEDDED_CONFIG_CANDIDATES) {
    const file = path.join(cwd, candidate);
    if (!fs.existsSync(file)) continue;

    try {
      const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
      if (!parsed || typeof parsed !== "object") continue;
      if (parsed.releasePolicy && typeof parsed.releasePolicy === "object") {
        return parsed.releasePolicy;
      }
    } catch (error) {
      // Ignore malformed embedded config files and continue to next candidate.
      continue;
    }
  }

  return null;
}

export function loadPolicy(policyPath = "release-policy.json", cwd = process.cwd()) {
  const absPath = path.resolve(cwd, policyPath);

  if (!fs.existsSync(absPath)) {
    if (policyPath === "release-policy.json") {
      const embeddedPolicy = readEmbeddedConfig(cwd);
      if (embeddedPolicy) {
        return embeddedPolicy;
      }
    }

    return {
      policyVersion: DEFAULT_POLICY_VERSION,
      mode: "changeset",
      providers: DEFAULT_PROVIDERS,
      packageProfiles: [],
      phases: DEFAULT_PHASES,
      notes: ["Using fallback policy because no release policy file was found."],
    };
  }

  const text = fs.readFileSync(absPath, "utf8");
  const parsed = JSON.parse(text);
  return parsed;
}

export function validatePolicy(policy) {
  assert.equal(typeof policy.policyVersion, "string", "policyVersion must be a string");
  const allowedModes = ["changeset", "tagged", "hybrid"];
  assert.ok(
    allowedModes.includes(policy.mode),
    `mode must be one of: ${allowedModes.join(", ")}`,
  );
  assert.ok(Array.isArray(policy.providers), "providers must be an array");
  assert.ok(Array.isArray(policy.phases), "phases must be an array");

  if (policy.phases.length === 0) {
    throw new Error("At least one phase is required");
  }

  for (const phase of policy.phases) {
    assert.ok(phase.id, `phase id is required: ${JSON.stringify(phase)}`);
    assert.ok(phase.name, `phase name is required: ${phase.id}`);
    assert.ok(Array.isArray(phase.commands), `phase commands must be array for ${phase.id}`);
    assert.equal(typeof phase.required, "boolean", `phase.required must be boolean for ${phase.id}`);
    assert.ok(typeof phase.riskWeight === "number", `phase.riskWeight must be numeric for ${phase.id}`);
  }

  return true;
}

function readJson(absPath) {
  return JSON.parse(fs.readFileSync(absPath, "utf8"));
}

function readPackageJsonsForWorkspace(cwd = process.cwd()) {
  const packagesDir = path.join(cwd, "packages");
  ensureDirExists(packagesDir);

  const result = new Map();
  const entries = fs.readdirSync(packagesDir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const manifestPath = path.join(packagesDir, entry.name, "package.json");
    if (!fs.existsSync(manifestPath)) continue;

    const pkg = readJson(manifestPath);
    if (!pkg.name || !pkg.version) continue;

    result.set(pkg.name, {
      name: pkg.name,
      version: pkg.version,
      dir: entry.name,
      dependencies: {
        ...(pkg.dependencies || {}),
        ...(pkg.peerDependencies || {}),
      },
      devDependencies: pkg.devDependencies || {},
      private: Boolean(pkg.private),
      manifestPath,
      manifestDir: path.join(packagesDir, entry.name),
    });
  }

  return result;
}

function parseChangesetFrontMatter(text) {
  const match = text.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return [];

  const body = match[1];
  const packages = [];

  for (const line of body.split("\n")) {
    const m = line.match(/^\"([^\"]+)\":\s*(patch|minor|major)\s*$/);
    if (!m) continue;
    const [, name, bump] = m;
    packages.push({
      name,
      bump,
    });
  }

  return packages;
}

function readChangesetCandidates(cwd = process.cwd()) {
  const changesetDir = path.join(cwd, ".changeset");
  if (!fs.existsSync(changesetDir)) return [];

  const entries = fs.readdirSync(changesetDir, { withFileTypes: true });
  const selected = new Map();

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".md") || entry.name === "README.md") {
      continue;
    }

    const absPath = path.join(changesetDir, entry.name);
    const text = fs.readFileSync(absPath, "utf8");
    for (const item of parseChangesetFrontMatter(text)) {
      const current = selected.get(item.name);
      if (!current || BUMP_WEIGHT[item.bump] > BUMP_WEIGHT[current]) {
        selected.set(item.name, item.bump);
      }
    }
  }

  return [...selected.entries()].map(([name, bump]) => ({
    name,
    bump,
    source: "changeset",
  }));
}

function resolveCandidatePackages({ cwd, packageNames, policy }) {
  const allPackages = readPackageJsonsForWorkspace(cwd);
  let candidates = packageNames
    ? packageNames.filter(Boolean).map((name) => ({ name, bump: "patch", source: "manual" }))
    : readChangesetCandidates(cwd);

  const normalized = [];
  for (const candidate of candidates) {
    if (!allPackages.has(candidate.name)) {
      normalized.push({
        ...candidate,
        status: "missing",
        note: `Package ${candidate.name} is not a workspace package`
      });
      continue;
    }

    const entry = allPackages.get(candidate.name);
    if (entry.private) {
      normalized.push({
        ...candidate,
        status: "blocked",
        note: `Private package cannot enter public release plan by default: ${candidate.name}`
      });
      continue;
    }

    const profile = (policy.packageProfiles || []).find((item) => item.id === candidate.name);
    normalized.push({
      ...candidate,
      status: "ok",
      source: candidate.source || "manual",
      bump: candidate.bump || (profile && profile.bump) || "patch",
      profile,
      packageDir: entry.dir,
      currentVersion: entry.version,
    });
  }

  return { allPackages, candidates: normalized };
}

function topologicalOrder(candidates, allPackages) {
  const included = new Set(candidates.map((item) => item.name));
  const adj = new Map();
  const indeg = new Map();

  for (const item of candidates) {
    adj.set(item.name, []);
    indeg.set(item.name, 0);
  }

  for (const item of candidates) {
    const pkg = allPackages.get(item.name);
    if (!pkg) continue;

    for (const depName of Object.keys(pkg.dependencies)) {
      if (!included.has(depName)) continue;
      // If package depends on depName, depName must go first.
      adj.get(depName)?.push(item.name);
      indeg.set(item.name, (indeg.get(item.name) || 0) + 1);
    }
  }

  const queue = [...indeg.entries()].filter(([, degree]) => degree === 0).map(([name]) => name);
  const order = [];

  while (queue.length > 0) {
    const current = queue.shift();
    order.push(current);

    for (const next of adj.get(current) || []) {
      const nextIn = indeg.get(next) - 1;
      indeg.set(next, nextIn);
      if (nextIn === 0) queue.push(next);
    }
  }

  if (order.length !== candidates.length) {
    const remaining = [...indeg.entries()]
      .filter(([, degree]) => degree > 0)
      .map(([name]) => name);
    throw new Error(`Topological order unresolved (cycle or malformed dependency graph): ${remaining.join(", ")}`);
  }

  return order;
}

export function buildReleasePlan({ cwd = process.cwd(), policyPath = "release-policy.json", packageNames, dryRun = false } = {}) {
  const policy = loadPolicy(policyPath, cwd);
  validatePolicy(policy);

  const { allPackages, candidates } = resolveCandidatePackages({ cwd, packageNames, policy });
  const ready = candidates.filter((item) => item.status === "ok");
  const blockers = candidates.filter((item) => item.status !== "ok");

  if (ready.length === 0 && blockers.length > 0) {
    return {
      ok: false,
      status: "blocked",
      policy,
      blockers,
      orderedPackages: [],
      orderedNames: [],
      gates: policy.phases,
      releaseNotes: "No releasable packages after validation.",
      dryRun,
    };
  }

  const orderedNames = topologicalOrder(ready, allPackages);
  const orderedPackages = orderedNames
    .map((name) => ready.find((item) => item.name === name))
    .filter(Boolean)
    .map((item) => ({
      ...item,
      planOrder: orderedNames.indexOf(item.name) + 1,
    }));

  const requiredProviders = policy.providers.filter((provider) => provider.type && provider.supportsPublish);
  const publishIntents = requiredProviders.map((provider) => {
    const versionCommands = Array.isArray(provider.publishCommands)
      ? provider.publishCommands
      : [];
    const dryRunCommands = Array.isArray(provider.publishDryRunCommands)
      ? provider.publishDryRunCommands
      : versionCommands;

    return {
      provider: provider.id,
      type: provider.type,
      plan: {
        mode: policy.mode,
        commands: versionCommands,
        dryRunCommands,
        requiresManualApproval: provider.publishRequiresManualApproval ?? (policy.mode === "changeset"),
      },
    };
  });

  return {
    ok: true,
    status: "ready",
    policy,
    blockers,
    orderedPackages,
    orderedNames,
    gates: policy.phases,
    publishIntents,
    dryRun,
    releaseNotes: `Ready to release ${orderedNames.length} package(s): ${orderedNames.join(", ")}`,
  };
}

export function runCommand(command, { cwd = process.cwd(), dryRun = false }) {
  if (dryRun) {
    return {
      command,
      status: "skipped",
      stdout: "",
      stderr: "",
      code: 0,
      dryRun: true,
    };
  }

  const result = spawnSync(command, {
    cwd,
    stdio: "pipe",
    encoding: "utf8",
    shell: true,
  });

  return {
    command,
    status: result.status === 0 ? "passed" : "failed",
    stdout: result.stdout || "",
    stderr: result.stderr || "",
    code: result.status ?? -1,
    signal: result.signal,
  };
}

export function runReleaseGates(plan, { cwd = process.cwd(), dryRun = false, onlyRequired = false } = {}) {
  const results = [];
  const phasesToRun = onlyRequired ? plan.gates.filter((gate) => gate.required) : plan.gates;

  for (const phase of phasesToRun) {
    for (const command of phase.commands) {
      const result = runCommand(command, { cwd, dryRun });
      results.push({
        phase: phase.id,
        phaseName: phase.name,
        ...result,
      });

      if (result.status === "failed") {
        return {
          ok: false,
          blockedBy: phase,
          phase: phase.id,
          command: command,
          results,
          policy: plan.policy,
          dryRun,
        };
      }
    }
  }

  return {
    ok: true,
    results,
    policy: plan.policy,
    dryRun,
  };
}

export function formatPlan(plan) {
  if (!plan?.ok) {
    const blockerNames = (plan.blockers || []).map((entry) => `${entry.name}: ${entry.note || entry.status}`).join("; ") || "no blockers captured";
    return [
      "Release plan status: BLOCKED",
      `Gate reason: ${plan.status}`,
      `Blockers: ${blockerNames}`,
    ].join("\n");
  }

  const lineA = `Release plan status: ${plan.status}`;
  const lineB = `Packages (${plan.orderedNames.length}): ${plan.orderedNames.join(", ")}`;
  const lineC = `Phases: ${plan.gates.map((gate) => gate.id).join(", ")}`;
  const lineD = `Publish providers: ${plan.publishIntents.map((item) => item.provider).join(", ")}`;

  return [lineA, lineB, lineC, lineD].join("\n");
}

export function summarizePlan(plan) {
  return {
    status: plan.status,
    packageCount: plan.orderedNames?.length || 0,
    packages: plan.orderedNames || [],
    blockers: plan.blockers || [],
    requiredGates: (plan.gates || []).filter((gate) => gate.required).map((gate) => gate.id),
    providers: (plan.publishIntents || []).map((item) => item.provider),
    ok: Boolean(plan.ok),
    dryRun: Boolean(plan.dryRun),
  };
}
