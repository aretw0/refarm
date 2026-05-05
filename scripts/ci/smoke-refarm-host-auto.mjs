#!/usr/bin/env node
import { runSubprocess } from "./subprocess-utils.mjs";

const LOGGER_PREFIX = "[refarm-host-smoke:auto]";

const PROFILE_SCRIPT = {
	skip: null,
	quick: "refarm:host:smoke:quick",
	dev: "refarm:host:smoke:dev",
	ci: "refarm:host:smoke:ci",
};

function hasArg(flag) {
	return process.argv.includes(flag);
}

function readArgValue(flag) {
	const index = process.argv.indexOf(flag);
	if (index < 0) return undefined;
	return process.argv[index + 1];
}

function parseChangedFileList(output) {
	return output
		.split(/\r?\n/u)
		.map((line) => line.trim())
		.filter(Boolean);
}

async function gitChangedFilesForRange(fromRef, toRef) {
	const range = `${fromRef}..${toRef}`;
	const { stdout } = await runSubprocess(
		"git",
		["diff", "--name-only", "--relative", range],
		{ env: process.env, captureOutput: true },
	);
	return parseChangedFileList(stdout);
}

async function gitChangedFilesForWorkingTree() {
	const outputSets = await Promise.all([
		runSubprocess("git", ["diff", "--name-only", "--relative", "HEAD"], {
			env: process.env,
			captureOutput: true,
		}),
		runSubprocess("git", ["diff", "--name-only", "--cached", "--relative"], {
			env: process.env,
			captureOutput: true,
		}),
		runSubprocess("git", ["ls-files", "--others", "--exclude-standard"], {
			env: process.env,
			captureOutput: true,
		}),
	]);

	const files = new Set();
	for (const output of outputSets) {
		for (const file of parseChangedFileList(output.stdout)) {
			files.add(file);
		}
	}

	return Array.from(files).sort();
}

function isDocsOnlyFile(file) {
	return (
		file.startsWith("docs/") ||
		file.startsWith("specs/") ||
		file.endsWith(".md") ||
		file.endsWith(".mdx")
	);
}

function isRefarmHostSourceFile(file) {
	return (
		file.startsWith("apps/refarm/src/") ||
		file === "apps/refarm/package.json" ||
		file === "apps/refarm/tsconfig.json" ||
		file === "apps/refarm/tsconfig.build.json"
	);
}

function isRefarmHostTestFile(file) {
	return file.startsWith("apps/refarm/test/");
}

function isHostSmokeGovernanceFile(file) {
	return (
		file === "scripts/ci/smoke-refarm-host-spine.mjs" ||
		file === "scripts/ci/smoke-refarm-host-auto.mjs" ||
		file === "package.json"
	);
}

function isHostSmokeCliFlowFile(file) {
	return file === "scripts/ci/smoke-refarm-host-cli-flows.mjs";
}

function decideProfile(files) {
	if (files.length === 0) {
		return {
			profile: "skip",
			reason:
				"No local file changes detected; skipping host smoke until there is a delta.",
		};
	}

	if (files.every((file) => isDocsOnlyFile(file))) {
		return {
			profile: "skip",
			reason: "Docs-only delta; host smoke execution is not required.",
		};
	}

	if (
		files.every((file) => isRefarmHostTestFile(file) || isDocsOnlyFile(file))
	) {
		return {
			profile: "quick",
			reason:
				"Refarm host tests/docs-only delta; run focused command smoke without type-check/CLI flow.",
		};
	}

	if (files.some((file) => isHostSmokeGovernanceFile(file))) {
		return {
			profile: "ci",
			reason: "Host smoke governance/wrapper changed; run full CI-parity lane.",
		};
	}

	if (
		files.some(
			(file) => isRefarmHostSourceFile(file) || isHostSmokeCliFlowFile(file),
		)
	) {
		return {
			profile: "dev",
			reason:
				"Host source or CLI flow changed; run dev lane (commands + CLI flows, skip duplicate type-check).",
		};
	}

	return {
		profile: "quick",
		reason: "No host-runtime critical delta; run cheapest host smoke lane.",
	};
}

async function main() {
	if (hasArg("--help") || hasArg("-h")) {
		console.log(`${LOGGER_PREFIX} usage:`);
		console.log(
			"  node scripts/ci/smoke-refarm-host-auto.mjs [--execute] [--from <rev>] [--to <rev>]",
		);
		console.log(
			"  default mode inspects local working tree + staged + untracked files and prints a recommendation.",
		);
		return;
	}

	const fromRef = readArgValue("--from");
	const toRef = readArgValue("--to") ?? "HEAD";
	const execute = hasArg("--execute");

	const changedFiles = fromRef
		? await gitChangedFilesForRange(fromRef, toRef)
		: await gitChangedFilesForWorkingTree();

	const decision = decideProfile(changedFiles);
	const command = PROFILE_SCRIPT[decision.profile];

	console.log(
		`${LOGGER_PREFIX} profile=${decision.profile} files=${changedFiles.length}`,
	);
	console.log(`${LOGGER_PREFIX} reason=${decision.reason}`);
	if (changedFiles.length > 0) {
		const preview = changedFiles.slice(0, 12);
		console.log(`${LOGGER_PREFIX} files=${preview.join(", ")}`);
		if (changedFiles.length > preview.length) {
			console.log(
				`${LOGGER_PREFIX} files=... +${changedFiles.length - preview.length} more`,
			);
		}
	}

	if (!command) {
		console.log(`${LOGGER_PREFIX} action=skip`);
		return;
	}

	console.log(`${LOGGER_PREFIX} action=npm run ${command}`);
	if (!execute) {
		return;
	}

	await runSubprocess("npm", ["run", command], { env: process.env });
}

main().catch((error) => {
	const message = error instanceof Error ? error.message : String(error);
	console.error(`${LOGGER_PREFIX} failed: ${message}`);
	process.exit(1);
});
