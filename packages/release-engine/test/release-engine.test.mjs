import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import test from "node:test";
import {
  buildReleasePlan,
  loadPolicy,
  validatePolicy,
  summarizePlan,
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
