import { createHash } from "node:crypto";
import type { Dirent } from "node:fs";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { createProcessHandoffDisplay, runProcessHandoffSync } from "@refarm.dev/cli/process-handoff";
import { Command } from "commander";

import { refarmCommand } from "../brand.js";
import { guardedAction, type RefusalHandoff } from "./action-boundary.js";

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

/** Bake the farm host + port into the cold-bootstrap installer template. PURE.
 * An empty host leaves the installer requiring FARM_HOST at run time. */
export function bakeInstaller(template: string, opts: { host: string; port: number }): string {
	return template.replaceAll("__FARM_HOST__", opts.host).replaceAll("__FARM_PORT__", String(opts.port));
}

/** Select the stable address Tailscale assigned to this node. PURE.
 *
 * `HostName` is only the OS label and can collide with local DNS or another node.
 * `DNSName` is the canonical MagicDNS FQDN; Tailscale prints it with a terminal
 * root dot, which is valid DNS but needlessly awkward in operator-facing URLs. */
export function tailnetSelfHost(status: unknown): string | null {
	if (typeof status !== "object" || status === null) return null;
	const self = (status as { Self?: unknown }).Self;
	if (typeof self !== "object" || self === null) return null;
	const { DNSName, HostName } = self as { DNSName?: unknown; HostName?: unknown };
	if (typeof DNSName === "string" && DNSName.trim()) return DNSName.trim().replace(/\.$/, "");
	return typeof HostName === "string" && HostName.trim() ? HostName.trim() : null;
}

/** This machine's MagicDNS name, best-effort — so `dist publish` bakes the farm's
 * own name into the installer without the operator repeating it. null if the
 * tailscale CLI is absent or errors. */
function detectTailnetHost(): string | null {
	try {
		// Route through the process-handoff adapter, not node:child_process directly — the app
		// source keeps the process boundary (apps/refarm/test/architecture/process-boundary.test.ts).
		const args = ["status", "--json"];
		const result = runProcessHandoffSync(
			{ command: "tailscale", args, display: createProcessHandoffDisplay("tailscale", args) },
			{ capture: true, timeout: 3000 },
		);
		if (result.exitCode !== 0 || !result.stdout) return null;
		return tailnetSelfHost(JSON.parse(result.stdout));
	} catch {
		return null;
	}
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

/** Collect the kit's distributable files: every .mjs under src/ and bin/, each
 * complete package capsule under vendor/, plus README.md when present. Tests
 * (test/), scripts and configs are intentionally excluded.
 *
 * `vendor/` carries BUILT blocks the zero-dependency kit reuses instead of
 * reimplementing (today: `@refarm.dev/prompt-contract-v1`, which is what lets
 * the kit ASK for the farm's name instead of explaining it). Zero-dependency
 * means nothing to install on the device — not nothing to reuse — so a vendored
 * block is distributed, hashed, and integrity-checked like every other kit file. */
export async function collectKitFiles(kitDir: string): Promise<KitFile[]> {
	const files: KitFile[] = [];
	async function collect(relativeDir: string, accept: (name: string) => boolean): Promise<void> {
		let entries: Dirent[];
		try {
			entries = await readdir(path.join(kitDir, relativeDir), { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
			const rel = `${relativeDir}/${entry.name}`;
			if (entry.isDirectory()) {
				await collect(rel, accept);
				continue;
			}
			if (!entry.isFile() || !accept(entry.name)) continue;
			files.push({ path: rel, content: await readFile(path.join(kitDir, rel)) });
		}
	}
	await collect("src", (name) => name.endsWith(".mjs"));
	await collect("bin", (name) => name.endsWith(".mjs"));
	await collect("vendor", () => true);
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
	host?: string;
	port?: string;
	json?: boolean;
}

/** A `dist publish` that cannot read its kit (a missing `package.json`, an unbuilt
 *  `--kit` dir) refuses instead of throwing a raw ENOENT at the operator. */
const DIST_PUBLISH_REFUSAL_HANDOFF: RefusalHandoff = {
	command: "dist",
	operation: "publish",
	error: "dist-publish-failed",
	nextAction:
		"Check that the kit directory exists and is built, or point --kit at one, then re-run.",
	nextCommand: refarmCommand(["dist", "publish", "--help"]),
};

export function createDistPublishCommand(): Command {
	return new Command("publish")
		.description("Assemble the farm-client kit + a hash-verified manifest into a served dir")
		.option("--kit <dir>", "Kit package dir to publish", "packages/farm-client")
		.option("--out <dir>", "Output root (served over the mesh)", ".refarm/dist")
		.option(
			"--host <name>",
			"Farm MagicDNS name baked into the cold-bootstrap installer (auto-detected from tailscale if omitted)",
		)
		.option("--port <port>", "Port the mesh server will use — baked into the installer + hints", "4321")
		.option("--json", "Print the result as JSON")
		.action(
			guardedAction(
				(options: DistPublishOptions) => ({
					json: options.json === true,
					...DIST_PUBLISH_REFUSAL_HANDOFF,
				}),
				async (options: DistPublishOptions) => {
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
					await writeFile(
						path.join(outDir, "manifest.json"),
						`${JSON.stringify(manifest, null, 2)}\n`,
					);

					// Cold-bootstrap: a single self-contained installer, so a device with
					// only Node installs the kit with no git/clone. Bake the farm's name so
					// the served URL and the installer agree on where home is.
					const port = Number.parseInt(options.port ?? "4321", 10) || 4321;
					const host = options.host ?? detectTailnetHost() ?? "";
					const template = await readFile(path.join(kitDir, "bootstrap", "install.mjs"), "utf8");
					await writeFile(
						path.join(outDir, "install.mjs"),
						bakeInstaller(template, { host, port }),
					);

					// NO `--host` in the hint. Serving the kit to other devices is the whole point of
					// `dist publish`, but since O5 that exposure comes from the DECLARATION, not from a
					// flag: `surfaces.web` in .refarm/config.json is the ceiling, and a flag may only
					// narrow it (docs/superpowers/specs/2026-07-30-open-by-declaration-surfaces-design.md).
					// So the hint names the command, and the line under it names the declaration that
					// opens it — instead of a flag that would now simply be refused.
					const serveHint = refarmCommand([
						"web",
						"serve",
						path.relative(process.cwd(), outDir) || outDir,
						"--port",
						String(port),
					]);
					const coldBootstrap = host
						? `curl -fsSL http://${host}:${port}/install.mjs | node --input-type=module -`
						: `FARM_HOST=<farm> curl -fsSL http://<farm>:${port}/install.mjs | node --input-type=module -`;
					if (options.json) {
						process.stdout.write(
							`${JSON.stringify({
								ok: true,
								outDir,
								name: manifest.name,
								version: manifest.version,
								files: manifest.files.length,
								host: host || null,
								port,
								serveCommand: serveHint,
								coldBootstrap,
							})}\n`,
						);
					} else {
						process.stdout.write(
							`📦 farm-client ${manifest.version} → ${outDir}\n` +
								`   ${manifest.files.length} file(s) + manifest.json + install.mjs (sha256-verified).\n` +
								`   Serve on the mesh: ${serveHint}\n` +
								`     (loopback until declared. To reach other devices, declare it in\n` +
								`      .refarm/config.json: "surfaces": { "web": { "expose": "tailnet", "gate": "none" } }\n` +
								`      — deliberately open, read-only, admitted devices only)\n` +
								`   Cold-bootstrap (device, no git): ${coldBootstrap}\n` +
								`   Update thereafter:  farm-update\n`,
						);
					}
				},
			),
		);
}

export function createDistCommand(): Command {
	return new Command("dist")
		.description("Publish built artifacts for devices to download + update over the mesh")
		.addCommand(createDistPublishCommand());
}

export const distCommand = createDistCommand();
