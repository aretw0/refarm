#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

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

function isLikelyCommitSha(value) {
	return typeof value === "string" && /^[a-f0-9]{40}$/i.test(value.trim());
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	const descriptorFile = args["descriptor-file"];
	const moduleFile = args["module-file"];

	if (!descriptorFile || !moduleFile) {
		console.error(
			"Usage: node scripts/verify-browser-runtime-module-descriptor.mjs --descriptor-file <path> --module-file <path>",
		);
		process.exit(1);
	}

	const descriptor = JSON.parse(await readFile(descriptorFile, "utf8"));
	const moduleSource = await readFile(moduleFile, "utf8");

	if (descriptor?.schemaVersion !== 1) {
		throw new Error("descriptor schemaVersion must be 1");
	}

	if (!descriptor?.pluginId || !descriptor?.componentWasmUrl) {
		throw new Error("descriptor must include pluginId and componentWasmUrl");
	}

	if (!descriptor?.module?.url || !descriptor?.module?.integrity) {
		throw new Error("descriptor.module must include url and integrity");
	}

	if (descriptor.module.format !== "esm") {
		throw new Error("descriptor.module.format must be 'esm'");
	}

	if (!descriptor?.descriptorIntegrity) {
		throw new Error("descriptorIntegrity is required");
	}

	if (!descriptor?.toolchain?.name || !descriptor?.toolchain?.version) {
		throw new Error("descriptor.toolchain.name/version are required");
	}

	if (!descriptor?.provenance?.buildId) {
		throw new Error("descriptor.provenance.buildId is required");
	}

	if (!isLikelyCommitSha(descriptor?.provenance?.commitSha)) {
		throw new Error(
			"descriptor.provenance.commitSha must be a full 40-char git SHA",
		);
	}

	const moduleIntegrity = sha256Base64(moduleSource);
	if (moduleIntegrity !== descriptor.module.integrity) {
		throw new Error(
			`module integrity mismatch: expected ${descriptor.module.integrity}, got ${moduleIntegrity}`,
		);
	}

	const canonicalWithoutIntegrity = JSON.stringify(
		stableCanonicalize({ ...descriptor, descriptorIntegrity: undefined }),
	);
	const descriptorIntegrity = sha256Base64(canonicalWithoutIntegrity);

	if (descriptorIntegrity !== descriptor.descriptorIntegrity) {
		throw new Error(
			`descriptor integrity mismatch: expected ${descriptor.descriptorIntegrity}, got ${descriptorIntegrity}`,
		);
	}

	console.log("[descriptor-verify] ok");
}

main().catch((error) => {
	console.error(`[descriptor-verify] failed: ${error?.message ?? error}`);
	process.exit(1);
});
