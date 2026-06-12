import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { createHash } from "node:crypto";
import {
	checkTaskArtifactManifests,
	validateTaskArtifactManifestFile,
} from "./check-task-artifact-manifests.mjs";

function sha256Text(value) {
	return createHash("sha256").update(value).digest("hex");
}

async function makeFixture(manifestOverrides = {}, artifactOverrides = {}) {
	const root = await mkdtemp(path.join(os.tmpdir(), "refarm-artifacts-"));
	const fixtureDir = path.join(root, "validations", "sample", "fixtures", "expected");
	mkdirSync(fixtureDir, { recursive: true });
	const contents = "hello\n";
	writeFileSync(path.join(fixtureDir, "report.md"), contents);
	const manifest = {
		schema: "refarm.task-artifacts.v1",
		taskId: "task-sample",
		effortId: "effort-sample",
		createdAt: "2026-01-01T00:00:00.000Z",
		artifacts: [
			{
				id: "report-md",
				uri: "report.md",
				mediaType: "text/markdown",
				role: "report",
				hash: {
					algorithm: "sha256",
					value: sha256Text(contents),
				},
				reviewState: "accepted",
				provenance: {
					runId: "sample-run",
					producer: "sample",
					producedAt: "2026-01-01T00:00:00.000Z",
				},
				...artifactOverrides,
			},
		],
		...manifestOverrides,
	};
	const manifestPath = path.join(fixtureDir, "task-artifacts.json");
	writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
	return { root, manifestPath };
}

describe("check-task-artifact-manifests", () => {
	it("validates all task artifact manifests under validations", async () => {
		const { root } = await makeFixture();
		const result = checkTaskArtifactManifests(root);

		assert.equal(result.ok, true);
		assert.equal(result.manifestCount, 1);
		assert.deepEqual(result.issues, []);
	});

	it("reports stale hashes", async () => {
		const { manifestPath } = await makeFixture(undefined, {
			hash: { algorithm: "sha256", value: "0".repeat(64) },
		});

		const issues = validateTaskArtifactManifestFile(manifestPath);

		assert.equal(issues.length, 1);
		assert.equal(issues[0].path, "$.artifacts.0.hash.value");
		assert.match(issues[0].message, /Hash mismatch/);
	});

	it("rejects absolute or parent-traversal artifact paths", async () => {
		const { manifestPath } = await makeFixture(undefined, {
			uri: "../report.md",
		});

		const issues = validateTaskArtifactManifestFile(manifestPath);

		assert.equal(
			issues.some((issue) => issue.path === "$.artifacts.0.uri"),
			true,
		);
	});
});
