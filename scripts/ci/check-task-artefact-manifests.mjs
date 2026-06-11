import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const TASK_ARTEFACT_MANIFEST_SCHEMA = "refarm.task-artefacts.v1";

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
			} else if (entry.isFile() && entry.name === "task-artefacts.json") {
				found.push(fullPath);
			}
		}
	}
	return found.sort((a, b) => a.localeCompare(b));
}

export function validateTaskArtefactManifestFile(manifestPath) {
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
	if (manifest.schema !== TASK_ARTEFACT_MANIFEST_SCHEMA) {
		pushIssue(
			issues,
			manifestPath,
			"$.schema",
			`Expected ${TASK_ARTEFACT_MANIFEST_SCHEMA}.`,
		);
	}
	if (!isNonEmptyString(manifest.createdAt)) {
		pushIssue(issues, manifestPath, "$.createdAt", "Expected non-empty string.");
	}
	if (!Array.isArray(manifest.artefacts)) {
		pushIssue(issues, manifestPath, "$.artefacts", "Expected array.");
		return issues;
	}

	const manifestDir = path.dirname(manifestPath);
	const ids = new Set();
	for (const [index, artefact] of manifest.artefacts.entries()) {
		const basePath = `$.artefacts.${index}`;
		let safeUri = false;
		if (!isRecord(artefact)) {
			pushIssue(issues, manifestPath, basePath, "Expected artefact object.");
			continue;
		}
		if (!isNonEmptyString(artefact.id)) {
			pushIssue(issues, manifestPath, `${basePath}.id`, "Expected non-empty string.");
		} else if (ids.has(artefact.id)) {
			pushIssue(issues, manifestPath, `${basePath}.id`, "Expected unique artefact id.");
		} else {
			ids.add(artefact.id);
		}
		if (!isNonEmptyString(artefact.uri)) {
			pushIssue(issues, manifestPath, `${basePath}.uri`, "Expected non-empty string.");
		} else if (!isSafeRelativeUri(artefact.uri)) {
			pushIssue(
				issues,
				manifestPath,
				`${basePath}.uri`,
				"Expected a local relative path without parent traversal.",
			);
		} else {
			safeUri = true;
		}
		if (!isNonEmptyString(artefact.mediaType)) {
			pushIssue(
				issues,
				manifestPath,
				`${basePath}.mediaType`,
				"Expected non-empty string.",
			);
		}
		if (!isNonEmptyString(artefact.role) || !ROLE_SET.has(artefact.role)) {
			pushIssue(issues, manifestPath, `${basePath}.role`, "Expected supported role.");
		}
		if (
			artefact.reviewState !== undefined &&
			(!isNonEmptyString(artefact.reviewState) ||
				!REVIEW_STATE_SET.has(artefact.reviewState))
		) {
			pushIssue(
				issues,
				manifestPath,
				`${basePath}.reviewState`,
				"Expected supported review state.",
			);
		}
		if (!isRecord(artefact.hash)) {
			pushIssue(issues, manifestPath, `${basePath}.hash`, "Expected hash object.");
		} else {
			if (artefact.hash.algorithm !== "sha256") {
				pushIssue(
					issues,
					manifestPath,
					`${basePath}.hash.algorithm`,
					"Expected sha256.",
				);
			}
			if (
				!isNonEmptyString(artefact.hash.value) ||
				!/^[a-f0-9]{64}$/.test(artefact.hash.value)
			) {
				pushIssue(
					issues,
					manifestPath,
					`${basePath}.hash.value`,
					"Expected 64-char lowercase hex digest.",
				);
			}
		}
		if (!isRecord(artefact.provenance)) {
			pushIssue(
				issues,
				manifestPath,
				`${basePath}.provenance`,
				"Expected provenance object.",
			);
		} else {
			for (const field of ["runId", "producer", "producedAt"]) {
				if (!isNonEmptyString(artefact.provenance[field])) {
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
		const artefactPath = path.join(manifestDir, artefact.uri);
		if (!existsSync(artefactPath) || !statSync(artefactPath).isFile()) {
			pushIssue(issues, manifestPath, `${basePath}.uri`, "Referenced file does not exist.");
			continue;
		}
		if (isRecord(artefact.hash) && artefact.hash.algorithm === "sha256") {
			const actualHash = sha256File(artefactPath);
			if (actualHash !== artefact.hash.value) {
				pushIssue(
					issues,
					manifestPath,
					`${basePath}.hash.value`,
					`Hash mismatch for ${artefact.uri}; expected ${actualHash}.`,
				);
			}
		}
	}

	return issues;
}

export function checkTaskArtefactManifests(rootDir = process.cwd()) {
	const manifestPaths = walkForManifests(path.join(rootDir, "validations"));
	const issues = manifestPaths.flatMap((manifestPath) =>
		validateTaskArtefactManifestFile(manifestPath),
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
	const result = checkTaskArtefactManifests(rootDir);
	if (!result.ok) {
		console.error(
			result.issues.map((issue) => formatIssue(issue, rootDir)).join("\n"),
		);
		process.exit(1);
	}
	console.log(`Validated ${result.manifestCount} task artefact manifest(s).`);
}
