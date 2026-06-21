import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import test from "node:test";
import {
  buildReleasePlan,
  formatPlan,
  loadPolicy,
  validatePolicy,
  summarizePlan,
  releasePlanPackageProfiles,
} from "../src/index.mjs";

function createWorkspace(root, pkgDefs, changesets = [], embeddedPolicy = null) {
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
    const cfgDir = path.join(root, ".refarm");
    fs.mkdirSync(cfgDir, { recursive: true });
    fs.writeFileSync(
      path.join(cfgDir, "config.json"),
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

test("exports the release policy schema as a public package subpath", () => {
  const pkg = JSON.parse(fs.readFileSync(packageManifestPath, "utf8"));
  assert.equal(
    pkg.exports["./release-policy.schema.json"],
    "./release-policy.schema.json",
  );
  assert.ok(pkg.files.includes("release-policy.schema.json"));
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
