#!/usr/bin/env node
/**
 * farm-update — pull the latest kit from the farm's mesh artifact server.
 *
 * The dev PC publishes a built payload + manifest (`refarm dist publish`) and
 * serves it over the tailnet (`refarm web serve`, bound by the `surfaces.web`
 * declaration — never by a flag alone). This updates
 * a device from that server: fetch the manifest, download only the changed files,
 * VERIFY each one's sha256 integrity, and swap them into place atomically — so a
 * device gets updates with nothing installed but Node (no git, no npm, no clone).
 *
 * Usage:
 *   farm-update                     # tailnet host, then localhost; port 4321
 *   FARM_HOST=serpro-1577853 farm-update
 *   FARM_DIST_PORT=4321 FARM_KIT_DIR=~/.refarm/kit/farm-client farm-update
 *
 * Sem rede, e de propósito — a soberania sobre a alteração de PATH que o kit pediu:
 *   farm-update --revisit-path   # reabre a pergunta que você já respondeu
 *   farm-update --undo-path      # desfaz a alteração autorizada, e registra o desfazer
 */
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { cancellationExit, resolveFarmHost } from "../src/ask-host.mjs";
import { writeRememberedHost } from "../src/farm-host.mjs";
import { conditionalManifestHeaders, integrityOf, isUsableETag, planUpdate } from "../src/manifest.mjs";
import { ensurePathOperation, undoPathOperation } from "../src/path-operation.mjs";
import { createSpinner } from "../src/progress.mjs";
import { defaultBinDir, installShims, pathStatus } from "../src/shims.mjs";
import { tailnetPeers } from "../src/tailnet.mjs";

const DIST_PORT = Number(process.env.FARM_DIST_PORT ?? 4321);
const KIT_DIR = process.env.FARM_KIT_DIR ?? join(homedir(), ".refarm", "kit", "farm-client");
const ARGV = process.argv.slice(2);

async function fetchWith(url, kind, timeoutMs, headers) {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		const res = await fetch(url, { signal: controller.signal, headers: headers ?? {} });
		// 304 is not an error and not a body — it is the server agreeing that what the device
		// already holds is current. Surfaced as its own shape so the caller never parses it.
		if (res.status === 304) return { notModified: true };
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const body = kind === "bytes" ? Buffer.from(await res.arrayBuffer()) : await res.text();
		return { notModified: false, body, etag: res.headers.get("etag") };
	} finally {
		clearTimeout(timer);
	}
}

/** The bytes of a fetch that was NOT conditional — every caller but the manifest. */
async function fetchBody(url, kind, timeoutMs) {
	const result = await fetchWith(url, kind, timeoutMs);
	// Unreachable without an `if-none-match` request header, and a fail-loud guard is better
	// than silently returning `undefined` into an integrity check.
	if (result.notModified) throw new Error("unexpected 304 for an unconditional request");
	return result.body;
}

/**
 * Where the device remembers the manifest's validator. A sibling of `manifest.json` inside the
 * kit dir, so the two facts the conditional fetch depends on live and die together — deleting
 * the kit forgets the ETag, which is exactly right.
 *
 * Zero-dependency, like everything else here: a file with a string in it. That constraint is
 * load-bearing — it is what lets this kit run on a phone with nothing installed but Node.
 */
function etagPath() {
	return join(KIT_DIR, ".manifest-etag");
}

async function readRememberedETag() {
	try {
		const raw = (await readFile(etagPath(), "utf8")).trim();
		return isUsableETag(raw) ? raw : null;
	} catch {
		return null;
	}
}

/**
 * Guarda o validador — SEMPRE depois de o manifesto local estar no lugar, nunca no momento da
 * busca. A ordem é a correção: um ETag guardado antes de uma atualização que aborta descreveria
 * um manifesto que o aparelho não tem, e a próxima execução leria 304 e um manifesto velho como
 * se estivesse em dia.
 */
async function rememberETag(etag) {
	if (!isUsableETag(etag)) {
		// Uma fazenda sem ETag (mais antiga) não pode deixar para trás um validador velho, que
		// seria oferecido contra conteúdo que ela já não descreve.
		await rm(etagPath(), { force: true });
		return;
	}
	try {
		await mkdir(KIT_DIR, { recursive: true });
		await writeFile(etagPath(), etag);
	} catch {
		// Best-effort: falhar aqui custa uma busca inteira de manifesto na próxima vez, nada mais.
	}
}

async function distReachable(host) {
	try {
		await fetchBody(`http://${host}:${DIST_PORT}/manifest.json`, "text", 3000);
		return true;
	} catch {
		return false;
	}
}

/** A escada mora em `resolveFarmHost` (src/ask-host.mjs) — aqui só se injeta o
 *  I/O. O último degrau PERGUNTA o nome quando nada respondeu e o kit não
 *  conhece nenhum; `announce` para o spinner antes, senão a pergunta apareceria
 *  por cima da animação. */
function resolveHost(spinner) {
	return resolveFarmHost({
		kitRootDir: KIT_DIR,
		explicit: process.env.FARM_HOST,
		probe: distReachable,
		peers: async () => (await tailnetPeers()).map((peer) => peer.ip),
		announce: (line) => {
			spinner.stop();
			process.stderr.write(`${line}\n`);
		},
	});
}

function fmtBytes(n) {
	if (n < 1024) return `${n} B`;
	if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
	return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * (Re)planta os lançadores e resolve o PATH. Roda em toda atualização — é assim
 * que um kit instalado antes dos atalhos ganha `farm-ask` sem precisar de um novo
 * cold-bootstrap. Best-effort: falhar aqui não invalida a atualização, o kit
 * continua chamável pelo caminho completo.
 *
 * Com terminal e sem decisão anterior, PROPÕE a alteração exata do perfil e
 * registra a resposta (`--revisit-path` reabre a questão de propósito). Sem
 * terminal, ou com uma decisão já tomada, ninguém é perguntado.
 */
async function refreshShims({ revisit = false } = {}) {
	const binDir = defaultBinDir();
	const result = await installShims({ kitDir: KIT_DIR, binDir });
	if (result.created.length === 0) {
		console.log(`  (não consegui plantar atalhos em ${binDir} — use o caminho completo do kit)`);
		return;
	}
	const outcome = await ensurePathOperation({
		binDir,
		kitDir: KIT_DIR,
		status: pathStatus({ binDir }),
		home: homedir(),
		revisit,
	});
	for (const line of outcome.lines) console.log(line);
}

// Dois caminhos DELIBERADOS, que não precisam de rede nem de atualização: rever a
// decisão de PATH, e desfazer o que foi autorizado. Um comando digitado é
// exatamente a diferença entre o operador rever e o assistente re-perguntar.
if (ARGV.includes("--undo-path")) {
	const outcome = await undoPathOperation({ binDir: defaultBinDir(), home: homedir() });
	for (const line of outcome.lines) console.log(line);
	process.exit(outcome.status === "undone" ? 0 : 1);
}
if (ARGV.includes("--revisit-path")) {
	await refreshShims({ revisit: true });
	process.exit(0);
}

async function readLocalManifest() {
	try {
		return await readFile(join(KIT_DIR, "manifest.json"), "utf8");
	} catch {
		return null;
	}
}

const spinner = createSpinner().start("procurando a fazenda…");
let host;
try {
	({ host } = await resolveHost(spinner));
} catch (err) {
	spinner.stop();
	const code = cancellationExit(err);
	if (code !== null) process.exit(code);
	throw err;
}
const base = `http://${host}:${DIST_PORT}`;

// A fetch condicional do manifesto: o kit oferece o ETag que guardou e o servidor
// responde 304 quando nada mudou — a única busca deste fluxo que pagava o preço
// inteiro toda vez, em todo dispositivo. Só é condicional quando o manifesto local
// EXISTE: um 304 sem manifesto ao lado seria "atualizado" sem nada instalado.
const localRaw = await readLocalManifest();
const rememberedETag = await readRememberedETag();
let remoteRaw;
let fetchedETag = null;
let notModified = false;
try {
	spinner.setLabel(`buscando manifesto de ${host}…`);
	const fetched = await fetchWith(
		`${base}/manifest.json`,
		"text",
		8000,
		conditionalManifestHeaders(rememberedETag, localRaw != null),
	);
	if (fetched.notModified) {
		// Inalterado: nem sequer se reanalisa o documento — reusa-se o local, que o ETag
		// acabou de provar ser exatamente o que a fazenda serve.
		notModified = true;
		remoteRaw = localRaw;
	} else {
		remoteRaw = fetched.body;
		fetchedETag = fetched.etag;
	}
} catch (err) {
	spinner.stop();
	console.error(`❌ manifesto inalcançável em ${base}/manifest.json: ${err.message}`);
	console.error(
		`   No PC: refarm dist publish && refarm web serve .refarm/dist/farm-client --port ${DIST_PORT}`,
	);
	// Mesma pré-condição do install.mjs: um bind fora do loopback vem da DECLARAÇÃO,
	// não de um flag — `surfaces.web` em .refarm/config.json é o teto.
	console.error(
		'   (o web serve só sai do loopback se .refarm/config.json declarar: "surfaces": { "web": { "expose": "tailnet", "gate": "none" } })',
	);
	process.exit(1);
}

let plan;
try {
	plan = planUpdate(remoteRaw, localRaw);
} catch (err) {
	spinner.stop();
	console.error(`❌ manifesto inválido: ${err.message}`);
	process.exit(1);
}

spinner.stop();
console.log(`\n🌱 farm-update ← ${host}  [${plan.name} ${plan.fromVersion ?? "(nenhum)"} → ${plan.toVersion}]\n`);
if (notModified) console.log("  (manifesto inalterado — 304, nem baixado nem reanalisado)");
if (plan.upToDate) {
	if (!notModified) {
		// Veio inteiro e confere: este é o manifesto vigente, então persiste-se junto do
		// validador que o descreve — os dois nascem e morrem juntos.
		await mkdir(KIT_DIR, { recursive: true });
		await writeFile(join(KIT_DIR, "manifest.json"), remoteRaw);
		await rememberETag(fetchedETag);
	}
	await writeRememberedHost(KIT_DIR, host);
	console.log("✔ já atualizado");
	await refreshShims();
	console.log("");
	process.exit(0);
}

// Download + verify into a staging dir first; only swap once ALL files pass, so
// a failure mid-update never leaves the kit half-written or advertising a
// version it doesn't have.
const staging = join(KIT_DIR, ".staging");
await rm(staging, { recursive: true, force: true });
spinner.start(`baixando ${plan.name}…`);
let downloaded = 0;
try {
	for (const file of plan.toDownload) {
		spinner.setLabel(`baixando ${file.path} (${++downloaded}/${plan.toDownload.length})`);
		const bytes = await fetchBody(`${base}/${file.path}`, "bytes", 30000);
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
	// Só AGORA o validador vale: ele descreve exatamente o manifesto que acabou de entrar.
	await rememberETag(fetchedETag);
} catch (err) {
	spinner.stop();
	console.error(`❌ atualização abortada: ${err.message}`);
	await rm(staging, { recursive: true, force: true });
	process.exit(1);
}
spinner.stop();
await rm(staging, { recursive: true, force: true });
// The kit remembers the farm it came from, so farm-ask needs no host next time.
await writeRememberedHost(KIT_DIR, host);

console.log(
	`↻ ${plan.name} ${plan.fromVersion ?? "(nenhum)"} → ${plan.toVersion} · ${plan.toDownload.length} arquivo(s) · ${fmtBytes(plan.totalBytes)}`,
);
console.log(`  kit em ${KIT_DIR} (fazenda lembrada: ${host})`);
await refreshShims();
console.log("");
