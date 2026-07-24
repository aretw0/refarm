import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { Command } from "commander";

import { refarmCommand } from "../brand.js";

/**
 * `refarm dist publish` — the PC side of mesh artifact distribution.
 *
 * Assembles the farm-client kit + a hash-verified manifest into an ephemeral,
 * gitignored dir, which `refarm web serve` then exposes on the tailnet. A device
 * runs `farm-update` to pull + verify + swap it — updates with nothing installed
 * but Node (no git, no clone), for operators who stay inside their own mesh
 * instead of publishing GitHub releases. See
 * docs/superpowers/specs/2026-07-24-mesh-artifact-distribution-design.md.
 */

/** SRI-style integrity — the same "sha256-<base64>" contract farm-client verifies. */
export function integrityOf(bytes: Buffer | string): string {
	return `sha256-${createHash("sha256").update(bytes).digest("base64")}`;
}

export interface KitFile {
	path: string;
	content: Buffer;
}

export interface KitManifestFile {
	path: string;
	integrity: string;
	bytes: number;
}

export interface KitManifest {
	name: string;
	version: string;
	platform: string | null;
	createdAt: string;
	files: KitManifestFile[];
}

/** Build the manifest from in-memory files. PURE — createdAt is injected, files
 * are hashed and sorted, so the same inputs always produce the same manifest. */
export function buildKitManifest(
	files: KitFile[],
	meta: { name: string; version: string; platform?: string | null; createdAt: string },
): KitManifest {
	return {
		name: meta.name,
		version: meta.version,
		platform: meta.platform ?? null,
		createdAt: meta.createdAt,
		files: files
			.map((f) => ({ path: f.path, integrity: integrityOf(f.content), bytes: f.content.length }))
			.sort((a, b) => a.path.localeCompare(b.path)),
	};
}

/** Collect the kit's distributable files: every .mjs under src/ and bin/, plus
 * README.md when present. Tests (test/) and configs are intentionally excluded. */
async function collectKitFiles(kitDir: string): Promise<KitFile[]> {
	const files: KitFile[] = [];
	for (const sub of ["src", "bin"]) {
		let entries: string[];
		try {
			entries = (await readdir(path.join(kitDir, sub))).filter((name) => name.endsWith(".mjs"));
		} catch {
			continue;
		}
		for (const name of entries.sort()) {
			const rel = `${sub}/${name}`;
			files.push({ path: rel, content: await readFile(path.join(kitDir, rel)) });
		}
	}
	try {
		files.push({ path: "README.md", content: await readFile(path.join(kitDir, "README.md")) });
	} catch {
		// README is optional
	}
	return files;
}

interface DistPublishOptions {
	kit?: string;
	out?: string;
	json?: boolean;
}

export function createDistPublishCommand(): Command {
	return new Command("publish")
		.description("Assemble the farm-client kit + a hash-verified manifest into a served dir")
		.option("--kit <dir>", "Kit package dir to publish", "packages/farm-client")
		.option("--out <dir>", "Output root (served over the mesh)", ".refarm/dist")
		.option("--json", "Print the result as JSON")
		.action(async (options: DistPublishOptions) => {
			const kitDir = path.resolve(options.kit ?? "packages/farm-client");
			const pkg = JSON.parse(await readFile(path.join(kitDir, "package.json"), "utf8")) as {
				version?: string;
			};
			const files = await collectKitFiles(kitDir);
			if (files.length === 0) {
				throw new Error(`dist publish: no kit files found under ${kitDir}/{src,bin}`);
			}
			const manifest = buildKitManifest(files, {
				name: "farm-client",
				version: pkg.version ?? "0.0.0",
				createdAt: new Date().toISOString(),
			});

			const outDir = path.resolve(options.out ?? ".refarm/dist", "farm-client");
			await rm(outDir, { recursive: true, force: true });
			for (const file of files) {
				const dest = path.join(outDir, file.path);
				await mkdir(path.dirname(dest), { recursive: true });
				await writeFile(dest, file.content);
			}
			await writeFile(path.join(outDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

			const serveHint = refarmCommand([
				"web",
				"serve",
				path.relative(process.cwd(), outDir) || outDir,
				"--host",
				"0.0.0.0",
				"--port",
				"4321",
			]);
			if (options.json) {
				process.stdout.write(
					`${JSON.stringify({
						ok: true,
						outDir,
						name: manifest.name,
						version: manifest.version,
						files: manifest.files.length,
						serveCommand: serveHint,
					})}\n`,
				);
			} else {
				process.stdout.write(
					`📦 farm-client ${manifest.version} → ${outDir}\n` +
						`   ${manifest.files.length} file(s) + manifest.json (sha256-verified).\n` +
						`   Serve on the mesh: ${serveHint}\n` +
						`   On a device:       farm-update\n`,
				);
			}
		});
}

export function createDistCommand(): Command {
	return new Command("dist")
		.description("Publish built artifacts for devices to download + update over the mesh")
		.addCommand(createDistPublishCommand());
}

export const distCommand = createDistCommand();
