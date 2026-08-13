/**
 * `refarm backup` — ISS-123's second and third gaps.
 *
 * The inventory says what a node holds; `sovereign-export.ts` says what a copy must contain. This
 * is the command that writes one, and the format is chosen so that a restore is inspectable rather
 * than magic: a directory of files plus a `manifest.json` naming every one, its digest, and its
 * original absolute path.
 *
 * NO ARCHIVE FORMAT AND NO DEPENDENCY. A tar would need a library this repository does not carry,
 * and would make the bundle opaque to the operator holding it. A directory can be read, diffed,
 * synced by any tool he already uses, and restored by hand if refarm itself is what broke — which
 * is exactly the situation a backup exists for.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { Command } from "commander";

import { buildJsonSuccessEnvelope, printJson } from "@refarm.dev/capabilities/envelope";

import {
	formatExportPlan,
	planSovereignExport,
	splitSiloContent,
	type ExportPlanEntry,
} from "./sovereign-export.js";
import { inventoryLocation, sovereignLocations } from "./sovereign-inventory.js";

export const MANIFEST_NAME = "manifest.json";
export const BUNDLE_FILES_DIR = "files";

export interface BackupManifest {
	readonly version: 1;
	/** Every carried file: where it came from, where it sits in the bundle, and its digest. */
	readonly files: { source: string; stored: string; sha256: string; bytes: number }[];
	/** Non-secret decisions lifted out of the silo, which no login rebuilds. */
	readonly decisions: Record<string, unknown>;
	/** Providers whose credentials must be obtained again — names only, never secrets. */
	readonly reAuthenticate: string[];
	/** Entries the plan could not decide. Recorded so a restore can say the backup was partial. */
	readonly undecided: { file: string; reason: string }[];
}

/** PURE. Where a source path lives inside the bundle. Absolute paths are flattened onto a relative
 *  tree so the bundle is self-contained and a restore never depends on the original home's name. */
export function storedPathFor(source: string, home: string): string {
	const relative = path.relative(home, source);
	// A path outside the home would escape the bundle with `..`; it is stored under a marker
	// instead of silently landing somewhere unexpected on restore.
	return relative.startsWith("..") ? path.join("_absolute", source.replace(/^[/\\]/u, "")) : relative;
}

/** Collect the inventory for a home. Shared by plan and create so the two cannot disagree. */
export function surveyHome(home: string, namespace: string | null) {
	const locations = sovereignLocations(path.join(home, ".refarm"), path.join(home, ".silo"), home);
	const entries = [
		...inventoryLocation(locations.stateHome, namespace),
		...inventoryLocation(locations.credentialStore, namespace),
		...inventoryLocation(locations.dataDir, namespace),
	];
	return { locations, entries, plan: planSovereignExport(entries) };
}

/** Read the silo's decisions without ever returning its secrets. Absent silo → absent, not empty. */
export function readSiloSplit(home: string): { decisions: Record<string, unknown>; reAuthenticate: string[] } {
	try {
		const raw = JSON.parse(fs.readFileSync(path.join(home, ".silo", "identity.json"), "utf8"));
		const tokens = (raw?.tokens ?? raw) as Record<string, unknown>;
		return splitSiloContent(tokens);
	} catch {
		return { decisions: {}, reAuthenticate: [] };
	}
}

/** Write the bundle. Returns the manifest it wrote, so a caller can verify without re-reading. */
export function writeBundle(
	home: string,
	destination: string,
	carried: readonly ExportPlanEntry[],
	undecided: readonly ExportPlanEntry[],
	silo: { decisions: Record<string, unknown>; reAuthenticate: string[] },
): BackupManifest {
	fs.mkdirSync(path.join(destination, BUNDLE_FILES_DIR), { recursive: true });
	const files: BackupManifest["files"] = [];
	for (const entry of carried) {
		const stored = storedPathFor(entry.file, home);
		const target = path.join(destination, BUNDLE_FILES_DIR, stored);
		fs.mkdirSync(path.dirname(target), { recursive: true });
		const bytes = fs.readFileSync(entry.file);
		fs.writeFileSync(target, bytes);
		files.push({
			source: entry.file,
			stored,
			sha256: createHash("sha256").update(bytes).digest("hex"),
			bytes: bytes.length,
		});
	}
	const manifest: BackupManifest = {
		version: 1,
		files,
		decisions: silo.decisions,
		reAuthenticate: silo.reAuthenticate,
		undecided: undecided.map((entry) => ({ file: entry.file, reason: entry.reason })),
	};
	fs.writeFileSync(path.join(destination, MANIFEST_NAME), `${JSON.stringify(manifest, null, 2)}\n`);
	return manifest;
}

/**
 * Verify a bundle against its own manifest.
 *
 * THREE STATES, because a bundle that cannot be read is not a bundle that is wrong: `intact`,
 * `damaged` (a file is missing or its digest moved), `unreadable` (no manifest at all). Reporting
 * the third as `damaged` would send an operator looking for corruption when the real answer is
 * that he pointed at the wrong directory.
 */
export function verifyBundle(
	destination: string,
): { state: "intact" | "damaged" | "unreadable"; problems: string[]; manifest?: BackupManifest } {
	let manifest: BackupManifest;
	try {
		manifest = JSON.parse(fs.readFileSync(path.join(destination, MANIFEST_NAME), "utf8"));
	} catch {
		return { state: "unreadable", problems: [`no readable ${MANIFEST_NAME} in ${destination}`] };
	}
	const problems: string[] = [];
	for (const file of manifest.files) {
		const target = path.join(destination, BUNDLE_FILES_DIR, file.stored);
		try {
			const digest = createHash("sha256").update(fs.readFileSync(target)).digest("hex");
			if (digest !== file.sha256) problems.push(`${file.stored}: digest does not match the manifest`);
		} catch {
			problems.push(`${file.stored}: named by the manifest and not present`);
		}
	}
	return { state: problems.length === 0 ? "intact" : "damaged", problems, manifest };
}

/** Place a verified bundle's files into a home. Never writes credentials — there are none to write. */
export function restoreBundle(destination: string, home: string): { restored: string[] } {
	const verdict = verifyBundle(destination);
	if (verdict.state !== "intact" || !verdict.manifest) {
		throw new Error(`refusing to restore a ${verdict.state} bundle:\n  ${verdict.problems.join("\n  ")}`);
	}
	const restored: string[] = [];
	for (const file of verdict.manifest.files) {
		const target = path.join(home, file.stored);
		fs.mkdirSync(path.dirname(target), { recursive: true });
		fs.copyFileSync(path.join(destination, BUNDLE_FILES_DIR, file.stored), target);
		restored.push(target);
	}
	return { restored };
}

export function createBackupCommand(homeOf = () => process.env.HOME ?? ""): Command {
	const backup = new Command("backup").description(
		"Plan, write and verify a portable copy of this node's sovereign state",
	);

	backup
		.command("plan")
		.description("Show what a backup would carry, what it would not, and what is undecided")
		.option("--json", "Output machine-readable result")
		.option("--namespace <id>", "Storage namespace to treat as this node's own", "default")
		.action((options: { json?: boolean; namespace?: string }) => {
			const home = homeOf();
			const { plan } = surveyHome(home, options.namespace ?? "default");
			const silo = readSiloSplit(home);
			if (options.json) {
				printJson(
					buildJsonSuccessEnvelope({
						command: "backup",
						operation: "plan",
						extra: { plan, reAuthenticate: silo.reAuthenticate, decisions: silo.decisions },
					}),
				);
				return;
			}
			process.stdout.write(`${formatExportPlan(plan, silo.reAuthenticate)}\n`);
		});

	backup
		.command("create")
		.argument("<destination>", "Directory to write the bundle into")
		.description("Write the bundle, then verify it before reporting success")
		.option("--json", "Output machine-readable result")
		.option("--namespace <id>", "Storage namespace to treat as this node's own", "default")
		.action((destination: string, options: { json?: boolean; namespace?: string }) => {
			const home = homeOf();
			const { plan } = surveyHome(home, options.namespace ?? "default");
			const silo = readSiloSplit(home);
			writeBundle(home, destination, plan.carry, plan.undecidable, silo);
			// VERIFIED BEFORE REPORTING. A create that says "done" without reading back what it wrote
			// is the shape of backup that fails on the day it is needed.
			const verdict = verifyBundle(destination);
			const result = {
				destination,
				state: verdict.state,
				problems: verdict.problems,
				carried: plan.carry.length,
				undecided: plan.undecidable.length,
				reAuthenticate: silo.reAuthenticate,
			};
			if (options.json) {
				printJson(
					buildJsonSuccessEnvelope({ command: "backup", operation: "create", extra: result }),
				);
			} else {
				process.stdout.write(
					`backup ${verdict.state} — ${plan.carry.length} file(s) in ${destination}\n` +
						`  re-authenticate after restoring: ${silo.reAuthenticate.join(", ") || "(none)"}\n` +
						(plan.undecidable.length > 0
							? `  ${plan.undecidable.length} entries UNDECIDED and not carried — see \`refarm backup plan --json\`\n`
							: ""),
				);
			}
			if (verdict.state !== "intact") process.exitCode = 1;
		});

	backup
		.command("verify")
		.argument("<destination>", "Bundle directory to check against its own manifest")
		.description("Check a bundle's files against the digests its manifest recorded")
		.option("--json", "Output machine-readable result")
		.action((destination: string, options: { json?: boolean }) => {
			const verdict = verifyBundle(destination);
			if (options.json) {
				printJson(
					buildJsonSuccessEnvelope({
						command: "backup",
						operation: "verify",
						extra: { destination, state: verdict.state, problems: verdict.problems },
					}),
				);
			} else {
				process.stdout.write(
					`${destination}: ${verdict.state}\n${verdict.problems.map((p) => `  ${p}\n`).join("")}`,
				);
			}
			if (verdict.state !== "intact") process.exitCode = 1;
		});

	return backup;
}

export const backupCommand = createBackupCommand();
