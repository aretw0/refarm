#!/usr/bin/env node
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateRuntimeAgentPluginPackage } from "../validate-packages.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PACKAGE_DIR = "packages/agent";
const REQUIRED_FILES = ["dist/agent.wasm", "dist/plugin.json", "dist/jco"];
const REQUIRED_SCRIPTS = ["check:wit", "build:wasm", "build:jco", "build", "test"];
const REQUIRED_README_MARKERS = [
	"## Package Boundary",
	"## Minimal core vs shared primitives",
	"Current **extraction candidates**",
];

export function parseAgentReleaseProofArgs(argv = []) {
	const options = {
		json: false,
	};

	for (const arg of argv) {
		if (arg === "--") {
			continue;
		}
		if (arg === "--json") {
			options.json = true;
			continue;
		}
		throw new Error(`Unknown agent release proof argument: ${arg}`);
	}

	return options;
}

function readJson(cwd, relativePath) {
	return JSON.parse(readFileSync(path.join(cwd, relativePath), "utf8"));
}

function readText(cwd, relativePath) {
	return readFileSync(path.join(cwd, relativePath), "utf8");
}

function missingEntries(expected, actual) {
	const set = new Set(actual || []);
	return expected.filter((entry) => !set.has(entry));
}

function collectFailures({ packageJson, readme, pluginManifest }) {
	const failures = [];

	failures.push(...validateRuntimeAgentPluginPackage(packageJson));

	if (packageJson.name !== "@refarm.dev/agent") {
		failures.push('package name must be "@refarm.dev/agent"');
	}
	if (packageJson.version !== "0.1.0") {
		failures.push('first release version must stay "0.1.0" before initial publish');
	}
	if (packageJson.private === true) {
		failures.push("runtime-agent engine package must not be private when release proof is claimed");
	}
	if (packageJson.publishConfig?.access !== "public") {
		failures.push('runtime-agent engine package must declare publishConfig.access="public"');
	}

	for (const entry of missingEntries(REQUIRED_FILES, packageJson.files)) {
		failures.push(`package files must include "${entry}"`);
	}
	for (const entry of packageJson.files || []) {
		if (typeof entry === "string" && (entry.startsWith("src") || entry.includes("target"))) {
			failures.push(`package files must not publish source/build cache entry "${entry}"`);
		}
	}

	for (const script of REQUIRED_SCRIPTS) {
		if (!packageJson.scripts?.[script]) {
			failures.push(`package scripts must include "${script}"`);
		}
	}

	if (!packageJson.scripts?.["build"]?.includes("build:wasm") && !packageJson.scripts?.["build"]?.includes("jco transpile")) {
		failures.push("package build script must produce both WASM and JCO artifacts");
	}

	for (const marker of REQUIRED_README_MARKERS) {
		if (!readme.includes(marker)) {
			failures.push(`README must document "${marker}"`);
		}
	}
	if (!readme.includes("public") || !readme.includes("dist/agent.wasm")) {
		failures.push("README must document public package boundary and WASM artifact allowlist");
	}

	if (pluginManifest.id !== "@refarm/agent") {
		failures.push('plugin manifest id must remain "@refarm/agent" for host runtime compatibility');
	}

	return failures;
}

export function buildAgentReleaseProof({ cwd = ROOT } = {}) {
	const packageJson = readJson(cwd, `${PACKAGE_DIR}/package.json`);
	const pluginManifest = readJson(cwd, `${PACKAGE_DIR}/plugin.json`);
	const readme = readText(cwd, `${PACKAGE_DIR}/README.md`);
	const failures = collectFailures({ packageJson, readme, pluginManifest });

	return {
		schemaVersion: 1,
		command: "agent-release-proof",
		ok: failures.length === 0,
		packageName: packageJson.name,
		version: packageJson.version,
		packageDir: PACKAGE_DIR,
		claim:
			"@refarm.dev/agent is a public runtime-engine package with an explicit built-artifact publish boundary; broader plugin runtime surfaces can remain held separately.",
		publicationBoundary: {
			access: packageJson.publishConfig?.access ?? null,
			files: packageJson.files || [],
			pluginId: pluginManifest.id ?? null,
		},
		requiredScripts: REQUIRED_SCRIPTS.map((script) => ({
			script,
			present: Boolean(packageJson.scripts?.[script]),
		})),
		readmeMarkers: REQUIRED_README_MARKERS.map((marker) => ({
			marker,
			present: readme.includes(marker),
		})),
		failures,
	};
}

function printHuman(proof) {
	console.log(`[agent:release-proof] ${proof.claim}`);
	console.log(`[agent:release-proof] package=${proof.packageName}@${proof.version} ok=${proof.ok}`);
	for (const entry of proof.publicationBoundary.files) {
		console.log(`[agent:release-proof] file ${entry}`);
	}
}

function isMain() {
	return process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
}

if (isMain()) {
	try {
		const options = parseAgentReleaseProofArgs(process.argv.slice(2));
		const proof = buildAgentReleaseProof();
		if (options.json) {
			console.log(JSON.stringify(proof, null, 2));
		} else {
			printHuman(proof);
		}
		if (!proof.ok) {
			process.exit(1);
		}
	} catch (error) {
		console.error(`[agent:release-proof] ${error instanceof Error ? error.message : String(error)}`);
		process.exit(1);
	}
}
