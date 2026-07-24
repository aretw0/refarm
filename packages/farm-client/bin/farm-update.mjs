#!/usr/bin/env node
/**
 * farm-update — pull the latest kit from the farm's mesh artifact server.
 *
 * The dev PC publishes a built payload + manifest (`refarm dist publish`) and
 * serves it over the tailnet (`refarm web serve … --host 0.0.0.0`). This updates
 * a device from that server: fetch the manifest, download only the changed files,
 * VERIFY each one's sha256 integrity, and swap them into place atomically — so a
 * device gets updates with nothing installed but Node (no git, no npm, no clone).
 *
 * Usage:
 *   farm-update                     # tailnet host, then localhost; port 4321
 *   FARM_HOST=serpro-1577853 farm-update
 *   FARM_DIST_PORT=4321 FARM_KIT_DIR=~/.refarm/kit/farm-client farm-update
 */
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { readRememberedHost, writeRememberedHost } from "../src/farm-host.mjs";
import { integrityOf, planUpdate } from "../src/manifest.mjs";
import { tailnetPeers } from "../src/tailnet.mjs";

const DIST_PORT = Number(process.env.FARM_DIST_PORT ?? 4321);
const KIT_DIR = process.env.FARM_KIT_DIR ?? join(homedir(), ".refarm", "kit", "farm-client");

async function fetchWith(url, kind, timeoutMs) {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		const res = await fetch(url, { signal: controller.signal });
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		return kind === "bytes" ? Buffer.from(await res.arrayBuffer()) : await res.text();
	} finally {
		clearTimeout(timer);
	}
}

async function distReachable(host) {
	try {
		await fetchWith(`http://${host}:${DIST_PORT}/manifest.json`, "text", 3000);
		return true;
	} catch {
		return false;
	}
}

async function resolveHost() {
	// 1) Explicit override. 2) The farm this kit was installed from (so repeat
	// updates need no host). 3) Tailnet auto-discovery. 4) localhost.
	if (process.env.FARM_HOST) return process.env.FARM_HOST;
	const remembered = await readRememberedHost(KIT_DIR);
	if (remembered && (await distReachable(remembered))) return remembered;
	for (const peer of await tailnetPeers()) {
		if (await distReachable(peer.ip)) return peer.ip;
	}
	return "127.0.0.1";
}

function fmtBytes(n) {
	if (n < 1024) return `${n} B`;
	if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
	return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

async function readLocalManifest() {
	try {
		return await readFile(join(KIT_DIR, "manifest.json"), "utf8");
	} catch {
		return null;
	}
}

const host = await resolveHost();
const base = `http://${host}:${DIST_PORT}`;

let remoteRaw;
try {
	remoteRaw = await fetchWith(`${base}/manifest.json`, "text", 8000);
} catch (err) {
	console.error(`❌ manifesto inalcançável em ${base}/manifest.json: ${err.message}`);
	console.error(
		`   No PC: refarm dist publish && refarm web serve .refarm/dist/farm-client --host 0.0.0.0 --port ${DIST_PORT}`,
	);
	process.exit(1);
}

let plan;
try {
	plan = planUpdate(remoteRaw, await readLocalManifest());
} catch (err) {
	console.error(`❌ manifesto inválido: ${err.message}`);
	process.exit(1);
}

console.log(`\n🌱 farm-update ← ${host}  [${plan.name} ${plan.fromVersion ?? "(nenhum)"} → ${plan.toVersion}]\n`);
if (plan.upToDate) {
	await writeRememberedHost(KIT_DIR, host);
	console.log("✔ já atualizado\n");
	process.exit(0);
}

// Download + verify into a staging dir first; only swap once ALL files pass, so
// a failure mid-update never leaves the kit half-written or advertising a
// version it doesn't have.
const staging = join(KIT_DIR, ".staging");
await rm(staging, { recursive: true, force: true });
try {
	for (const file of plan.toDownload) {
		const bytes = await fetchWith(`${base}/${file.path}`, "bytes", 30000);
		const got = integrityOf(bytes);
		if (got !== file.integrity) {
			throw new Error(`integridade falhou em ${file.path}\n   esperado ${file.integrity}\n   obtido   ${got}`);
		}
		const dest = join(staging, file.path);
		await mkdir(dirname(dest), { recursive: true });
		await writeFile(dest, bytes);
	}
	// Commit: move each staged file into place, then write the manifest last.
	for (const file of plan.toDownload) {
		const dest = join(KIT_DIR, file.path);
		await mkdir(dirname(dest), { recursive: true });
		await rename(join(staging, file.path), dest);
	}
	await writeFile(join(KIT_DIR, "manifest.json"), remoteRaw);
} catch (err) {
	console.error(`❌ atualização abortada: ${err.message}`);
	await rm(staging, { recursive: true, force: true });
	process.exit(1);
}
await rm(staging, { recursive: true, force: true });
// The kit remembers the farm it came from, so farm-ask needs no host next time.
await writeRememberedHost(KIT_DIR, host);

console.log(
	`↻ ${plan.name} ${plan.fromVersion ?? "(nenhum)"} → ${plan.toVersion} · ${plan.toDownload.length} arquivo(s) · ${fmtBytes(plan.totalBytes)}`,
);
console.log(`  kit em ${KIT_DIR} (fazenda lembrada: ${host})`);
console.log(`  rodar: node ${join(KIT_DIR, "bin/farm-ask.mjs")} "sua pergunta"\n`);
