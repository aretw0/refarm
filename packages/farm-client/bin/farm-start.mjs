#!/usr/bin/env node
/**
 * farm-start — começar, do bolso, um trabalho que roda no computador.
 *
 * O kit já sabia ATENDER (`farm-attend`): as perguntas que a fazenda deixou
 * penduradas chegam no celular e são respondidas de lá. Faltava a outra metade —
 * não havia como FAZER uma aparecer. Para configurar o Telegram naquele
 * computador o operador ainda precisava ir até ele.
 *
 *   "Quero me poupar ao máximo de ter que estar no computador para qualquer coisa."
 *
 * Uso:
 *   farm-start                    # o que este nó deixa você começar
 *   farm-start "delivery add"     # começa uma; as perguntas caem no farm-attend
 *
 * O que este comando NÃO faz, de propósito:
 *   - **não mostra a saída do comando.** A interface de um assistente são as
 *     PERGUNTAS dele, e elas já viajam. Trazer o resto seria contrabandear um
 *     terminal para dentro deste desenho.
 *   - **não sabe o que pode ser começado.** Ele PERGUNTA ao nó. A tabela vive
 *     num lugar só, no nó, e o silêncio dela é fechado.
 *
 * Zero dependência (Node ≥22: fetch global), como o resto do kit.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { cancellationExit, resolveFarmHost } from "../src/ask-host.mjs";
import { farmAuthHeaders } from "../src/auth.mjs";
import { sidecarExposureLines } from "../src/reach.mjs";
import {
	catalogLines,
	classifyOperationStatus,
	classifyCancelResponse,
	classifyStartResponse,
	OPERATIONS_PATH,
	operationStatusPath,
	operationCancelPath,
	parseOperationCatalog,
	parseStartArgs,
	startRequestBody,
} from "../src/remote-initiation.mjs";
import { tailnetPeers } from "../src/tailnet.mjs";

const KIT_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const HTTP_PORT = Number(process.env.FARM_HTTP_PORT ?? 42001);

// Tudo que não é opção é o identificador da operação — INTEIRO, com espaços e
// tudo. `farm-start "delivery add"` manda `delivery add`, uma string, um campo.
// Nada aqui monta uma linha de comando, e o nó também não: ele passa esses bytes
// como UM argumento para um ponto de entrada fixo.
const {
	operation: OPERATION,
	statusRequested: STATUS_REQUESTED,
	statusRunId: STATUS_RUN_ID,
	cancelRequested: CANCEL_REQUESTED,
	cancelRunId: CANCEL_RUN_ID,
} = parseStartArgs(process.argv.slice(2));

/** O sidecar responde? Mesmo probe do farm-attend — um kit, um jeito de alcançar. */
async function sidecarUp(host) {
	try {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), 3000);
		const res = await fetch(`http://${host}:${HTTP_PORT}/plugins`, {
			signal: controller.signal,
			headers: farmAuthHeaders(),
		});
		clearTimeout(timer);
		return res.ok;
	} catch {
		return false;
	}
}

let host;
try {
	({ host } = await resolveFarmHost({
		kitRootDir: KIT_ROOT,
		explicit: process.env.FARM_HOST,
		probe: sidecarUp,
		peers: async () => (await tailnetPeers()).map((peer) => peer.ip),
	}));
} catch (err) {
	const code = cancellationExit(err);
	if (code !== null) process.exit(code);
	throw err;
}

const base = `http://${host}:${HTTP_PORT}`;

if (!(await sidecarUp(host))) {
	console.error(`❌ sidecar inalcançável em ${base}`);
	for (const line of sidecarExposureLines()) console.error(line);
	console.error(`   Alcance primeiro com: node ${join(KIT_ROOT, "bin", "farm-hello.mjs")} ${host}`);
	process.exit(1);
}

if (CANCEL_REQUESTED) {
	if (CANCEL_RUN_ID === null) {
		console.error("❌ --cancel precisa do run id mostrado por farm-start.");
		process.exit(1);
	}
	let res;
	try {
		res = await fetch(`${base}${operationCancelPath(CANCEL_RUN_ID)}`, {
			method: "POST",
			headers: farmAuthHeaders(),
		});
	} catch (err) {
		console.error(`❌ não deu para abandonar a execução: ${err?.message ?? err}`);
		process.exit(1);
	}
	const verdict = classifyCancelResponse(res.status, await readJson(res));
	const out = verdict.exitCode === 0 ? console.log : console.error;
	for (const line of verdict.lines) out(line);
	process.exit(verdict.exitCode);
}

/** Corpo JSON, ou `{}` quando não veio nenhum — o status ainda diz o desfecho. */
async function readJson(res) {
	try {
		return await res.json();
	} catch {
		return {};
	}
}

if (STATUS_REQUESTED) {
	if (STATUS_RUN_ID === null) {
		console.error("❌ --status precisa do id mostrado por farm-start.");
		process.exit(1);
	}
	let res;
	try {
		res = await fetch(`${base}${operationStatusPath(STATUS_RUN_ID)}`, {
			headers: farmAuthHeaders(),
		});
	} catch (err) {
		console.error(`❌ não deu para consultar a execução: ${err?.message ?? err}`);
		process.exit(1);
	}
	const verdict = classifyOperationStatus(res.status, await readJson(res));
	const out = verdict.exitCode === 0 ? console.log : console.error;
	for (const line of verdict.lines) out(line);
	process.exit(verdict.exitCode);
}

if (OPERATION === null) {
	// Sem argumento: PERGUNTA ao nó o que ele oferece. Nunca recita de memória.
	let res;
	try {
		res = await fetch(`${base}${OPERATIONS_PATH}`, { headers: farmAuthHeaders() });
	} catch (err) {
		console.error(`❌ não deu para perguntar ao nó: ${err?.message ?? err}`);
		process.exit(1);
	}
	if (res.status === 404) {
		console.error(
			`❌ este nó ainda não deixa começar nada de um aparelho (${base}${OPERATIONS_PATH}).`,
		);
		console.error("   Atualize o nó, ou comece no terminal dele.");
		process.exit(1);
	}
	const body = await readJson(res);
	if (!res.ok) {
		for (const line of classifyStartResponse(res.status, body).lines) console.error(line);
		process.exit(1);
	}
	const operations = parseOperationCatalog(body);
	if (operations === null) {
		console.error("❌ o nó respondeu, e não com um catálogo que este kit reconheça.");
		process.exit(1);
	}
	for (const line of catalogLines(operations)) console.log(line);
	process.exit(0);
}

let res;
try {
	res = await fetch(`${base}${OPERATIONS_PATH}`, {
		method: "POST",
		headers: { "content-type": "application/json", ...farmAuthHeaders() },
		body: JSON.stringify(startRequestBody(OPERATION)),
	});
} catch (err) {
	console.error(`❌ não deu para falar com o nó: ${err?.message ?? err}`);
	process.exit(1);
}

const body = await readJson(res);
const verdict = classifyStartResponse(res.status, body);
const out = verdict.outcome === "started" ? console.log : console.error;
for (const line of verdict.lines) out(line);
process.exit(verdict.exitCode);
