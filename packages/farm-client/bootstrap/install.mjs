#!/usr/bin/env node
/**
 * install — cold-bootstrap the farm-client kit onto a device with nothing but
 * Node. No git, no clone, no npm — the first install straight from the farm's
 * own mesh server:
 *
 *   curl -fsSL http://serpro-1577853:4321/install.mjs | node --input-type=module -
 *
 * `refarm dist publish --host <name>` bakes the farm host/port below; FARM_HOST
 * / FARM_DIST_PORT / FARM_KIT_DIR override. Self-contained on purpose — it can't
 * import the kit it installs — so it inlines the sha256 integrity check and the
 * download loop. Once installed, farm-update takes over (this file is only the
 * cold start). See docs/superpowers/specs/2026-07-24-mesh-artifact-distribution-design.md.
 */
import { createHash } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const HOST = process.env.FARM_HOST || "__FARM_HOST__";
const PORT = Number(process.env.FARM_DIST_PORT || "__FARM_PORT__");
const KIT_DIR = process.env.FARM_KIT_DIR || join(homedir(), ".refarm", "kit", "farm-client");

if (!HOST || HOST === "__FARM_HOST__") {
	console.error("❌ defina FARM_HOST (o nome MagicDNS da fazenda), ex.: FARM_HOST=serpro-1577853");
	process.exit(2);
}
const port = Number.isFinite(PORT) && PORT > 0 ? PORT : 4321;

const integrityOf = (bytes) => `sha256-${createHash("sha256").update(bytes).digest("base64")}`;
const safeRelPath = (p) =>
	typeof p === "string" &&
	p.length > 0 &&
	!p.startsWith("/") &&
	!/^[a-zA-Z]:/.test(p) &&
	!p.split(/[\\/]/).some((seg) => seg === "" || seg === "." || seg === "..");

const base = `http://${HOST}:${port}`;
async function get(path, kind) {
	const res = await fetch(`${base}/${path}`);
	if (!res.ok) throw new Error(`HTTP ${res.status} em ${path}`);
	return kind === "bytes" ? Buffer.from(await res.arrayBuffer()) : await res.text();
}

console.log(`\n🌱 farm-client ← ${base}\n`);
let manifest;
try {
	manifest = JSON.parse(await get("manifest.json", "text"));
} catch (err) {
	console.error(`❌ manifesto inalcançável: ${err.message}`);
	console.error(
		`   A fazenda serve? No PC: refarm dist publish --host ${HOST} && refarm web serve .refarm/dist/farm-client --host 0.0.0.0 --port ${port}`,
	);
	process.exit(1);
}

const files = Array.isArray(manifest.files) ? manifest.files : [];
const staging = join(KIT_DIR, ".staging");
await rm(staging, { recursive: true, force: true });
try {
	let i = 0;
	for (const file of files) {
		if (!safeRelPath(file.path)) throw new Error(`caminho inseguro no manifesto: ${file.path}`);
		process.stdout.write(`  ↓ ${file.path} (${++i}/${files.length})\n`);
		const bytes = await get(file.path, "bytes");
		if (integrityOf(bytes) !== file.integrity) throw new Error(`integridade falhou em ${file.path}`);
		const dest = join(staging, file.path);
		await mkdir(dirname(dest), { recursive: true });
		await writeFile(dest, bytes);
	}
	for (const file of files) {
		const dest = join(KIT_DIR, file.path);
		await mkdir(dirname(dest), { recursive: true });
		await rename(join(staging, file.path), dest);
	}
	await writeFile(join(KIT_DIR, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
	await writeFile(join(KIT_DIR, ".farm-host"), `${HOST}\n`);
} catch (err) {
	console.error(`\n❌ instalação abortada: ${err.message}`);
	await rm(staging, { recursive: true, force: true });
	process.exit(1);
}
await rm(staging, { recursive: true, force: true });

console.log(`\n✔ farm-client ${manifest.version ?? ""} instalado em ${KIT_DIR}`);
console.log(`  fazenda lembrada: ${HOST}`);
console.log(`  rode: node ${join(KIT_DIR, "bin", "farm-ask.mjs")} "quem é você?"\n`);
