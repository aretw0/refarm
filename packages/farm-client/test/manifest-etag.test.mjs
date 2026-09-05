/**
 * O primeiro corte do orçamento de trânsito declarado
 * (docs/superpowers/specs/2026-07-30-declared-traffic-budget-design.md): `manifest.json`
 * servido com `ETag` e `farm-update` mandando `If-None-Match`.
 *
 * A camada de PAYLOAD já era ótima — `planUpdate` baixa só o que mudou e verifica sha256 por
 * arquivo, que é endereçamento por conteúdo e ganha de ETag para um CONJUNTO de arquivos. O que
 * não tinha política nenhuma era a busca de CONTROLE: o manifesto, buscado inteiro em toda
 * execução, em todo aparelho, para sempre.
 *
 * Aqui os dois caminhos são exercidos DE PONTA A PONTA, contra um servidor que se comporta como
 * o `refarm web serve` (ETag forte derivado dos bytes, 304 para um validador que confere):
 *   - 200 na primeira execução (o aparelho não tem nada), e o ETag fica guardado;
 *   - 304 na segunda, com o manifesto local intacto e sem reanálise.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
	conditionalManifestHeaders,
	integrityOf,
	isUsableETag,
} from "../src/manifest.mjs";

const UPDATER = fileURLToPath(new URL("../bin/farm-update.mjs", import.meta.url));

test("conditionalManifestHeaders só é condicional quando HÁ manifesto local", () => {
	// A condição de CORREÇÃO, não de educação: um 304 sem manifesto ao lado diria
	// "atualizado" para um aparelho que não tem nada.
	assert.deepEqual(conditionalManifestHeaders('"abc"', true), { "if-none-match": '"abc"' });
	assert.deepEqual(conditionalManifestHeaders('"abc"', false), {});
	assert.deepEqual(conditionalManifestHeaders(null, true), {});
	assert.deepEqual(conditionalManifestHeaders(undefined, true), {});
	assert.deepEqual(conditionalManifestHeaders("", true), {});
});

test("isUsableETag aceita um validador opaco e recusa lixo", () => {
	assert.equal(isUsableETag('"abc"'), true);
	assert.equal(isUsableETag("W/\"abc\""), true);
	assert.equal(isUsableETag(""), false);
	assert.equal(isUsableETag(null), false);
	assert.equal(isUsableETag(42), false);
	assert.equal(isUsableETag("x".repeat(257)), false);
});

/** Um servidor que se comporta como o `refarm web serve` deste corte. */
function startFarm(files) {
	const manifestBody = JSON.stringify({
		name: "farm-client",
		version: "1.0.0",
		platform: null,
		createdAt: "2026-07-30T00:00:00.000Z",
		files: Object.entries(files).map(([path, content]) => ({
			path,
			integrity: integrityOf(content),
			bytes: Buffer.byteLength(content),
		})),
	});
	const etag = `"${createHash("sha256").update(manifestBody).digest("hex")}"`;
	const seen = [];
	const server = createServer((req, res) => {
		if (req.url === "/manifest.json") {
			seen.push(req.headers["if-none-match"] ?? null);
			res.setHeader("ETag", etag);
			if (req.headers["if-none-match"] === etag) {
				res.statusCode = 304;
				return res.end();
			}
			res.statusCode = 200;
			res.setHeader("Content-Type", "application/json");
			return res.end(manifestBody);
		}
		const body = files[req.url?.replace(/^\//, "") ?? ""];
		if (body === undefined) {
			res.statusCode = 404;
			return res.end();
		}
		res.statusCode = 200;
		res.end(body);
	});
	return { server, manifestBody, etag, seen };
}

/** ASSÍNCRONO de propósito: o servidor-fazenda vive NESTE processo, então um
 *  `spawnSync` travaria o laço de eventos e o manifesto nunca seria respondido. */
function runUpdater(kitDir, binDir, port) {
	const child = spawn(process.execPath, [UPDATER], {
		env: {
			...process.env,
			FARM_HOST: "127.0.0.1",
			FARM_DIST_PORT: String(port),
			FARM_KIT_DIR: kitDir,
			FARM_BIN_DIR: binDir,
		},
	});
	let stdout = "";
	let stderr = "";
	child.stdout.setEncoding("utf8");
	child.stderr.setEncoding("utf8");
	child.stdout.on("data", (chunk) => (stdout += chunk));
	child.stderr.on("data", (chunk) => (stderr += chunk));
	return new Promise((resolve) => {
		child.on("close", (status) => resolve({ status, stdout, stderr }));
	});
}

test("farm-update: 200 na primeira execução, 304 na segunda — ponta a ponta", async (t) => {
	const work = mkdtempSync(join(tmpdir(), "farm-update-etag-"));
	const kitDir = join(work, "kit");
	const binDir = join(work, "bin");
	const farm = startFarm({ "src/hello.mjs": "export const hello = 1;\n" });
	await new Promise((resolve) => farm.server.listen(0, "127.0.0.1", resolve));
	const port = farm.server.address().port;
	t.after(async () => {
		await new Promise((resolve) => farm.server.close(resolve));
		rmSync(work, { recursive: true, force: true });
	});

	// 1ª execução: nada instalado ⇒ nem pode ser condicional (não há manifesto local).
	const first = await runUpdater(kitDir, binDir, port);
	assert.equal(first.status, 0, first.stderr);
	assert.equal(readFileSync(join(kitDir, "manifest.json"), "utf8"), farm.manifestBody);
	assert.equal(readFileSync(join(kitDir, "src", "hello.mjs"), "utf8"), "export const hello = 1;\n");
	// O validador ficou guardado — é o que torna a PRÓXIMA busca barata.
	assert.equal(readFileSync(join(kitDir, ".manifest-etag"), "utf8"), farm.etag);

	// 2ª execução: agora HÁ manifesto local e ETag ⇒ condicional ⇒ 304.
	const second = await runUpdater(kitDir, binDir, port);
	assert.equal(second.status, 0, second.stderr);
	assert.match(second.stdout, /304/);
	assert.match(second.stdout, /já atualizado/);
	// O manifesto local sobreviveu intacto: um 304 não é um corpo.
	assert.equal(readFileSync(join(kitDir, "manifest.json"), "utf8"), farm.manifestBody);

	// E o servidor viu exatamente isto: a 1ª busca sem condição, a 2ª com o validador.
	assert.deepEqual(farm.seen.filter((v) => v !== undefined), [null, farm.etag]);
});

test("farm-update: um ETag guardado SEM manifesto local nunca vira '304 = atualizado'", async (t) => {
	const work = mkdtempSync(join(tmpdir(), "farm-update-etag-orphan-"));
	const kitDir = join(work, "kit");
	const binDir = join(work, "bin");
	const farm = startFarm({ "src/hello.mjs": "export const hello = 1;\n" });
	await new Promise((resolve) => farm.server.listen(0, "127.0.0.1", resolve));
	const port = farm.server.address().port;
	t.after(async () => {
		await new Promise((resolve) => farm.server.close(resolve));
		rmSync(work, { recursive: true, force: true });
	});

	// O estado perigoso: o kit lembra o validador mas perdeu o manifesto.
	const { mkdirSync } = await import("node:fs");
	mkdirSync(kitDir, { recursive: true });
	writeFileSync(join(kitDir, ".manifest-etag"), farm.etag);

	const run = await runUpdater(kitDir, binDir, port);
	assert.equal(run.status, 0, run.stderr);
	// Buscou o manifesto INTEIRO (sem condição) e instalou de verdade.
	assert.deepEqual(farm.seen, [null]);
	assert.equal(readFileSync(join(kitDir, "manifest.json"), "utf8"), farm.manifestBody);
	assert.equal(readFileSync(join(kitDir, "src", "hello.mjs"), "utf8"), "export const hello = 1;\n");
});

test("farm-update: uma fazenda SEM ETag não deixa validador velho para trás", async (t) => {
	const work = mkdtempSync(join(tmpdir(), "farm-update-etag-absent-"));
	const kitDir = join(work, "kit");
	const binDir = join(work, "bin");
	const files = { "src/hello.mjs": "export const hello = 2;\n" };
	const manifestBody = JSON.stringify({
		name: "farm-client",
		version: "2.0.0",
		platform: null,
		createdAt: "2026-07-30T00:00:00.000Z",
		files: Object.entries(files).map(([path, content]) => ({
			path,
			integrity: integrityOf(content),
			bytes: Buffer.byteLength(content),
		})),
	});
	// Uma fazenda mais antiga: serve o manifesto, sem cabeçalho nenhum de cache.
	const server = createServer((req, res) => {
		if (req.url === "/manifest.json") {
			res.statusCode = 200;
			return res.end(manifestBody);
		}
		const body = files[req.url?.replace(/^\//, "") ?? ""];
		if (body === undefined) {
			res.statusCode = 404;
			return res.end();
		}
		res.end(body);
	});
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	const port = server.address().port;
	t.after(async () => {
		await new Promise((resolve) => server.close(resolve));
		rmSync(work, { recursive: true, force: true });
	});

	const { mkdirSync, existsSync } = await import("node:fs");
	mkdirSync(kitDir, { recursive: true });
	writeFileSync(join(kitDir, ".manifest-etag"), '"stale-validator"');

	const run = await runUpdater(kitDir, binDir, port);
	assert.equal(run.status, 0, run.stderr);
	// Um validador que descreve conteúdo que o servidor já não anuncia é pior que nenhum.
	assert.equal(existsSync(join(kitDir, ".manifest-etag")), false);
});

test("farm-update: HTTP 404 prova alcance e nomeia o manifesto ausente", async (t) => {
	const work = mkdtempSync(join(tmpdir(), "farm-update-missing-manifest-"));
	const server = createServer((_req, res) => {
		res.statusCode = 404;
		res.end();
	});
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	const port = server.address().port;
	t.after(async () => {
		await new Promise((resolve) => server.close(resolve));
		rmSync(work, { recursive: true, force: true });
	});

	const result = await runUpdater(join(work, "kit"), join(work, "bin"), port);
	assert.equal(result.status, 1);
	assert.match(result.stderr, /manifesto ausente/);
	assert.match(result.stderr, /servidor respondeu HTTP 404/);
	assert.match(result.stderr, /A rede, o nome do host e o web-serve responderam/);
	assert.doesNotMatch(result.stderr, /manifesto inalcançável/);
});
