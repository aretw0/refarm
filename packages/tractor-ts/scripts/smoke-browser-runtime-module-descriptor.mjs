#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

function runNodeScript(scriptPath, args) {
	return new Promise((resolve, reject) => {
		const child = spawn(process.execPath, [scriptPath, ...args], {
			stdio: "inherit",
		});

		child.on("error", reject);
		child.on("exit", (code) => {
			if (code === 0) resolve();
			else
				reject(
					new Error(`${path.basename(scriptPath)} exited with code ${code}`),
				);
		});
	});
}

async function main() {
	const __filename = fileURLToPath(import.meta.url);
	const scriptsDir = path.dirname(__filename);
	const generatorPath = path.join(
		scriptsDir,
		"generate-browser-runtime-module-descriptor.mjs",
	);
	const verifyPath = path.join(
		scriptsDir,
		"verify-browser-runtime-module-descriptor.mjs",
	);

	const tempDir = await mkdtemp(
		path.join(tmpdir(), "refarm-runtime-descriptor-"),
	);
	const moduleFile = path.join(tempDir, "component.browser.mjs");
	const descriptorFile = path.join(
		tempDir,
		"component.runtime-descriptor.json",
	);
	const descriptorFile2 = path.join(
		tempDir,
		"component.runtime-descriptor.2.json",
	);

	const generatedAt = "2026-04-23T00:00:00.000Z";
	const provenanceCommit = "1111111111111111111111111111111111111111";
	const provenanceBuild = "runtime-descriptor-smoke-build";
	const provenanceRepo = "https://github.com/aretw0/refarm";

	try {
		await writeFile(
			moduleFile,
			"export default { async setup(){ return 'ok'; }, async ping(){ return 'pong'; } };\n",
			"utf8",
		);

		const descriptorArgs = [
			"--plugin-id",
			"@refarm.dev/component-smoke",
			"--component-url",
			"https://example.test/component.wasm",
			"--module-file",
			moduleFile,
			"--module-url",
			"https://example.test/component.browser.mjs",
			"--provenance-commit",
			provenanceCommit,
			"--provenance-build",
			provenanceBuild,
			"--provenance-repo",
			provenanceRepo,
			"--toolchain-name",
			"tractor-sidecar",
			"--toolchain-version",
			"0.1.0",
			"--generated-at",
			generatedAt,
			"--out",
			descriptorFile,
		];

		await runNodeScript(generatorPath, descriptorArgs);
		await runNodeScript(verifyPath, [
			"--descriptor-file",
			descriptorFile,
			"--module-file",
			moduleFile,
		]);

		await runNodeScript(generatorPath, [
			...descriptorArgs.slice(0, -1),
			descriptorFile2,
		]);

		const [descriptorContent1, descriptorContent2] = await Promise.all([
			readFile(descriptorFile, "utf8"),
			readFile(descriptorFile2, "utf8"),
		]);

		if (descriptorContent1 !== descriptorContent2) {
			throw new Error(
				"descriptor generation is not deterministic for the same inputs",
			);
		}

		console.log(
			"[descriptor-smoke] deterministic generation + verification passed",
		);
	} finally {
		await rm(tempDir, { recursive: true, force: true });
	}
}

main().catch((error) => {
	console.error(`[descriptor-smoke] failed: ${error?.message ?? error}`);
	process.exit(1);
});
