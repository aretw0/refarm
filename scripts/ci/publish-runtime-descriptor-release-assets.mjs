#!/usr/bin/env node
import { access, copyFile, mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "./runtime-descriptor-cli.mjs";
import { runSubprocess } from "./subprocess-utils.mjs";

function parsePublishedPackages(input) {
	if (!input || !input.trim()) return [];
	const parsed = JSON.parse(input);
	if (!Array.isArray(parsed)) return [];
	return parsed
		.filter((item) => item && typeof item === "object")
		.map((item) => ({
			name: item.name,
			version: item.version,
		}))
		.filter((item) => Boolean(item.name && item.version));
}

function tagsFromPublishedPackages(packages) {
	return packages.map((item) => `${item.name}@${item.version}`);
}

async function ensureFile(filePath) {
	await access(filePath);
	const fileStat = await stat(filePath);
	if (!fileStat.isFile()) {
		throw new Error(`Expected file but got non-file: ${filePath}`);
	}
}

async function ensureReleaseExists(tag, dryRun) {
	if (dryRun) {
		console.log(
			`[descriptor-release-assets][dry-run] ensure release exists: ${tag}`,
		);
		return;
	}

	try {
		await runSubprocess("gh", ["release", "view", tag], {
			captureOutput: true,
		});
		return;
	} catch {
		await runSubprocess("gh", [
			"release",
			"create",
			tag,
			"--verify-tag",
			"--title",
			`Release ${tag}`,
			"--notes",
			"Automated release entry for runtime descriptor bundle assets.",
		]);
	}
}

async function ensureBundleArchive(bundleDir, sha) {
	const outDir = path.join(bundleDir, "published");
	await mkdir(outDir, { recursive: true });

	const archivePath = path.join(
		outDir,
		`runtime-descriptor-bundle-${sha}.tar.gz`,
	);
	await runSubprocess("tar", ["-czf", archivePath, "-C", bundleDir, "."]);

	const manifestPath = path.join(
		outDir,
		`runtime-descriptor-manifest-${sha}.json`,
	);
	const revocationsPath = path.join(
		outDir,
		`runtime-descriptor-revocations-${sha}.json`,
	);

	await copyFile(path.join(bundleDir, "bundle.manifest.json"), manifestPath);

	const revocationsSourceCandidates = [
		path.join(bundleDir, "bundle.revocations.json"),
		path.join(bundleDir, "bundle.revocations.template.json"),
	];

	let copied = false;
	for (const candidate of revocationsSourceCandidates) {
		try {
			await copyFile(candidate, revocationsPath);
			copied = true;
			break;
		} catch {
			// try next candidate
		}
	}

	if (!copied) {
		throw new Error(
			`Missing revocations bundle file in ${bundleDir} (expected bundle.revocations.json or bundle.revocations.template.json)`,
		);
	}

	return {
		archivePath,
		manifestPath,
		revocationsPath,
	};
}

async function uploadAssets(tag, assets, dryRun) {
	const uploads = [
		{ path: assets.archivePath, name: path.basename(assets.archivePath) },
		{ path: assets.manifestPath, name: path.basename(assets.manifestPath) },
		{
			path: assets.revocationsPath,
			name: path.basename(assets.revocationsPath),
		},
		{ path: assets.archivePath, name: "runtime-descriptor-bundle.tar.gz" },
		{ path: assets.manifestPath, name: "runtime-descriptor-manifest.json" },
		{
			path: assets.revocationsPath,
			name: "runtime-descriptor-revocations.json",
		},
	];

	for (const item of uploads) {
		if (dryRun) {
			console.log(
				`[descriptor-release-assets][dry-run] upload ${item.path} as ${item.name} -> ${tag}`,
			);
			continue;
		}

		await runSubprocess("gh", [
			"release",
			"upload",
			tag,
			`${item.path}#${item.name}`,
			"--clobber",
		]);
	}
}

async function verifyAssets(tag, expectedNames, dryRun) {
	if (dryRun) {
		console.log(
			`[descriptor-release-assets][dry-run] verify assets for ${tag}: ${expectedNames.join(", ")}`,
		);
		return;
	}

	const { stdout } = await runSubprocess(
		"gh",
		["release", "view", tag, "--json", "assets"],
		{ captureOutput: true },
	);
	const parsed = JSON.parse(stdout || "{}");
	const names = new Set(
		Array.isArray(parsed.assets)
			? parsed.assets.map((asset) => asset?.name).filter(Boolean)
			: [],
	);

	for (const expectedName of expectedNames) {
		if (!names.has(expectedName)) {
			throw new Error(
				`Release ${tag} missing required descriptor asset: ${expectedName}`,
			);
		}
	}
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	const root = process.cwd();
	const dryRun = Boolean(args["dry-run"]);
	const sha = args.sha || process.env.GITHUB_SHA || "local";
	const bundleDir = path.resolve(
		root,
		args["bundle-dir"] || ".artifacts/runtime-descriptors",
	);

	const publishedPackages = parsePublishedPackages(
		args["published-packages-json"] || process.env.PUBLISHED_PACKAGES || "",
	);
	const tags = args.tags
		? String(args.tags)
				.split(",")
				.map((item) => item.trim())
				.filter(Boolean)
		: tagsFromPublishedPackages(publishedPackages);

	if (tags.length === 0) {
		console.log("[descriptor-release-assets] no tags to process; exiting");
		return;
	}

	await ensureFile(path.join(bundleDir, "bundle.manifest.json"));
	try {
		await ensureFile(path.join(bundleDir, "bundle.revocations.json"));
	} catch {
		await ensureFile(path.join(bundleDir, "bundle.revocations.template.json"));
	}

	const assets = await ensureBundleArchive(bundleDir, sha);
	const expectedNames = [
		path.basename(assets.archivePath),
		path.basename(assets.manifestPath),
		path.basename(assets.revocationsPath),
		"runtime-descriptor-bundle.tar.gz",
		"runtime-descriptor-manifest.json",
		"runtime-descriptor-revocations.json",
	];

	for (const tag of tags) {
		await ensureReleaseExists(tag, dryRun);
		await uploadAssets(tag, assets, dryRun);
		await verifyAssets(tag, expectedNames, dryRun);
		console.log(
			`[descriptor-release-assets] ${tag}: uploaded and verified (${expectedNames.join(", ")})`,
		);
	}
}

main().catch((error) => {
	console.error(
		`[descriptor-release-assets] failed: ${error?.message ?? error}`,
	);
	process.exit(1);
});
