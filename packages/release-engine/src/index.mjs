#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

export const DEFAULT_POLICY_VERSION = "2026-01";
export const SUPPORTED_POLICY_VERSIONS = [DEFAULT_POLICY_VERSION];
export const RELEASE_ENGINE_JSON_SCHEMA_VERSION = 1;
export const RELEASE_PLAN_AUDIT_SCHEMA_VERSION = 1;

export class ReleasePolicyValidationError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "ReleasePolicyValidationError";
    this.code = code;
    this.details = details;
  }
}

const DEFAULT_EMBEDDED_CONFIG_CANDIDATES = [
  "refarm.config.json",
  ".refarm/config.json",
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

const ALLOWED_PROFILE_RISKS = ["core", "app", "plugin", "shared"];
const ALLOWED_RELEASE_SURFACES = ["core", "app", "plugin", "agent", "shared"];

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
  assertPolicy(
    typeof policy.policyVersion === "string",
    "RELEASE_POLICY_VERSION_REQUIRED",
    "policyVersion must be a string",
    { policyVersion: policy.policyVersion ?? null },
  );
  assertPolicy(
    SUPPORTED_POLICY_VERSIONS.includes(policy.policyVersion),
    "RELEASE_POLICY_VERSION_UNSUPPORTED",
    `policyVersion must be one of: ${SUPPORTED_POLICY_VERSIONS.join(", ")}`,
    {
      policyVersion: policy.policyVersion,
      supportedPolicyVersions: SUPPORTED_POLICY_VERSIONS,
    },
  );
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

  if (policy.packageProfiles !== undefined && !Array.isArray(policy.packageProfiles)) {
    throw new Error("packageProfiles must be an array when declared");
  }

  if (policy.surfaceBlocks !== undefined && !Array.isArray(policy.surfaceBlocks)) {
    throw new Error("surfaceBlocks must be an array when declared");
  }

  for (const phase of policy.phases) {
    assert.ok(phase.id, `phase id is required: ${JSON.stringify(phase)}`);
    assert.ok(phase.name, `phase name is required: ${phase.id}`);
    assert.ok(Array.isArray(phase.commands), `phase commands must be array for ${phase.id}`);
    assert.equal(typeof phase.required, "boolean", `phase.required must be boolean for ${phase.id}`);
    assert.ok(typeof phase.riskWeight === "number", `phase.riskWeight must be numeric for ${phase.id}`);
  }

  const providerIds = new Set();
  for (const provider of policy.providers) {
    assertProvider(
      provider.id,
      "RELEASE_POLICY_PROVIDER_ID_REQUIRED",
      `provider id is required: ${JSON.stringify(provider)}`,
      { provider },
    );
    if (providerIds.has(provider.id)) {
      throw providerPolicyError(
        "RELEASE_POLICY_PROVIDER_DUPLICATE_ID",
        `Duplicate provider id: ${provider.id}`,
        provider,
      );
    }
    providerIds.add(provider.id);

    assertProvider(
      typeof provider.type === "string",
      "RELEASE_POLICY_PROVIDER_TYPE_INVALID",
      `provider.type must be string for ${provider.id}`,
      { providerId: provider.id },
    );
    assertProvider(
      typeof provider.supportsPublish === "boolean",
      "RELEASE_POLICY_PROVIDER_SUPPORTS_PUBLISH_INVALID",
      `provider.supportsPublish must be boolean for ${provider.id}`,
      { providerId: provider.id },
    );
    assertProvider(
      typeof provider.supportsDryRun === "boolean",
      "RELEASE_POLICY_PROVIDER_SUPPORTS_DRY_RUN_INVALID",
      `provider.supportsDryRun must be boolean for ${provider.id}`,
      { providerId: provider.id },
    );
    validateCommandList(
      provider.publishCommands,
      `provider.publishCommands for ${provider.id}`,
      "RELEASE_POLICY_PROVIDER_COMMANDS_INVALID",
      provider.id,
    );
    validateCommandList(
      provider.publishDryRunCommands,
      `provider.publishDryRunCommands for ${provider.id}`,
      "RELEASE_POLICY_PROVIDER_DRY_RUN_COMMANDS_INVALID",
      provider.id,
    );

    if (provider.supportsPublish && (!Array.isArray(provider.publishCommands) || provider.publishCommands.length === 0)) {
      throw providerPolicyError(
        "RELEASE_POLICY_PROVIDER_PUBLISH_COMMANDS_REQUIRED",
        `provider publishCommands must be a non-empty array when supportsPublish is true for ${provider.id}`,
        provider,
      );
    }
  }

  const profileIds = new Set();
  const allowedProfileBumps = ["patch", "minor", "major"];
  for (const profile of policy.packageProfiles || []) {
    assert.ok(profile.id, `package profile id is required: ${JSON.stringify(profile)}`);
    if (profileIds.has(profile.id)) {
      throw new Error(`Duplicate package profile id: ${profile.id}`);
    }
    profileIds.add(profile.id);

    if (profile.risk !== undefined && !ALLOWED_PROFILE_RISKS.includes(profile.risk)) {
      throw new Error(`package profile risk must be one of: ${ALLOWED_PROFILE_RISKS.join(", ")} for ${profile.id}`);
    }

    if (profile.surface !== undefined && !ALLOWED_RELEASE_SURFACES.includes(profile.surface)) {
      throw new Error(`package profile surface must be one of: ${ALLOWED_RELEASE_SURFACES.join(", ")} for ${profile.id}`);
    }

    if (profile.bump !== undefined && !allowedProfileBumps.includes(profile.bump)) {
      throw new Error(`package profile bump must be one of: ${allowedProfileBumps.join(", ")} for ${profile.id}`);
    }

    if (profile.tags !== undefined && !Array.isArray(profile.tags)) {
      throw new Error(`package profile tags must be array for ${profile.id}`);
    }
  }

  const blockedSurfaces = new Set();
  for (const block of policy.surfaceBlocks || []) {
    if (!block || typeof block !== "object") {
      throw new Error("surfaceBlocks entries must be objects");
    }
    if (!ALLOWED_RELEASE_SURFACES.includes(block.surface)) {
      throw new Error(`surfaceBlocks.surface must be one of: ${ALLOWED_RELEASE_SURFACES.join(", ")}`);
    }
    if (blockedSurfaces.has(block.surface)) {
      throw new Error(`Duplicate release surface block: ${block.surface}`);
    }
    blockedSurfaces.add(block.surface);
    if (block.reason !== undefined && typeof block.reason !== "string") {
      throw new Error(`surfaceBlocks.reason must be a string for ${block.surface}`);
    }
  }

  if (policy.defaultSelection !== undefined && typeof policy.defaultSelection !== "string") {
    throw new Error("defaultSelection must be a string");
  }

  if (policy.selections !== undefined && !Array.isArray(policy.selections)) {
    throw new Error("selections must be an array");
  }

  const selections = Array.isArray(policy.selections) ? policy.selections : [];
  const selectionIds = new Set();
  for (const selection of selections) {
    assert.ok(selection.id, `selection id is required: ${JSON.stringify(selection)}`);
    if (selectionIds.has(selection.id)) {
      throw new Error(`Duplicate release policy selection id: ${selection.id}`);
    }
    selectionIds.add(selection.id);

    if (!Array.isArray(selection.profileTags) || selection.profileTags.length === 0) {
      throw new Error(`selection profileTags must be a non-empty array for ${selection.id}`);
    }

    for (const tag of selection.profileTags) {
      if (typeof tag !== "string" || tag.length === 0) {
        throw new Error(`selection profileTags must contain non-empty strings for ${selection.id}`);
      }
    }
  }

  if (policy.defaultSelection && !selectionIds.has(policy.defaultSelection)) {
    throw new Error(`defaultSelection does not match a declared selection: ${policy.defaultSelection}`);
  }

  return true;
}

function providerPolicyError(code, message, provider) {
  return new ReleasePolicyValidationError(code, message, {
    providerId: provider?.id ?? null,
    providerType: provider?.type ?? null,
  });
}

function assertProvider(condition, code, message, details) {
  if (!condition) {
    throw new ReleasePolicyValidationError(code, message, details);
  }
}

function assertPolicy(condition, code, message, details) {
  if (!condition) {
    throw new ReleasePolicyValidationError(code, message, details);
  }
}

function validateCommandList(commands, label, code, providerId) {
  if (commands === undefined) return;
  if (!Array.isArray(commands)) {
    throw new ReleasePolicyValidationError(code, `${label} must be an array`, {
      providerId,
    });
  }

  for (const command of commands) {
    if (typeof command !== "string" || command.length === 0) {
      throw new ReleasePolicyValidationError(code, `${label} must contain non-empty strings`, {
        providerId,
      });
    }
  }
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

function resolveCandidatePackages({ cwd, packageNames, policy, profileTags = [] }) {
  const allPackages = readPackageJsonsForWorkspace(cwd);
  const surfaceBlocks = new Map(
    (policy.surfaceBlocks || []).map((block) => [block.surface, block]),
  );
  const explicitPackageNames = Array.isArray(packageNames)
    ? packageNames.filter(Boolean)
    : [];
  let candidates = explicitPackageNames.length > 0
    ? explicitPackageNames.map((name) => ({ name, bump: "patch", source: "manual" }))
    : profileTags.length > 0
      ? (policy.packageProfiles || [])
          .filter((profile) => profileHasTags(profile, profileTags))
          .map((profile) => ({
            name: profile.id,
            bump: profile.bump || "patch",
            source: "policy-tag",
          }))
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
    const surface = profile?.surface || profile?.risk || null;
    if (surface && surfaceBlocks.has(surface)) {
      const block = surfaceBlocks.get(surface);
      normalized.push({
        ...candidate,
        status: "blocked",
        surface,
        note: block.reason || `Release surface is blocked: ${surface}`,
      });
      continue;
    }

    normalized.push({
      ...candidate,
      status: "ok",
      source: candidate.source || "manual",
      bump: candidate.bump || (profile && profile.bump) || "patch",
      profile,
      surface,
      packageDir: entry.dir,
      currentVersion: entry.version,
    });
  }

  return { allPackages, candidates: normalized };
}

export function resolvePolicySelection(policy, selectionId = "default") {
  const selections = Array.isArray(policy?.selections) ? policy.selections : [];
  const resolvedId = selectionId === "default"
    ? policy?.defaultSelection
    : selectionId;
  if (!resolvedId) return null;
  return selections.find((selection) => selection?.id === resolvedId) || null;
}

function requirePolicySelection(policy, selectionId) {
  const selection = resolvePolicySelection(policy, selectionId);
  if (selection) return selection;

  const declared = Array.isArray(policy?.selections)
    ? policy.selections.map((item) => item?.id).filter(Boolean)
    : [];
  const suffix = declared.length > 0
    ? ` Available selections: ${declared.join(", ")}.`
    : " No selections are declared in the active release policy.";
  const target = selectionId === "default"
    ? `default (${policy?.defaultSelection || "not configured"})`
    : selectionId;
  throw new Error(`Release policy selection not found: ${target}.${suffix}`);
}

function profileHasTags(profile, requiredTags) {
  const tags = new Set(Array.isArray(profile?.tags) ? profile.tags : []);
  return requiredTags.every((tag) => tags.has(tag));
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

export function buildReleasePlan({
  cwd = process.cwd(),
  policyPath = "release-policy.json",
  packageNames,
  profileTags = [],
  selectionId,
  dryRun = false,
} = {}) {
  const policy = loadPolicy(policyPath, cwd);
  validatePolicy(policy);

  const selection = profileTags.length > 0
    ? null
    : selectionId ? requirePolicySelection(policy, selectionId) : null;
  const resolvedProfileTags = profileTags.length > 0
    ? profileTags
    : Array.isArray(selection?.profileTags) ? selection.profileTags : [];
  const { allPackages, candidates } = resolveCandidatePackages({
    cwd,
    packageNames,
    policy,
    profileTags: resolvedProfileTags,
  });
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
    profileTags: resolvedProfileTags,
    selection: selection
      ? {
          id: selection.id,
          description: selection.description || null,
        }
      : null,
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
  const profileTags = releasePlanPackageProfiles(plan)
    .map((item) => `${item.id}[${item.tags.join(",") || item.risk}]`)
    .join("; ");
  const lineE = profileTags ? `Profiles: ${profileTags}` : "Profiles: none";

  return [lineA, lineB, lineC, lineD, lineE].join("\n");
}

export function summarizePlan(plan) {
  return {
    status: plan.status,
    packageCount: plan.orderedNames?.length || 0,
    packages: plan.orderedNames || [],
    blockers: plan.blockers || [],
    packageProfiles: releasePlanPackageProfiles(plan),
    requiredGates: (plan.gates || []).filter((gate) => gate.required).map((gate) => gate.id),
    providers: (plan.publishIntents || []).map((item) => item.provider),
    profileTags: plan.profileTags || [],
    selection: plan.selection || null,
    ok: Boolean(plan.ok),
    dryRun: Boolean(plan.dryRun),
  };
}

function stableJsonValue(value) {
  if (Array.isArray(value)) {
    return value.map((item) => stableJsonValue(item));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .filter((key) => value[key] !== undefined)
        .map((key) => [key, stableJsonValue(value[key])]),
    );
  }

  return value;
}

export function stringifyReleasePlanAuditPayload(payload) {
  return JSON.stringify(stableJsonValue(payload));
}

function hashReleasePlanAuditPayload(payload) {
  return createHash("sha256")
    .update(stringifyReleasePlanAuditPayload(payload))
    .digest("hex");
}

export function createReleasePlanAuditRecord(plan, { createdAt = new Date().toISOString() } = {}) {
  const payload = {
    schemaVersion: RELEASE_PLAN_AUDIT_SCHEMA_VERSION,
    releaseOutputSchemaVersion: RELEASE_ENGINE_JSON_SCHEMA_VERSION,
    ok: Boolean(plan.ok),
    status: plan.status,
    policyVersion: plan.policy?.policyVersion ?? null,
    mode: plan.policy?.mode ?? null,
    packageCount: plan.orderedNames?.length || 0,
    packages: plan.orderedNames || [],
    blockers: plan.blockers || [],
    packageProfiles: releasePlanPackageProfiles(plan),
    requiredGates: (plan.gates || [])
      .filter((gate) => gate.required)
      .map((gate) => gate.id),
    gates: (plan.gates || []).map((gate) => ({
      id: gate.id,
      required: gate.required,
      riskWeight: gate.riskWeight,
      commandCount: Array.isArray(gate.commands) ? gate.commands.length : 0,
    })),
    publishIntents: (plan.publishIntents || []).map((intent) => ({
      provider: intent.provider,
      type: intent.type || null,
      mode: intent.plan?.mode || null,
      commandCount: Array.isArray(intent.plan?.commands) ? intent.plan.commands.length : 0,
      dryRunCommandCount: Array.isArray(intent.plan?.dryRunCommands)
        ? intent.plan.dryRunCommands.length
        : 0,
      requiresManualApproval: Boolean(intent.plan?.requiresManualApproval),
    })),
    profileTags: plan.profileTags || [],
    selection: plan.selection || null,
    dryRun: Boolean(plan.dryRun),
  };

  return {
    schemaVersion: RELEASE_PLAN_AUDIT_SCHEMA_VERSION,
    createdAt,
    digest: {
      algorithm: "sha256",
      value: hashReleasePlanAuditPayload(payload),
    },
    payload,
  };
}

export function releasePlanPackageProfiles(plan) {
  return (plan.orderedPackages || [])
    .map((entry) => {
      if (!entry?.profile) {
        return {
          id: entry.name,
          risk: null,
          surface: null,
          tags: [],
          mustPassChecks: [],
        };
      }
      return {
        id: entry.name,
        risk: entry.profile.risk ?? null,
        surface: entry.profile.surface ?? entry.profile.risk ?? null,
        tags: Array.isArray(entry.profile.tags) ? entry.profile.tags : [],
        mustPassChecks: Array.isArray(entry.profile.mustPassChecks)
          ? entry.profile.mustPassChecks
          : [],
      };
    });
}
