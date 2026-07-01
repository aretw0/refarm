#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
	findFirstPublishChangesetRisks,
	parseChangesets,
} from "./check-first-publish-changesets.mjs";

test("parses package bumps from changeset frontmatter", () => {
	const root = makeFixtureRoot({
		changesets: {
			"alpha.md": `---
"@refarm.dev/alpha": minor
"@refarm.dev/beta": patch
---

Initial release note.
`,
		},
	});

	assert.deepEqual(parseChangesets(root), [
		{ file: "alpha.md", packageName: "@refarm.dev/alpha", bump: "minor" },
		{ file: "alpha.md", packageName: "@refarm.dev/beta", bump: "patch" },
	]);
});

test("detects changeset bumps against 0.1.0 first-publish packages", () => {
	const root = makeFixtureRoot({
		changesets: {
			"alpha.md": `---
"@refarm.dev/alpha": minor
---
`,
		},
		packages: {
			alpha: {
				name: "@refarm.dev/alpha",
				version: "0.1.0",
			},
		},
	});

	assert.deepEqual(
		findFirstPublishChangesetRisks({
			root,
			selectionId: "vault-seed-ready",
		}),
		[
			{
				file: "alpha.md",
				packageName: "@refarm.dev/alpha",
				bump: "minor",
				currentVersion: "0.1.0",
			},
		],
	);
});

test("ignores changeset bumps after a package is beyond first publish", () => {
	const root = makeFixtureRoot({
		changesets: {
			"alpha.md": `---
"@refarm.dev/alpha": patch
---
`,
		},
		packages: {
			alpha: {
				name: "@refarm.dev/alpha",
				version: "0.1.1",
			},
		},
	});

	assert.deepEqual(
		findFirstPublishChangesetRisks({
			root,
			selectionId: "vault-seed-ready",
		}),
		[],
	);
});

function makeFixtureRoot({ changesets = {}, packages = {} } = {}) {
	const root = path.join(os.tmpdir(), `refarm-first-publish-${process.pid}-${Math.random().toString(36).slice(2)}`);
	mkdirSync(path.join(root, ".changeset"), { recursive: true });
	mkdirSync(path.join(root, "packages"), { recursive: true });
	writeFileSync(
		path.join(root, "refarm.config.json"),
		JSON.stringify({
			releasePolicy: {
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
						publishRequiresManualApproval: true,
					},
				],
				defaultSelection: "vault-seed-ready",
				selections: [
					{
						id: "vault-seed-ready",
						profileTags: ["vault-seed-ready"],
					},
				],
				packageProfiles: Object.values(packages).map((pkg) => ({
					id: pkg.name,
					risk: "core",
					tags: ["vault-seed-ready"],
				})),
				phases: [
					{
						id: "preflight",
						name: "Preflight",
						commands: ["echo ok"],
						required: true,
						riskWeight: 1,
					},
				],
			},
		}),
	);

	for (const [dir, pkg] of Object.entries(packages)) {
		const packageDir = path.join(root, "packages", dir);
		mkdirSync(packageDir, { recursive: true });
		writeFileSync(
			path.join(packageDir, "package.json"),
			JSON.stringify({
				name: pkg.name,
				version: pkg.version,
				publishConfig: { access: "public" },
				files: ["dist"],
			}),
		);
	}

	for (const [file, text] of Object.entries(changesets)) {
		writeFileSync(path.join(root, ".changeset", file), text);
	}

	return root;
}
