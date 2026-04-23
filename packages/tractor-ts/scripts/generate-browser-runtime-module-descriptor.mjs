#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

function parseArgs(argv) {
	const args = {};
	for (let i = 0; i < argv.length; i += 1) {
		const token = argv[i];
		if (!token.startsWith("--")) continue;
		const key = token.slice(2);
		const next = argv[i + 1];
		if (!next || next.startsWith("--")) {
			args[key] = true;
		} else {
			args[key] = next;
			i += 1;
		}
	}
	return args;
}

function usage() {
	console.error(
		[
			"Usage:",
			"  node scripts/generate-browser-runtime-module-descriptor.mjs \\",
			"    --plugin-id <id> \\",
			"    --component-url <url> \\",
			"    --module-file <path> \\",
			"    --module-url <url> \\",
			"    [--toolchain-name tractor-sidecar] [--toolchain-version 0.1.0] \\",
			"    [--generated-at 2026-04-23T00:00:00.000Z] [--out <file>]",
		].join("\n"),
	);
}

function stableCanonicalize(value) {
	if (Array.isArray(value))
		return value.map((item) => stableCanonicalize(item));
	if (value && typeof value === "object") {
		return Object.fromEntries(
			Object.entries(value)
				.sort(([a], [b]) => a.localeCompare(b))
				.map(([k, v]) => [k, stableCanonicalize(v)]),
		);
	}
	return value;
}

function sha256Base64(input) {
	return `sha256-${createHash("sha256").update(input).digest("base64")}`;
}

async function main() {
	const args = parseArgs(process.argv.slice(2));

	const pluginId = args["plugin-id"];
	const componentWasmUrl = args["component-url"];
	const moduleFile = args["module-file"];
	const moduleUrl = args["module-url"];

	if (!pluginId || !componentWasmUrl || !moduleFile || !moduleUrl) {
		usage();
		process.exit(1);
	}

	const moduleSource = await readFile(moduleFile, "utf8");
	const moduleIntegrity = sha256Base64(moduleSource);

	const descriptor = {
		schemaVersion: 1,
		pluginId,
		componentWasmUrl,
		module: {
			url: moduleUrl,
			integrity: moduleIntegrity,
			format: "esm",
		},
		toolchain: {
			name: args["toolchain-name"] || "tractor-sidecar",
			version: args["toolchain-version"] || "0.1.0",
			generatedAt: args["generated-at"] || new Date().toISOString(),
		},
	};

	const descriptorCanonical = JSON.stringify(stableCanonicalize(descriptor));
	const descriptorIntegrity = sha256Base64(descriptorCanonical);

	const descriptorWithIntegrity = {
		...descriptor,
		descriptorIntegrity,
	};

	const outFile =
		args.out ||
		path.resolve(
			path.dirname(moduleFile),
			`${path.basename(moduleFile, path.extname(moduleFile))}.runtime-descriptor.json`,
		);

	await mkdir(path.dirname(outFile), { recursive: true });
	await writeFile(
		outFile,
		`${JSON.stringify(descriptorWithIntegrity, null, 2)}\n`,
		"utf8",
	);

	console.log(`[descriptor] written: ${outFile}`);
	console.log(`[descriptor] moduleIntegrity: ${moduleIntegrity}`);
	console.log(`[descriptor] descriptorIntegrity: ${descriptorIntegrity}`);
}

main().catch((error) => {
	console.error(`[descriptor] failed: ${error?.message ?? error}`);
	process.exit(1);
});
