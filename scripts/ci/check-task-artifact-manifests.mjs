import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const TASK_ARTIFACT_MANIFEST_SCHEMA = "refarm.task-artifacts.v1";

const ROLE_SET = new Set([
	"dataset",
	"report",
	"audit-trail",
	"receipt",
	"log",
	"manifest",
	"other",
]);
const REVIEW_STATE_SET = new Set([
	"unreviewed",
	"accepted",
	"rejected",
	"superseded",
]);

function isRecord(value) {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value) {
	return typeof value === "string" && value.length > 0;
}

function sha256File(filePath) {
	return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function isSafeRelativeUri(uri) {
	if (path.isAbsolute(uri)) return false;
	return !uri.split(/[\\/]+/u).includes("..");
}

function pushIssue(issues, manifestPath, issuePath, message) {
	issues.push({ manifestPath, path: issuePath, message });
}

function walkForManifests(rootDir) {
	if (!existsSync(rootDir)) return [];
	const found = [];
	const stack = [rootDir];
	while (stack.length > 0) {
		const current = stack.pop();
		for (const entry of readdirSync(current, { withFileTypes: true })) {
			const fullPath = path.join(current, entry.name);
			if (entry.isDirectory()) {
				if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
				stack.push(fullPath);
			} else if (entry.isFile() && entry.name === "task-artifacts.json") {
				found.push(fullPath);
			}
		}
	}
	return found.sort((a, b) => a.localeCompare(b));
}

export function validateTaskArtifactManifestFile(manifestPath) {
	const issues = [];
	let manifest;
	try {
		manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
	} catch (error) {
		return [
			{
				manifestPath,
				path: "$",
				message: `Could not parse JSON: ${error.message}`,
			},
		];
	}

	if (!isRecord(manifest)) {
		pushIssue(issues, manifestPath, "$", "Expected manifest object.");
		return issues;
	}
	if (manifest.schema !== TASK_ARTIFACT_MANIFEST_SCHEMA) {
		pushIssue(
			issues,
			manifestPath,
			"$.schema",
			`Expected ${TASK_ARTIFACT_MANIFEST_SCHEMA}.`,
		);
	}
	if (!isNonEmptyString(manifest.createdAt)) {
		pushIssue(issues, manifestPath, "$.createdAt", "Expected non-empty string.");
	}
	if (!Array.isArray(manifest.artifacts)) {
		pushIssue(issues, manifestPath, "$.artifacts", "Expected array.");
		return issues;
	}

	const manifestDir = path.dirname(manifestPath);
	const ids = new Set();
	for (const [index, artifact] of manifest.artifacts.entries()) {
		const basePath = `$.artifacts.${index}`;
		let safeUri = false;
		if (!isRecord(artifact)) {
			pushIssue(issues, manifestPath, basePath, "Expected artifact object.");
			continue;
		}
		if (!isNonEmptyString(artifact.id)) {
			pushIssue(issues, manifestPath, `${basePath}.id`, "Expected non-empty string.");
		} else if (ids.has(artifact.id)) {
			pushIssue(issues, manifestPath, `${basePath}.id`, "Expected unique artifact id.");
		} else {
			ids.add(artifact.id);
		}
		if (!isNonEmptyString(artifact.uri)) {
			pushIssue(issues, manifestPath, `${basePath}.uri`, "Expected non-empty string.");
		} else if (!isSafeRelativeUri(artifact.uri)) {
			pushIssue(
				issues,
				manifestPath,
				`${basePath}.uri`,
				"Expected a local relative path without parent traversal.",
			);
		} else {
			safeUri = true;
		}
		if (!isNonEmptyString(artifact.mediaType)) {
			pushIssue(
				issues,
				manifestPath,
				`${basePath}.mediaType`,
				"Expected non-empty string.",
			);
		}
		if (!isNonEmptyString(artifact.role) || !ROLE_SET.has(artifact.role)) {
			pushIssue(issues, manifestPath, `${basePath}.role`, "Expected supported role.");
		}
		if (
			artifact.reviewState !== undefined &&
			(!isNonEmptyString(artifact.reviewState) ||
				!REVIEW_STATE_SET.has(artifact.reviewState))
		) {
			pushIssue(
				issues,
				manifestPath,
				`${basePath}.reviewState`,
				"Expected supported review state.",
			);
		}
		if (!isRecord(artifact.hash)) {
			pushIssue(issues, manifestPath, `${basePath}.hash`, "Expected hash object.");
		} else {
			if (artifact.hash.algorithm !== "sha256") {
				pushIssue(
					issues,
					manifestPath,
					`${basePath}.hash.algorithm`,
					"Expected sha256.",
				);
			}
			if (
				!isNonEmptyString(artifact.hash.value) ||
				!/^[a-f0-9]{64}$/.test(artifact.hash.value)
			) {
				pushIssue(
					issues,
					manifestPath,
					`${basePath}.hash.value`,
					"Expected 64-char lowercase hex digest.",
				);
			}
		}
		if (!isRecord(artifact.provenance)) {
			pushIssue(
				issues,
				manifestPath,
				`${basePath}.provenance`,
				"Expected provenance object.",
			);
		} else {
			for (const field of ["runId", "producer", "producedAt"]) {
				if (!isNonEmptyString(artifact.provenance[field])) {
					pushIssue(
						issues,
						manifestPath,
						`${basePath}.provenance.${field}`,
						"Expected non-empty string.",
					);
				}
			}
		}

		if (!safeUri) continue;
		const artifactPath = path.join(manifestDir, artifact.uri);
		if (!existsSync(artifactPath) || !statSync(artifactPath).isFile()) {
			pushIssue(issues, manifestPath, `${basePath}.uri`, "Referenced file does not exist.");
			continue;
		}
		if (isRecord(artifact.hash) && artifact.hash.algorithm === "sha256") {
			const actualHash = sha256File(artifactPath);
			if (actualHash !== artifact.hash.value) {
				pushIssue(
					issues,
					manifestPath,
					`${basePath}.hash.value`,
					`Hash mismatch for ${artifact.uri}; expected ${actualHash}.`,
				);
			}
		}
	}

	return issues;
}

export function checkTaskArtifactManifests(rootDir = process.cwd()) {
	const manifestPaths = walkForManifests(path.join(rootDir, "validations"));
	const issues = manifestPaths.flatMap((manifestPath) =>
		validateTaskArtifactManifestFile(manifestPath),
	);
	return {
		ok: issues.length === 0,
		manifestCount: manifestPaths.length,
		manifestPaths,
		issues,
	};
}

function formatIssue(issue, rootDir) {
	const relativeManifest = path.relative(rootDir, issue.manifestPath).replaceAll(path.sep, "/");
	return `${relativeManifest} ${issue.path}: ${issue.message}`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const rootDir = process.cwd();
	const result = checkTaskArtifactManifests(rootDir);
	if (!result.ok) {
		console.error(
			result.issues.map((issue) => formatIssue(issue, rootDir)).join("\n"),
		);
		process.exit(1);
	}
	console.log(`Validated ${result.manifestCount} task artifact manifest(s).`);
}
