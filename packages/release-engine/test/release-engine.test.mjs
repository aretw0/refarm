import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import test from "node:test";
import {
  buildReleasePlan,
  formatPlan,
  loadPolicy,
  ReleasePolicyValidationError,
  SUPPORTED_POLICY_VERSIONS,
  validatePolicy,
  summarizePlan,
  releasePlanPackageProfiles,
} from "../src/index.mjs";

function createWorkspace(
  root,
  pkgDefs,
  changesets = [],
  embeddedPolicy = null,
  options = {},
) {
  const packagesDir = path.join(root, "packages");
  fs.mkdirSync(packagesDir, { recursive: true });

  for (const [name, def] of Object.entries(pkgDefs)) {
    const pkgDir = path.join(packagesDir, def.dir);
    fs.mkdirSync(pkgDir, { recursive: true });

    fs.writeFileSync(
      path.join(pkgDir, "package.json"),
      JSON.stringify(
        {
          name,
          version: def.version ?? "0.1.0",
          private: def.private ?? false,
          dependencies: def.dependencies || {},
          devDependencies: {},
          repository: {
            type: "git",
            url: "git+https://github.com/aretw0/refarm.git",
          },
          publishConfig: {
            access: "public",
          },
        },
        null,
        2,
      ) + "\n",
    );
  }

  if (changesets.length > 0) {
    const changesetDir = path.join(root, ".changeset");
    fs.mkdirSync(changesetDir, { recursive: true });
    for (const cs of changesets) {
      const frontMatter = Object.entries(cs.changes)
        .map(([pkg, bump]) => `\"${pkg}\": ${bump}`)
        .join("\n");
      const payload = `---\n${frontMatter}\n---\n\n${cs.body || ""}\n`;
      fs.writeFileSync(
        path.join(changesetDir, `${cs.id || Math.random().toString(36).slice(2)}.md`),
        payload,
      );
    }
  }

  fs.writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify(
      {
        name: "refarm-root",
        version: "1.0.0",
        private: true,
      },
      null,
      2,
    ) + "\n",
  );

  if (embeddedPolicy) {
    const configPath = options.embeddedConfigPath || ".refarm/config.json";
    const cfgDir = path.dirname(path.join(root, configPath));
    fs.mkdirSync(cfgDir, { recursive: true });
    fs.writeFileSync(
      path.join(root, configPath),
      JSON.stringify(
        {
          releasePolicy: embeddedPolicy,
        },
        null,
        2,
      ) + "\n",
    );
  }
}

const fixturePolicy = path.join(process.cwd(), "packages/release-engine/test/fixtures/policy.json");
const packageManifestPath = path.resolve(new URL("../package.json", import.meta.url).pathname);
const cliPath = path.resolve(new URL("../src/cli.mjs", import.meta.url).pathname);
const repoRoot = path.resolve(new URL("../../..", import.meta.url).pathname);

function runCliJson(args) {
  const output = execFileSync(process.execPath, [cliPath, ...args, "--json"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  return JSON.parse(output);
}

function runCliJsonFailure(args) {
  const result = spawnSync(process.execPath, [cliPath, ...args, "--json"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  assert.notEqual(result.status, 0);
  assert.equal(result.stderr, "");
  return JSON.parse(result.stdout);
}

function validPolicy(overrides = {}) {
  return {
    policyVersion: "2026-01",
    mode: "changeset",
    providers: [
      {
        id: "changesets",
        type: "changesets",
        supportsPublish: true,
        supportsDryRun: true,
        publishCommands: ["pnpm changeset publish"],
        publishDryRunCommands: ["pnpm changeset version"],
      },
    ],
    packageProfiles: [],
    phases: [
      {
        id: "preflight",
        name: "Preflight",
        commands: ["echo preflight"],
        required: true,
        riskWeight: 1,
      },
    ],
    ...overrides,
  };
}

function withTempWorkspace(setup) {
  const root = mkdtempSync(path.join(os.tmpdir(), "refarm-release-engine-"));
  try {
    setup(root);
    return root;
  } catch (error) {
    rmSync(root, { recursive: true, force: true });
    throw error;
  }
}

test("loads default policy when config is missing", () => {
  const policy = loadPolicy("__missing_policy__.json", process.cwd());
  assert.equal(policy.mode, "changeset");
  assert.equal(validatePolicy(policy), true);
});

test("validates explicit policy", () => {
  const policy = loadPolicy("packages/release-engine/test/fixtures/policy.json", process.cwd());
  assert.equal(policy.mode, "changeset");
  assert.equal(validatePolicy(policy), true);
});

test("exposes supported release policy versions", () => {
  assert.deepEqual(SUPPORTED_POLICY_VERSIONS, ["2026-01"]);
});

test("rejects unsupported release policy versions with a structured error", () => {
  assert.throws(
    () => validatePolicy(validPolicy({
      policyVersion: "2027-01",
    })),
    (error) => {
      assert.equal(error instanceof ReleasePolicyValidationError, true);
      assert.equal(error.code, "RELEASE_POLICY_VERSION_UNSUPPORTED");
      assert.equal(error.details.policyVersion, "2027-01");
      assert.deepEqual(error.details.supportedPolicyVersions, ["2026-01"]);
      return true;
    },
  );
});

test("exports the release policy schema as a public package subpath", () => {
  const pkg = JSON.parse(fs.readFileSync(packageManifestPath, "utf8"));
  const schemaPath = path.resolve(
    new URL("../release-policy.schema.json", import.meta.url).pathname,
  );
  const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));

  assert.equal(
    pkg.exports["./release-policy.schema.json"],
    "./release-policy.schema.json",
  );
  assert.ok(pkg.files.includes("release-policy.schema.json"));
  assert.equal(schema.$defs.provider.required.includes("id"), true);
  assert.equal(schema.$defs.provider.required.includes("type"), true);
  assert.equal(schema.$defs.provider.required.includes("supportsPublish"), true);
  assert.equal(schema.$defs.provider.required.includes("supportsDryRun"), true);
  assert.equal(schema.properties.providers.items.$ref, "#/$defs/provider");
  assert.equal(schema.properties.notes.items.type, "string");
});

test("ships the public contract manifest", () => {
  const pkg = JSON.parse(fs.readFileSync(packageManifestPath, "utf8"));
  const contractsPath = path.resolve(
    new URL("../CONTRACTS.md", import.meta.url).pathname,
  );
  const contracts = fs.readFileSync(contractsPath, "utf8");

  assert.ok(pkg.files.includes("CONTRACTS.md"));
  assert.match(contracts, /Append-only rule/);
  assert.match(contracts, /ReleasePolicyValidationError\.code/);
});

test("exports the release output schema as a public package subpath", () => {
  const pkg = JSON.parse(fs.readFileSync(packageManifestPath, "utf8"));
  const schemaPath = path.resolve(
    new URL("../release-output.schema.json", import.meta.url).pathname,
  );
  const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));

  assert.equal(
    pkg.exports["./release-output.schema.json"],
    "./release-output.schema.json",
  );
  assert.ok(pkg.files.includes("release-output.schema.json"));
  assert.equal(schema.$id, "https://refarm.dev/schemas/release-output.schema.json");
  assert.equal(schema.$defs.summary.properties.schemaVersion.const, 1);
  assert.deepEqual(schema.$defs.summary.properties.command.enum, [
    "plan",
    "check",
    "gates",
  ]);
});

test("cli plan json resolves the Refarm default release selection", () => {
  const payload = runCliJson(["plan", "--cwd", repoRoot, "--selection", "default"]);

  assert.equal(payload.command, "plan");
  assert.equal(payload.schemaVersion, 1);
  assert.equal(payload.ok, true);
  assert.equal(payload.status, "ready");
  assert.equal(payload.selection.id, "kernel-candidates");
  assert.deepEqual(payload.profileTags, ["kernel", "candidate"]);
  assert.deepEqual(payload.packages, [
    "@refarm.dev/storage-contract-v1",
    "@refarm.dev/sync-contract-v1",
    "@refarm.dev/identity-contract-v1",
    "@refarm.dev/channel-policy-v1",
  ]);
  assert.deepEqual(payload.requiredGates, [
    "preflight",
    "quality",
    "contracts",
    "runtime-descriptor",
  ]);
  assert.deepEqual(payload.providers, ["changesets"]);
  assert.equal(payload.gates.length, 5);
  assert.equal(payload.publishIntents[0].provider, "changesets");
  assert.equal(payload.publishIntents[0].plan.requiresManualApproval, true);
});

test("cli plan json resolves the Refarm vault-seed-ready release selection", () => {
  const payload = runCliJson(["plan", "--cwd", repoRoot, "--selection", "vault-seed-ready"]);

  assert.equal(payload.command, "plan");
  assert.equal(payload.schemaVersion, 1);
  assert.equal(payload.ok, true);
  assert.equal(payload.selection.id, "vault-seed-ready");
  assert.deepEqual(payload.profileTags, ["vault-seed-ready"]);
  assert.deepEqual(payload.packages, [
    "@refarm.dev/artifact-contract-v1",
    "@refarm.dev/channel-policy-v1",
    "@refarm.dev/effort-contract-v1",
    "@refarm.dev/launch-process",
    "@refarm.dev/release-engine",
    "@refarm.dev/ds",
    "@refarm.dev/heartwood",
    "@refarm.dev/dispatch-surface",
    "@refarm.dev/homestead-ssr",
    "@refarm.dev/silo",
  ]);
  assert.equal(
    payload.packageProfiles.every((profile) =>
      profile.tags.includes("vault-seed-ready")
    ),
    true,
  );
  assert.equal(payload.packages.includes("@refarm.dev/cli"), false);
  assert.equal(payload.packages.includes("@refarm.dev/homestead"), false);
});

test("cli check json uses the versioned machine-output contract", () => {
  const payload = runCliJson([
    "check",
    "--cwd",
    repoRoot,
    "--selection",
    "default",
    "--only-required",
  ]);

  assert.equal(payload.command, "check");
  assert.equal(payload.schemaVersion, 1);
  assert.equal(payload.ok, true);
  assert.equal(payload.commandNote, "Dry-run gate check complete.");
  assert.equal(payload.gateResult.ok, true);
  assert.equal(payload.gateResult.dryRun, true);
  assert.deepEqual(
    payload.gateResult.results.map((result) => result.status),
    ["skipped", "skipped", "skipped", "skipped", "skipped"],
  );
  assert.deepEqual(
    payload.gateResult.results.map((result) => result.phase),
    ["preflight", "quality", "quality", "contracts", "runtime-descriptor"],
  );
});

test("cli blocked plan json preserves the versioned output shape", () => {
  const payload = runCliJsonFailure([
    "plan",
    "--cwd",
    repoRoot,
    "@refarm.dev/not-a-workspace-package",
  ]);

  assert.equal(payload.command, "plan");
  assert.equal(payload.schemaVersion, 1);
  assert.equal(payload.ok, false);
  assert.equal(payload.status, "blocked");
  assert.deepEqual(payload.packages, []);
  assert.equal(payload.blockers[0].status, "missing");
  assert.deepEqual(payload.publishIntents, []);
  assert.deepEqual(payload.profileTags, []);
  assert.equal(payload.selection, null);
});

test("cli blocked check json preserves the gate-result contract", () => {
  const payload = runCliJsonFailure([
    "check",
    "--cwd",
    repoRoot,
    "@refarm.dev/not-a-workspace-package",
  ]);

  assert.equal(payload.command, "check");
  assert.equal(payload.schemaVersion, 1);
  assert.equal(payload.ok, false);
  assert.equal(payload.status, "blocked");
  assert.equal(payload.commandNote, "Plan is blocked before gate execution.");
  assert.equal(payload.gateResult.ok, false);
  assert.equal(payload.gateResult.reason, "Plan blocked");
  assert.deepEqual(payload.gateResult.results, []);
  assert.equal(payload.gateResult.policy.policyVersion, "2026-01");
  assert.equal(payload.gateResult.dryRun, true);
  assert.equal(payload.gateResult.blockers[0].status, "missing");
});

test("validates package profile bump policy", () => {
  assert.equal(
    validatePolicy(validPolicy({
      packageProfiles: [
        {
          id: "@refarm.dev/contract",
          risk: "core",
          bump: "minor",
        },
      ],
    })),
    true,
  );
});

test("allows release policy without package profiles", () => {
  const { packageProfiles, ...policy } = validPolicy();
  assert.equal(validatePolicy(policy), true);
});

test("rejects non-array package profiles", () => {
  assert.throws(
    () => validatePolicy(validPolicy({
      packageProfiles: {},
    })),
    /packageProfiles must be an array when declared/,
  );
});

test("rejects duplicate release policy selection ids", () => {
  assert.throws(
    () => validatePolicy(validPolicy({
      defaultSelection: "kernel-candidates",
      selections: [
        {
          id: "kernel-candidates",
          profileTags: ["kernel"],
        },
        {
          id: "kernel-candidates",
          profileTags: ["daily-driver"],
        },
      ],
    })),
    /Duplicate release policy selection id: kernel-candidates/,
  );
});

test("rejects default release policy selection without declaration", () => {
  assert.throws(
    () => validatePolicy(validPolicy({
      defaultSelection: "missing-selection",
      selections: [
        {
          id: "kernel-candidates",
          profileTags: ["kernel"],
        },
      ],
    })),
    /defaultSelection does not match a declared selection: missing-selection/,
  );
});

test("rejects release policy selections without profile tags", () => {
  assert.throws(
    () => validatePolicy(validPolicy({
      selections: [
        {
          id: "empty-selection",
          profileTags: [],
        },
      ],
    })),
    /selection profileTags must be a non-empty array for empty-selection/,
  );
});

test("rejects duplicate release policy provider ids", () => {
  assert.throws(
    () => validatePolicy(validPolicy({
      providers: [
        {
          id: "changesets",
          type: "changesets",
          supportsPublish: true,
          supportsDryRun: true,
          publishCommands: ["pnpm changeset publish"],
        },
        {
          id: "changesets",
          type: "npm",
          supportsPublish: true,
          supportsDryRun: true,
          publishCommands: ["pnpm publish"],
        },
      ],
    })),
    /Duplicate provider id: changesets/,
  );
});

test("provider validation errors expose stable machine-readable codes", () => {
  assert.throws(
    () => validatePolicy(validPolicy({
      providers: [
        {
          id: "changesets",
          type: "changesets",
          supportsPublish: true,
          supportsDryRun: true,
          publishCommands: ["pnpm changeset publish"],
        },
        {
          id: "changesets",
          type: "npm",
          supportsPublish: true,
          supportsDryRun: true,
          publishCommands: ["pnpm publish"],
        },
      ],
    })),
    (error) => {
      assert.equal(error instanceof ReleasePolicyValidationError, true);
      assert.equal(error.code, "RELEASE_POLICY_PROVIDER_DUPLICATE_ID");
      assert.equal(error.details.providerId, "changesets");
      return true;
    },
  );
});

test("rejects duplicate release package profile ids", () => {
  assert.throws(
    () => validatePolicy(validPolicy({
      packageProfiles: [
        {
          id: "@refarm.dev/contract",
          risk: "core",
        },
        {
          id: "@refarm.dev/contract",
          risk: "shared",
        },
      ],
    })),
    /Duplicate package profile id: @refarm\.dev\/contract/,
  );
});

test("rejects publish-capable providers without publish commands", () => {
  assert.throws(
    () => validatePolicy(validPolicy({
      providers: [
        {
          id: "changesets",
          type: "changesets",
          supportsPublish: true,
          supportsDryRun: true,
        },
      ],
    })),
    /provider publishCommands must be a non-empty array when supportsPublish is true for changesets/,
  );
});

test("publish-capable provider command errors include provider code details", () => {
  assert.throws(
    () => validatePolicy(validPolicy({
      providers: [
        {
          id: "changesets",
          type: "changesets",
          supportsPublish: true,
          supportsDryRun: true,
        },
      ],
    })),
    (error) => {
      assert.equal(error instanceof ReleasePolicyValidationError, true);
      assert.equal(error.code, "RELEASE_POLICY_PROVIDER_PUBLISH_COMMANDS_REQUIRED");
      assert.equal(error.details.providerId, "changesets");
      assert.equal(error.details.providerType, "changesets");
      return true;
    },
  );
});

test("rejects empty provider publish commands", () => {
  assert.throws(
    () => validatePolicy(validPolicy({
      providers: [
        {
          id: "changesets",
          type: "changesets",
          supportsPublish: true,
          supportsDryRun: true,
          publishCommands: [""],
        },
      ],
    })),
    /provider\.publishCommands for changesets must contain non-empty strings/,
  );
});

test("allows policy with no active publish providers", () => {
  assert.equal(
    validatePolicy(validPolicy({
      providers: [
        {
          id: "legacy-tags",
          type: "legacy-tag",
          supportsPublish: false,
          supportsDryRun: false,
        },
      ],
    })),
    true,
  );
});

test("allows policy with an empty provider list as a neutral contract", () => {
  assert.equal(
    validatePolicy(validPolicy({
      providers: [],
    })),
    true,
  );
});

test("inactive providers do not create publish intents", () => {
  const root = withTempWorkspace((workspace) => {
    createWorkspace(
      workspace,
      {
        "@refarm.dev/alpha": {
          dir: "alpha",
        },
      },
      [],
      {
        policyVersion: "2026-01",
        mode: "changeset",
        providers: [
          {
            id: "legacy-tags",
            type: "legacy-tag",
            supportsPublish: false,
            supportsDryRun: false,
          },
        ],
        packageProfiles: [],
        phases: [
          {
            id: "embedded-gate",
            name: "Embedded Gate",
            commands: ["echo embedded"],
            required: true,
            riskWeight: 7,
          },
        ],
      },
    );
  });

  try {
    const plan = buildReleasePlan({
      cwd: root,
      packageNames: ["@refarm.dev/alpha"],
    });

    assert.equal(plan.ok, true);
    assert.deepEqual(plan.publishIntents, []);
    assert.deepEqual(summarizePlan(plan).providers, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("rejects invalid release package profile risk", () => {
  assert.throws(
    () => validatePolicy(validPolicy({
      packageProfiles: [
        {
          id: "@refarm.dev/contract",
          risk: "unknown",
        },
      ],
    })),
    /package profile risk must be one of: core, app, plugin, shared for @refarm\.dev\/contract/,
  );
});

test("rejects invalid release package profile bump", () => {
  assert.throws(
    () => validatePolicy(validPolicy({
      packageProfiles: [
        {
          id: "@refarm.dev/contract",
          risk: "core",
          bump: "release",
        },
      ],
    })),
    /package profile bump must be one of: patch, minor, major for @refarm\.dev\/contract/,
  );
});

test("orders candidates by dependency graph", () => {
  const root = withTempWorkspace((workspace) => {
    createWorkspace(
      workspace,
      {
        "@refarm.dev/foo": {
          dir: "foo",
          dependencies: {
            "@refarm.dev/bar": "workspace:*",
          },
        },
        "@refarm.dev/bar": {
          dir: "bar",
        },
      },
      [
        {
          id: "plan-1",
          changes: {
            "@refarm.dev/foo": "minor",
            "@refarm.dev/bar": "patch",
          },
        },
      ],
    );
  });

  try {
    const plan = buildReleasePlan({
      cwd: root,
      policyPath: fixturePolicy,
    });

    const summary = summarizePlan(plan);
    assert.equal(plan.ok, true);
    assert.deepEqual(plan.orderedNames, ["@refarm.dev/bar", "@refarm.dev/foo"]);
    assert.equal(summary.packageCount, 2);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("supports explicit package selection", () => {
  const root = withTempWorkspace((workspace) => {
    createWorkspace(
      workspace,
      {
        "@refarm.dev/alpha": {
          dir: "alpha",
        },
        "@refarm.dev/beta": {
          dir: "beta",
        },
      },
    );
  });

  try {
    const plan = buildReleasePlan({
      cwd: root,
      policyPath: fixturePolicy,
      packageNames: ["@refarm.dev/alpha"],
    });

    assert.equal(plan.ok, true);
    assert.deepEqual(plan.orderedNames, ["@refarm.dev/alpha"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("summarizes package release profiles for selected packages", () => {
  const root = withTempWorkspace((workspace) => {
    createWorkspace(
      workspace,
      {
        "@refarm.dev/alpha": {
          dir: "alpha",
        },
      },
      [],
      {
        policyVersion: "2026-01",
        mode: "changeset",
        providers: [
          {
            id: "embedded",
            type: "changesets",
            supportsPublish: true,
            supportsDryRun: true,
            publishCommands: ["pnpm changeset publish"],
            publishDryRunCommands: ["pnpm changeset version"],
          },
        ],
        packageProfiles: [
          {
            id: "@refarm.dev/alpha",
            risk: "shared",
            mustPassChecks: ["pnpm --filter @refarm.dev/alpha run build"],
            tags: ["kernel", "kernel-primitive"],
          },
        ],
        phases: [
          {
            id: "embedded-gate",
            name: "Embedded Gate",
            commands: ["echo embedded"],
            required: true,
            riskWeight: 7,
          },
        ],
      },
    );
  });

  try {
    const plan = buildReleasePlan({
      cwd: root,
      packageNames: ["@refarm.dev/alpha"],
    });

    assert.deepEqual(releasePlanPackageProfiles(plan), [
      {
        id: "@refarm.dev/alpha",
        risk: "shared",
        tags: ["kernel", "kernel-primitive"],
        mustPassChecks: ["pnpm --filter @refarm.dev/alpha run build"],
      },
    ]);
    assert.deepEqual(summarizePlan(plan).packageProfiles, releasePlanPackageProfiles(plan));
    assert.match(formatPlan(plan), /kernel-primitive/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("selects release candidates by profile tag", () => {
  const root = withTempWorkspace((workspace) => {
    createWorkspace(
      workspace,
      {
        "@refarm.dev/contract": {
          dir: "contract",
        },
        "@refarm.dev/app": {
          dir: "app",
        },
      },
      [],
      {
        policyVersion: "2026-01",
        mode: "changeset",
        providers: [
          {
            id: "embedded",
            type: "changesets",
            supportsPublish: true,
            supportsDryRun: true,
            publishCommands: ["pnpm changeset publish"],
            publishDryRunCommands: ["pnpm changeset version"],
          },
        ],
        packageProfiles: [
          {
            id: "@refarm.dev/contract",
            risk: "core",
            tags: ["kernel", "kernel-contract"],
          },
          {
            id: "@refarm.dev/app",
            risk: "app",
            tags: ["daily-driver"],
          },
        ],
        phases: [
          {
            id: "embedded-gate",
            name: "Embedded Gate",
            commands: ["echo embedded"],
            required: true,
            riskWeight: 7,
          },
        ],
      },
    );
  });

  try {
    const plan = buildReleasePlan({
      cwd: root,
      profileTags: ["kernel-contract"],
    });

    assert.equal(plan.ok, true);
    assert.deepEqual(plan.orderedNames, ["@refarm.dev/contract"]);
    assert.equal(plan.orderedPackages[0].source, "policy-tag");
    assert.deepEqual(summarizePlan(plan).profileTags, ["kernel-contract"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("selects release candidates by default policy selection", () => {
  const root = withTempWorkspace((workspace) => {
    createWorkspace(
      workspace,
      {
        "@refarm.dev/contract": {
          dir: "contract",
        },
        "@refarm.dev/app": {
          dir: "app",
        },
      },
      [],
      {
        policyVersion: "2026-01",
        mode: "changeset",
        providers: [
          {
            id: "embedded",
            type: "changesets",
            supportsPublish: true,
            supportsDryRun: true,
            publishCommands: ["pnpm changeset publish"],
            publishDryRunCommands: ["pnpm changeset version"],
          },
        ],
        defaultSelection: "kernel-candidates",
        selections: [
          {
            id: "kernel-candidates",
            description: "Kernel candidates",
            profileTags: ["kernel", "candidate"],
          },
        ],
        packageProfiles: [
          {
            id: "@refarm.dev/contract",
            risk: "core",
            tags: ["kernel", "candidate"],
          },
          {
            id: "@refarm.dev/app",
            risk: "app",
            tags: ["daily-driver"],
          },
        ],
        phases: [
          {
            id: "embedded-gate",
            name: "Embedded Gate",
            commands: ["echo embedded"],
            required: true,
            riskWeight: 7,
          },
        ],
      },
    );
  });

  try {
    const plan = buildReleasePlan({
      cwd: root,
      selectionId: "default",
    });

    assert.equal(plan.ok, true);
    assert.deepEqual(plan.orderedNames, ["@refarm.dev/contract"]);
    assert.deepEqual(summarizePlan(plan).profileTags, ["kernel", "candidate"]);
    assert.equal(summarizePlan(plan).selection.id, "kernel-candidates");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("fails explicit release selection when policy selection is missing", () => {
  const root = withTempWorkspace((workspace) => {
    createWorkspace(
      workspace,
      {
        "@refarm.dev/contract": {
          dir: "contract",
        },
      },
      [],
      {
        policyVersion: "2026-01",
        mode: "changeset",
        providers: [
          {
            id: "embedded",
            type: "changesets",
            supportsPublish: true,
            supportsDryRun: true,
            publishCommands: ["pnpm changeset publish"],
            publishDryRunCommands: ["pnpm changeset version"],
          },
        ],
        defaultSelection: "kernel-candidates",
        selections: [
          {
            id: "kernel-candidates",
            profileTags: ["kernel", "candidate"],
          },
        ],
        packageProfiles: [
          {
            id: "@refarm.dev/contract",
            risk: "core",
            tags: ["kernel", "candidate"],
          },
        ],
        phases: [
          {
            id: "embedded-gate",
            name: "Embedded Gate",
            commands: ["echo embedded"],
            required: true,
            riskWeight: 7,
          },
        ],
      },
    );
  });

  try {
    assert.throws(
      () => buildReleasePlan({
        cwd: root,
        selectionId: "missing-selection",
      }),
      /Release policy selection not found: missing-selection\. Available selections: kernel-candidates\./,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("default policy fallback is neutral when no explicit policy exists", () => {
  const root = withTempWorkspace((workspace) => {
    createWorkspace(workspace, {
      "@refarm.dev/alpha": {
        dir: "alpha",
      },
    });
  });

  try {
    const plan = buildReleasePlan({
      cwd: root,
      packageNames: ["@refarm.dev/alpha"],
    });

    assert.equal(plan.ok, true);
    assert.equal(plan.publishIntents.length, 0);
    assert.equal(plan.gates[0].id, "preflight");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("loads embedded release policy from .refarm/config.json when no release-policy.json exists", () => {
  const root = withTempWorkspace((workspace) => {
    createWorkspace(
      workspace,
      {
        "@refarm.dev/alpha": {
          dir: "alpha",
        },
      },
      [],
      {
        policyVersion: "2026-01",
        mode: "changeset",
        providers: [
          {
            id: "embedded",
            type: "changesets",
            supportsPublish: true,
            supportsDryRun: true,
            publishCommands: ["pnpm changeset version", "pnpm changeset publish"],
            publishDryRunCommands: ["pnpm changeset version"],
            publishRequiresManualApproval: true,
          },
        ],
        packageProfiles: [],
        phases: [
          {
            id: "embedded-gate",
            name: "Embedded Gate",
            commands: ["echo embedded"],
            required: true,
            riskWeight: 7,
          },
        ],
      },
    );
  });

  try {
    const plan = buildReleasePlan({
      cwd: root,
      packageNames: ["@refarm.dev/alpha"],
    });

    assert.equal(plan.ok, true);
    assert.equal(plan.publishIntents[0].provider, "embedded");
    assert.equal(plan.gates[0].id, "embedded-gate");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("loads embedded release policy from root refarm.config.json", () => {
  const root = withTempWorkspace((workspace) => {
    createWorkspace(
      workspace,
      {
        "@refarm.dev/alpha": {
          dir: "alpha",
        },
      },
      [],
      {
        policyVersion: "2026-01",
        mode: "changeset",
        providers: [
          {
            id: "root-config",
            type: "changesets",
            supportsPublish: true,
            supportsDryRun: true,
            publishCommands: ["pnpm changeset publish"],
          },
        ],
        packageProfiles: [],
        phases: [
          {
            id: "root-config-gate",
            name: "Root Config Gate",
            commands: ["echo root-config"],
            required: true,
            riskWeight: 3,
          },
        ],
      },
      { embeddedConfigPath: "refarm.config.json" },
    );
  });

  try {
    const plan = buildReleasePlan({
      cwd: root,
      packageNames: ["@refarm.dev/alpha"],
    });

    assert.equal(plan.ok, true);
    assert.equal(plan.publishIntents[0].provider, "root-config");
    assert.equal(plan.gates[0].id, "root-config-gate");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("explicit release-policy.json overrides embedded project policy", () => {
  const root = withTempWorkspace((workspace) => {
    createWorkspace(
      workspace,
      {
        "@refarm.dev/alpha": {
          dir: "alpha",
        },
      },
      [],
      {
        policyVersion: "2026-01",
        mode: "changeset",
        providers: [
          {
            id: "embedded",
            type: "changesets",
            supportsPublish: true,
            supportsDryRun: true,
            publishCommands: ["pnpm changeset publish"],
          },
        ],
        packageProfiles: [],
        phases: [
          {
            id: "embedded-gate",
            name: "Embedded Gate",
            commands: ["echo embedded"],
            required: true,
            riskWeight: 3,
          },
        ],
      },
      { embeddedConfigPath: "refarm.config.json" },
    );

    fs.writeFileSync(
      path.join(workspace, "release-policy.json"),
      JSON.stringify(
        validPolicy({
          providers: [
            {
              id: "explicit",
              type: "changesets",
              supportsPublish: true,
              supportsDryRun: true,
              publishCommands: ["pnpm changeset publish"],
            },
          ],
          phases: [
            {
              id: "explicit-gate",
              name: "Explicit Gate",
              commands: ["echo explicit"],
              required: true,
              riskWeight: 2,
            },
          ],
        }),
        null,
        2,
      ) + "\n",
    );
  });

  try {
    const plan = buildReleasePlan({
      cwd: root,
      packageNames: ["@refarm.dev/alpha"],
    });

    assert.equal(plan.ok, true);
    assert.equal(plan.publishIntents[0].provider, "explicit");
    assert.equal(plan.gates[0].id, "explicit-gate");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("reports blockers for missing package selection", () => {
  const root = withTempWorkspace((workspace) => {
    createWorkspace(workspace, {
      "@refarm.dev/only-one": {
        dir: "only-one",
      },
    });
  });

  try {
    const plan = buildReleasePlan({
      cwd: root,
      policyPath: fixturePolicy,
      packageNames: ["@refarm.dev/not-found"],
    });

    assert.equal(plan.ok, false);
    assert.equal(plan.blockers.length, 1);
    assert.equal(plan.blockers[0].status, "missing");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
