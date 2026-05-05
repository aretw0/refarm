#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
	cp,
	mkdir,
	readdir,
	readFile,
	stat,
	writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "./runtime-descriptor-cli.mjs";

async function walkDescriptors(rootDir, results = []) {
	const entries = await readdir(rootDir, { withFileTypes: true });
	for (const entry of entries) {
		const fullPath = path.join(rootDir, entry.name);
		if (entry.isDirectory()) {
			await walkDescriptors(fullPath, results);
			continue;
		}

		if (entry.name.endsWith(".runtime-descriptor.json")) {
			results.push(fullPath);
		}
	}
	return results;
}

function sha256Base64(input) {
	return `sha256-${createHash("sha256").update(input).digest("base64")}`;
}

function isFullCommitSha(value) {
	return typeof value === "string" && /^[a-f0-9]{40}$/i.test(value.trim());
}

function parseDescriptorJson(raw, absolutePath) {
	const descriptor = JSON.parse(raw);

	if (descriptor?.schemaVersion !== 1) {
		throw new Error(`${absolutePath}: schemaVersion must be 1`);
	}

	if (!descriptor?.pluginId || !descriptor?.componentWasmUrl) {
		throw new Error(`${absolutePath}: pluginId/componentWasmUrl are required`);
	}

	if (!descriptor?.module?.url || !descriptor?.module?.integrity) {
		throw new Error(
			`${absolutePath}: module.url/module.integrity are required`,
		);
	}

	if (descriptor?.module?.format !== "esm") {
		throw new Error(`${absolutePath}: module.format must be 'esm'`);
	}

	if (!descriptor?.descriptorIntegrity) {
		throw new Error(`${absolutePath}: descriptorIntegrity is required`);
	}

	if (!descriptor?.toolchain?.name || !descriptor?.toolchain?.version) {
		throw new Error(
			`${absolutePath}: toolchain.name/toolchain.version are required`,
		);
	}

	if (
		!descriptor?.provenance?.buildId ||
		!isFullCommitSha(descriptor?.provenance?.commitSha)
	) {
		throw new Error(
			`${absolutePath}: provenance.buildId + full provenance.commitSha are required`,
		);
	}

	return descriptor;
}

function safeUrlPathBasename(urlString) {
	try {
		const parsed = new URL(urlString);
		return path.basename(parsed.pathname);
	} catch {
		return null;
	}
}

async function runVerifier(verifierPath, descriptorFile, moduleFile) {
	return await new Promise((resolve) => {
		const child = spawn(
			process.execPath,
			[
				verifierPath,
				"--descriptor-file",
				descriptorFile,
				"--module-file",
				moduleFile,
			],
			{ stdio: "pipe" },
		);

		let stderr = "";
		child.stderr.on("data", (chunk) => {
			stderr += chunk.toString();
		});
		child.on("error", (error) => {
			resolve({ ok: false, error: error.message });
		});
		child.on("exit", (code) => {
			if (code === 0) {
				resolve({ ok: true });
				return;
			}
			resolve({ ok: false, error: stderr.trim() || `exit code ${code}` });
		});
	});
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	const root = process.cwd();
	const outDir = path.resolve(
		root,
		args["out-dir"] || ".artifacts/runtime-descriptors",
	);
	const version = args.version || process.env.GITHUB_SHA || "local";

	const tractorVerifyScript = path.resolve(
		root,
		"packages/tractor-ts/scripts/verify-browser-runtime-module-descriptor.mjs",
	);

	const packagesRoot = path.resolve(root, "packages");
	const packageDirs = await readdir(packagesRoot, { withFileTypes: true });
	const descriptorFiles = [];

	for (const packageDir of packageDirs) {
		if (!packageDir.isDirectory()) continue;
		const distDir = path.join(packagesRoot, packageDir.name, "dist");
		try {
			const info = await stat(distDir);
			if (!info.isDirectory()) continue;
			descriptorFiles.push(...(await walkDescriptors(distDir)));
		} catch {
			// No dist dir for package => ignore.
		}
	}

	await mkdir(outDir, { recursive: true });
	const filesOutDir = path.join(outDir, "files");
	await mkdir(filesOutDir, { recursive: true });

	const descriptors = [];
	for (const descriptorFile of descriptorFiles) {
		const descriptorRaw = await readFile(descriptorFile, "utf8");
		const descriptor = parseDescriptorJson(descriptorRaw, descriptorFile);
		const descriptorHash = sha256Base64(descriptorRaw);

		const descriptorRelative = path.relative(root, descriptorFile);
		const descriptorCopyPath = path.join(filesOutDir, descriptorRelative);
		await mkdir(path.dirname(descriptorCopyPath), { recursive: true });
		await cp(descriptorFile, descriptorCopyPath);

		const moduleBasename = safeUrlPathBasename(descriptor.module.url);
		let moduleRelativePath = null;
		let verifyResult = { ok: false, error: "module file not found in dist" };
		if (moduleBasename) {
			const candidateModulePath = path.join(
				path.dirname(descriptorFile),
				moduleBasename,
			);
			try {
				const info = await stat(candidateModulePath);
				if (info.isFile()) {
					moduleRelativePath = path.relative(root, candidateModulePath);
					const moduleCopyPath = path.join(filesOutDir, moduleRelativePath);
					await mkdir(path.dirname(moduleCopyPath), { recursive: true });
					await cp(candidateModulePath, moduleCopyPath);
					verifyResult = await runVerifier(
						tractorVerifyScript,
						descriptorFile,
						candidateModulePath,
					);
				}
			} catch {
				// No colocated module file found in dist; keep advisory warning.
			}
		}

		descriptors.push({
			pluginId: descriptor.pluginId,
			componentWasmUrl: descriptor.componentWasmUrl,
			descriptorPath: descriptorRelative,
			descriptorHash,
			descriptorIntegrity: descriptor.descriptorIntegrity,
			descriptor,
			moduleUrl: descriptor.module.url,
			modulePath: moduleRelativePath,
			toolchain: descriptor.toolchain,
			provenance: descriptor.provenance,
			verification: verifyResult.ok ? "passed" : "advisory-warning",
			verificationError: verifyResult.ok ? undefined : verifyResult.error,
		});
	}

	const manifest = {
		schemaVersion: 1,
		generatedAt: new Date().toISOString(),
		version,
		descriptorCount: descriptors.length,
		descriptors,
		revocation: {
			status: "active",
			listPath: "bundle.revocations.json",
			notes:
				"To revoke a descriptor, ship a new bundle manifest marking descriptorHash as revoked and bump bundle version.",
		},
	};

	const manifestPath = path.join(outDir, "bundle.manifest.json");
	await writeFile(
		manifestPath,
		`${JSON.stringify(manifest, null, 2)}\n`,
		"utf8",
	);
	const revocationPayload = {
		schemaVersion: 1,
		updatedAt: new Date().toISOString(),
		revokedDescriptorHashes: [],
		notes:
			"Fill revokedDescriptorHashes with descriptorHash values from bundle.manifest.json when rolling back external descriptors.",
	};

	const revocationListPath = path.join(outDir, "bundle.revocations.json");
	await writeFile(
		revocationListPath,
		`${JSON.stringify(revocationPayload, null, 2)}\n`,
		"utf8",
	);

	const revocationTemplatePath = path.join(
		outDir,
		"bundle.revocations.template.json",
	);
	await writeFile(
		revocationTemplatePath,
		`${JSON.stringify(revocationPayload, null, 2)}\n`,
		"utf8",
	);

	console.log(`[descriptor-bundle] version=${version}`);
	console.log(`[descriptor-bundle] descriptors=${descriptors.length}`);
	console.log(`[descriptor-bundle] manifest=${manifestPath}`);
}

main().catch((error) => {
	console.error(`[descriptor-bundle] failed: ${error?.message ?? error}`);
	process.exit(1);
});
