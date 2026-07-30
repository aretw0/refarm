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
import { pathToFileURL } from "node:url";

const HOST = process.env.FARM_HOST || "__FARM_HOST__";
const PORT = Number(process.env.FARM_DIST_PORT || "__FARM_PORT__");
const KIT_DIR = process.env.FARM_KIT_DIR || join(homedir(), ".refarm", "kit", "farm-client");

// The "nobody baked a host into me" sentinel, assembled at RUN time so that
// `bakeInstaller`'s replaceAll cannot rewrite it. Written as a literal, this
// guard was substituted along with the value it guards — `refarm dist publish
// --host serpro-1577853` produced `HOST === "serpro-1577853"`, so the baked
// installer refused its own baked farm and the cold-bootstrap one-liner exited 2
// every time unless the operator overrode FARM_HOST with a DIFFERENT name.
const UNBAKED = ["__FARM", "HOST__"].join("_");

if (!HOST || HOST === UNBAKED) {
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
	// O bind fora do loopback é RECUSADO sem política de auth (esse listener faz proxy
	// de /sync para o socket CRDT do daemon). Dizer o comando sem a pré-condição fazia
	// o operador levar a recusa na cara depois de seguir a instrução.
	console.error(
		`   (o web serve exige REFARM_AUTH_POLICY para bind fora do loopback — \`refarm auth enroll\` gera a política)`,
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

// Atalhos: o instalador não pode importar o kit ANTES de instalá-lo — mas
// depois, pode. Então ele USA o `src/shims.mjs` que acabou de escrever em vez de
// reimplementar o plantio aqui (o mesmo módulo que o farm-update replanta a cada
// atualização). Se a fazenda servir um kit antigo, sem o módulo, a instalação
// segue válida e o operador recebe o caminho completo.
//
// O que este bloco NUNCA faz: escrever no perfil de shell de ninguém. Ele diz se
// o diretório está no PATH e qual é a única linha a acrescentar — e para aí.
try {
	const shims = await import(pathToFileURL(join(KIT_DIR, "src", "shims.mjs")).href);
	const binDir = shims.defaultBinDir();
	const planted = await shims.installShims({ kitDir: KIT_DIR, binDir });
	if (planted.created.length === 0) {
		throw new Error(`nenhum atalho pôde ser criado em ${binDir}`);
	}
	for (const line of shims.pathAdviceLines(shims.pathStatus({ binDir }), { kitDir: KIT_DIR })) {
		console.log(line);
	}
} catch (err) {
	console.log(`  (sem atalhos: ${err.message})`);
	console.log(`  rode: node ${join(KIT_DIR, "bin", "farm-ask.mjs")} "quem é você?"`);
}
console.log("");
