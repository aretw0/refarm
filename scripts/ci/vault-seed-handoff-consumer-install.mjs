#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DEFAULT_HANDOFF_DIR = ".refarm/handoff/vault-seed";
const REFARM_SCOPE = "@refarm.dev/";

function readJson(filePath) {
	return JSON.parse(readFileSync(filePath, "utf8"));
}

function sha256File(filePath) {
	const hash = createHash("sha256");
	hash.update(readFileSync(filePath));
	return hash.digest("hex");
}

function normalizeFileSpec(spec) {
	return String(spec ?? "").replace(/^file:\.\/vendor\//, "file:vendor/");
}

function parseArgs(argv = []) {
	const options = {
		root: ROOT,
		handoffDir: null,
		consumerRoot: null,
		consumerPackages: [],
		latestAccepted: false,
		json: false,
	};

	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === "--root") {
			options.root = path.resolve(requireValue(argv, index, arg));
			index += 1;
			continue;
		}
		if (arg === "--handoff-dir") {
			options.handoffDir = requireValue(argv, index, arg);
			index += 1;
			continue;
		}
		if (arg === "--consumer-root") {
			options.consumerRoot = path.resolve(requireValue(argv, index, arg));
			index += 1;
			continue;
		}
		if (arg === "--consumer-package") {
			options.consumerPackages.push(requireValue(argv, index, arg));
			index += 1;
			continue;
		}
		if (arg === "--json") {
			options.json = true;
			continue;
		}
		if (arg === "--latest-accepted") {
			options.latestAccepted = true;
			continue;
		}
		throw new Error(`Unknown argument: ${arg}`);
	}

	return options;
}

function requireValue(argv, index, flag) {
	const value = argv[index + 1];
	if (!value || value.startsWith("--")) {
		throw new Error(`${flag} requires a value`);
	}
	return value;
}

function latestHandoffDir(root) {
	const dirs = handoffDirs(root);
	return dirs.at(-1) ?? null;
}

function handoffDirs(root) {
	const base = path.join(root, DEFAULT_HANDOFF_DIR);
	if (!existsSync(base)) {
		return [];
	}
	return readdirSync(base, { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map((entry) => path.join(base, entry.name))
		.sort();
}

function resolveHandoffDir(root, handoffDir) {
	if (handoffDir) {
		return path.resolve(root, handoffDir);
	}
	return latestHandoffDir(root);
}

function issue(issues, code, message, extra = {}) {
	issues.push({ code, message, ...extra });
}

function expectedVendorSpec(tarball) {
	return `file:vendor/${tarball}`;
}

function expectedManifestSpec(tarball) {
	return `file:./vendor/${tarball}`;
}

function validateHandoffManifest({
	root = ROOT,
	handoffDir = null,
	consumerRoot = null,
	consumerPackages = [],
} = {}) {
	const resolvedHandoffDir = resolveHandoffDir(root, handoffDir);
	const issues = [];

	if (!resolvedHandoffDir) {
		issue(issues, "handoff-dir-missing", "No vault-seed handoff directory exists.");
		return result({ root, handoffDir: null, consumerRoot, manifest: null, issues });
	}

	const manifestPath = path.join(resolvedHandoffDir, "manifest.json");
	if (!existsSync(manifestPath)) {
		issue(issues, "manifest-missing", `Missing handoff manifest: ${manifestPath}`);
		return result({ root, handoffDir: resolvedHandoffDir, consumerRoot, manifest: null, issues });
	}

	const manifest = readJson(manifestPath);
	const packages = Array.isArray(manifest.packages) ? manifest.packages : [];
	const packageNames = packages.map((entry) => entry.packageName).filter(Boolean);
	const install = manifest.consumerInstall ?? {};
	const requestedConsumerPackages = [...new Set(consumerPackages)];
	const consumerEntries = requestedConsumerPackages.length > 0
		? requestedConsumerPackages
			.map((packageName) => {
				const entry = packages.find((candidate) => candidate.packageName === packageName);
				if (!entry) {
					issue(issues, "consumer-package-unknown", `${packageName} is absent from the handoff selection`, {
						packageName,
					});
				}
				return entry;
			})
			.filter(Boolean)
		: packages;

	if (manifest.source !== "vault-seed-ready-handoff") {
		issue(issues, "source", "manifest.source must be vault-seed-ready-handoff", { actual: manifest.source });
	}
	if (manifest.selection?.id !== "consumer-ready") {
		issue(issues, "selection", "manifest.selection.id must be vault-seed-ready", { actual: manifest.selection?.id });
	}
	if (manifest.ok !== true || manifest.status !== "ready") {
		issue(issues, "status", "handoff manifest must be ready and ok", { ok: manifest.ok, status: manifest.status });
	}
	if (manifest.ok !== true && Array.isArray(manifest.issues) && manifest.issues.length > 0) {
		issue(issues, "manifest-issues", "handoff manifest carries upstream readiness issues", {
			issueCount: manifest.issues.length,
			firstIssues: manifest.issues.slice(0, 5),
		});
	}
	if (manifest.acceptance?.status !== "accepted") {
		issue(issues, "acceptance", "manifest.acceptance.status must be accepted", { actual: manifest.acceptance?.status });
	}
	if (manifest.acceptance?.packageCount !== packages.length) {
		issue(issues, "package-count", "acceptance.packageCount must match packages.length", {
			acceptancePackageCount: manifest.acceptance?.packageCount,
			packageCount: packages.length,
		});
	}

	const copyFiles = new Set(Array.isArray(install.copyFiles) ? install.copyFiles : []);
	if (!copyFiles.has("manifest.json")) {
		issue(issues, "copy-files", "consumerInstall.copyFiles must include manifest.json");
	}

	for (const entry of packages) {
		const tarball = entry.tarball;
		const tarballPath = path.join(resolvedHandoffDir, tarball ?? "");
		if (!tarball) {
			issue(issues, "tarball-name", `${entry.packageName} does not declare a tarball`);
			continue;
		}
		if (!copyFiles.has(tarball)) {
			issue(issues, "copy-files", `consumerInstall.copyFiles is missing ${tarball}`, { packageName: entry.packageName });
		}
		if (!existsSync(tarballPath)) {
			issue(issues, "tarball-missing", `Missing packed tarball ${tarball}`, { packageName: entry.packageName });
			continue;
		}
		const actualSha = sha256File(tarballPath);
		if (actualSha !== entry.sha256) {
			issue(issues, "tarball-sha256", `${tarball} SHA-256 does not match manifest`, {
				packageName: entry.packageName,
				expected: entry.sha256,
				actual: actualSha,
			});
		}
		const sizeBytes = readFileSync(tarballPath).byteLength;
		if (typeof entry.sizeBytes === "number" && sizeBytes !== entry.sizeBytes) {
			issue(issues, "tarball-size", `${tarball} sizeBytes does not match manifest`, {
				packageName: entry.packageName,
				expected: entry.sizeBytes,
				actual: sizeBytes,
			});
		}
	}

	for (const entry of packages) {
		const fileSpec = install.fileSpecs?.[entry.packageName];
		const override = install.pnpmOverrides?.[entry.packageName];
		const wanted = expectedManifestSpec(entry.tarball);
		if (fileSpec !== wanted) {
			issue(issues, "file-spec", `${entry.packageName} consumerInstall.fileSpecs is not aligned`, {
				expected: wanted,
				actual: fileSpec,
			});
		}
		if (override !== wanted) {
			issue(issues, "pnpm-override", `${entry.packageName} consumerInstall.pnpmOverrides is not aligned`, {
				expected: wanted,
				actual: override,
			});
		}
	}

	const integrityTarballs = manifest.distributionEvidence?.integrity?.tarballs ?? [];
	const integrityByPackage = new Map(integrityTarballs.map((entry) => [entry.packageName, entry]));
	for (const entry of packages) {
		const integrity = integrityByPackage.get(entry.packageName);
		if (!integrity) {
			issue(issues, "distribution-integrity", `${entry.packageName} missing from distributionEvidence.integrity.tarballs`);
			continue;
		}
		for (const key of ["version", "tarball", "sha256"]) {
			if (integrity[key] !== entry[key]) {
				issue(issues, "distribution-integrity", `${entry.packageName} distributionEvidence integrity ${key} is not aligned`, {
					expected: entry[key],
					actual: integrity[key],
				});
			}
		}
	}

	if (consumerRoot) {
		validateConsumerCopy({
			consumerRoot,
			packages: consumerEntries,
			packageNames: consumerEntries.map((entry) => entry.packageName),
			issues,
			strictDirectRefs: requestedConsumerPackages.length === 0,
		});
	}

	return result({
		root,
		handoffDir: resolvedHandoffDir,
		consumerRoot,
		consumerPackages: requestedConsumerPackages,
		manifest,
		issues,
	});
}

function latestAcceptedHandoffReport({ root = ROOT, consumerRoot = null } = {}) {
	const dirs = handoffDirs(root).reverse();
	let latestCandidate = null;

	for (const dir of dirs) {
		const report = validateHandoffManifest({ root, handoffDir: dir, consumerRoot });
		latestCandidate ??= report;
		if (report.ok) {
			return {
				...report,
				mode: "latest-accepted",
				latestCandidate:
					latestCandidate.handoffDir === report.handoffDir
						? null
						: summarizeCandidate(latestCandidate),
			};
		}
	}

	if (latestCandidate) {
		return {
			...latestCandidate,
			mode: "latest-accepted",
			issues: [
				{
					code: "accepted-handoff-missing",
					message: "No accepted vault-seed handoff was found.",
				},
				...latestCandidate.issues,
			],
			issueCount: latestCandidate.issues.length + 1,
		};
	}

	return validateHandoffManifest({ root, consumerRoot });
}

function summarizeCandidate(report) {
	return {
		ok: report.ok,
		handoffDir: report.handoffDir,
		sourceGitSha: report.sourceGitSha,
		packageCount: report.packageCount,
		issueCount: report.issueCount,
		firstIssues: report.issues.slice(0, 3).map((item) => ({
			code: item.code,
			message: item.message,
		})),
	};
}

function validateConsumerCopy({
	consumerRoot,
	packages,
	packageNames,
	issues,
	strictDirectRefs = true,
}) {
	const vendorDir = path.join(consumerRoot, "vendor");
	const pkgPath = path.join(consumerRoot, "package.json");
	const workspacePath = path.join(consumerRoot, "pnpm-workspace.yaml");
	const packageJson = existsSync(pkgPath) ? readJson(pkgPath) : {};
	const workspaceText = existsSync(workspacePath) ? readFileSync(workspacePath, "utf8") : "";

	for (const entry of packages) {
		const vendorPath = path.join(vendorDir, entry.tarball);
		if (!existsSync(vendorPath)) {
			issue(issues, "consumer-vendor-missing", `Consumer vendor copy is missing ${entry.tarball}`, {
				packageName: entry.packageName,
			});
			continue;
		}
		const actualSha = sha256File(vendorPath);
		if (actualSha !== entry.sha256) {
			issue(issues, "consumer-vendor-sha256", `Consumer vendor copy SHA-256 does not match ${entry.tarball}`, {
				packageName: entry.packageName,
				expected: entry.sha256,
				actual: actualSha,
			});
		}
	}

	const directFileRefs = collectDirectFileRefs(packageJson);
	for (const [packageName, spec] of directFileRefs) {
		if (!packageName.startsWith(REFARM_SCOPE)) {
			continue;
		}
		const selected = packages.find((entry) => entry.packageName === packageName);
		if (!selected) {
			if (strictDirectRefs) {
				issue(issues, "consumer-direct-extra", `Consumer package.json references ${packageName}, absent from handoff selection`);
			}
			continue;
		}
		const wanted = expectedVendorSpec(selected.tarball);
		if (normalizeFileSpec(spec) !== wanted) {
			issue(issues, "consumer-direct-spec", `Consumer package.json file spec for ${packageName} is not aligned`, {
				expected: wanted,
				actual: spec,
			});
		}
	}

	for (const packageName of packageNames) {
		const selected = packages.find((entry) => entry.packageName === packageName);
		const wanted = expectedVendorSpec(selected.tarball);
		if (!workspaceText.includes(`"${packageName}": "${wanted}"`)) {
			issue(issues, "consumer-pnpm-override", `Consumer pnpm-workspace.yaml is missing override for ${packageName}`, {
				expected: wanted,
			});
		}
	}
}

function collectDirectFileRefs(packageJson) {
	const sections = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"];
	const refs = [];
	for (const section of sections) {
		for (const [name, spec] of Object.entries(packageJson[section] ?? {})) {
			if (String(spec).startsWith("file:")) {
				refs.push([name, spec, section]);
			}
		}
	}
	return refs;
}

function result({ root, handoffDir, consumerRoot, consumerPackages = [], manifest, issues }) {
	return {
		ok: issues.length === 0,
		command: "vault-seed-handoff-consumer-install",
		mode: "exact-or-latest",
		root,
		handoffDir,
		consumerRoot,
		consumerPackages,
		consumerPackageCount: consumerPackages.length || manifest?.packages?.length || 0,
		sourceGitSha: manifest?.sourceGitSha ?? null,
		packageCount: manifest?.packages?.length ?? 0,
		issueCount: issues.length,
		issues,
	};
}

function formatReport(report) {
	const lines = [];
	lines.push(`vault-seed handoff consumer-install: ${report.ok ? "OK" : "FAIL"}`);
	lines.push(`mode: ${report.mode ?? "exact-or-latest"}`);
	lines.push(`handoffDir: ${report.handoffDir ?? "(missing)"}`);
	if (report.latestCandidate) {
		lines.push(`latestCandidate: ${report.latestCandidate.handoffDir} (${report.latestCandidate.ok ? "OK" : "blocked"})`);
	}
	if (report.consumerRoot) {
		lines.push(`consumerRoot: ${report.consumerRoot}`);
	}
	if (report.consumerPackages.length > 0) {
		lines.push(`consumerPackages: ${report.consumerPackages.join(", ")}`);
	}
	lines.push(`packages: ${report.packageCount}`);
	if (report.sourceGitSha) {
		lines.push(`sourceGitSha: ${report.sourceGitSha}`);
	}
	if (report.issues.length) {
		lines.push("");
		lines.push("Issues:");
		for (const item of report.issues) {
			lines.push(`- ${item.code}: ${item.message}`);
		}
	}
	return `${lines.join("\n")}\n`;
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	const report = args.latestAccepted
		? latestAcceptedHandoffReport(args)
		: validateHandoffManifest(args);
	if (args.json) {
		process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
	} else {
		process.stdout.write(formatReport(report));
	}
	process.exitCode = report.ok ? 0 : 1;
}

export { formatReport, latestAcceptedHandoffReport, parseArgs, validateHandoffManifest };

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	main().catch((error) => {
		console.error(error.stack ?? error.message);
		process.exitCode = 1;
	});
}
