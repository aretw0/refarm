#!/usr/bin/env node
/**
 * farm-attend — atender, do bolso, as perguntas que a fazenda deixou pendentes.
 *
 * Todo assistente do refarm pergunta pelo mesmo contrato (`OperatorChannel`).
 * Desde que o nó ganhou um canal remoto, TODA pergunta já escrita — e toda que
 * ainda vai ser escrita — pode ser respondida daqui, sem que nenhum assistente
 * mude uma linha.
 *
 * Uso:
 *   farm-attend                 # atende o que estiver pendente e sai
 *   farm-attend --watch         # fica de plantão, com backoff honesto
 *   farm-attend --list          # só mostra o que está pendente; não responde
 *
 * O prompt é desenhado pelo BLOCO carregado em `vendor/prompt-contract-v1.mjs`
 * — o mesmo arquivo, byte a byte, que o nó usa no terminal. É por isso que a
 * pergunta no celular tem a mesma cara e cancela do mesmo jeito que a do
 * terminal: não é uma segunda implementação, é a mesma.
 *
 * Zero dependência (Node ≥22: fetch global), como o resto do kit.
 *
 * DUAS COISAS QUE ESTE COMANDO NÃO FAZ:
 *   - **não guarda nada.** Uma pergunta vive enquanto quem perguntou viver; se o
 *     comando do outro lado morreu, a pergunta some — e isso está certo, porque
 *     não há mais ninguém esperando a resposta.
 *   - **não escreve a resposta em lugar nenhum.** Nem em log, nem em eco, nem na
 *     linha de desfecho. Uma pergunta de segredo avisa que a resposta atravessa
 *     a rede ANTES de o operador digitar; depois disso o valor vai para quem
 *     perguntou e para mais ninguém.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
	createStdioOperatorChannel,
	parsePendingPromptList,
} from "../vendor/prompt-contract-v1.mjs";
import { cancellationExit, isOperatorCancellation, resolveFarmHost } from "../src/ask-host.mjs";
import { farmAuthHeaders } from "../src/auth.mjs";
import {
	answerOutcomeLine,
	answerPath,
	classifyAnswerResponse,
	declaredPollIntervalMs,
	describeDevice,
	idleLine,
	isExpired,
	nextPollDelayMs,
	promptHeaderLines,
	PROMPTS_PATH,
} from "../src/pending-prompt.mjs";
import { sidecarExposureLines } from "../src/reach.mjs";
import { tailnetPeers } from "../src/tailnet.mjs";

const KIT_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const HTTP_PORT = Number(process.env.FARM_HTTP_PORT ?? 42001);

const args = new Set(process.argv.slice(2));
const WATCH = args.has("--watch") || args.has("-w");
const LIST_ONLY = args.has("--list") || args.has("-l");

/** O sidecar responde? Mesmo probe do farm-ask — um kit, um jeito de alcançar. */
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

/** O que está pendente agora. `null` quando a consulta falhou — diferente de
 *  "nada pendente", e tratado diferente: um erro de rede não é uma fazenda calma. */
async function fetchPending() {
	try {
		const res = await fetch(`${base}${PROMPTS_PATH}`, { headers: farmAuthHeaders() });
		if (res.status === 404) {
			// Um nó mais antigo que este comando. Dizer isso é melhor do que ficar
			// perguntando para sempre a um lugar que nunca vai responder.
			console.error(`❌ este nó ainda não publica perguntas pendentes (${base}${PROMPTS_PATH}).`);
			console.error("   Atualize o nó, ou responda no terminal que perguntou.");
			process.exit(1);
		}
		if (!res.ok) return { prompts: null, pollIntervalMs: null, status: res.status };
		const body = await res.json();
		return {
			prompts: parsePendingPromptList(body),
			pollIntervalMs: declaredPollIntervalMs(body),
			status: 200,
		};
	} catch {
		return { prompts: null, pollIntervalMs: null, status: 0 };
	}
}

/** Manda UMA resposta. O valor só existe nesta chamada: entra no corpo e sai da
 *  memória do comando. Quem responde é dito pelo CRACHÁ, não por este corpo — o
 *  nó registra o aparelho que o portão autenticou, e não o que o cliente afirma. */
async function submitAnswer(promptId, value) {
	try {
		const res = await fetch(`${base}${answerPath(promptId)}`, {
			method: "POST",
			headers: { "content-type": "application/json", ...farmAuthHeaders() },
			body: JSON.stringify({ value }),
		});
		let body = {};
		try {
			body = await res.json();
		} catch {
			// Corpo vazio ou não-JSON: o status ainda diz o desfecho.
		}
		return classifyAnswerResponse(res.status, body);
	} catch (err) {
		return { outcome: "error", status: 0, detail: err?.message };
	}
}

/**
 * Atende UMA pergunta: desenha o cabeçalho (incluindo o aviso do P4), pergunta
 * com o bloco e envia. Devolve `true` quando esta resposta foi a que valeu.
 *
 * Um Ctrl+C aqui é do OPERADOR desistindo desta pergunta, não um crash: sobe
 * como cancelação e quem chama sai limpo.
 */
async function attendOne(pending, index, total) {
	for (const line of promptHeaderLines(pending, { index, total })) console.log(line);

	const channel = createStdioOperatorChannel();
	const value = await channel.ask(pending.prompt);

	const result = await submitAnswer(pending.id, value);
	console.log(`  ${answerOutcomeLine(result)}`);
	if (result.outcome === "answered" && result.device) {
		console.log(`  \x1b[2mregistrado como ${describeDevice(result.device)}\x1b[0m`);
	}
	return result.outcome === "answered";
}

/** Só mostra. Útil para decidir se vale a pena parar o que se está fazendo. */
function printList(prompts) {
	if (prompts.length === 0) {
		console.log("nada pendente.");
		return;
	}
	console.log(`${prompts.length} pergunta(s) pendente(s):`);
	for (const [index, pending] of prompts.entries()) {
		for (const line of promptHeaderLines(pending, { index, total: prompts.length })) {
			console.log(line);
		}
		console.log(`  ${pending.prompt.question}`);
	}
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let emptyRounds = 0;
let saidIdle = false;

try {
	for (;;) {
		const { prompts, pollIntervalMs, status } = await fetchPending();

		if (prompts === null) {
			// A fazenda não respondeu. Em `--watch` isso é motivo para esperar mais,
			// não para desistir nem para insistir mais forte.
			if (!WATCH) {
				console.error(`❌ não consegui listar as perguntas (HTTP ${status || "sem resposta"}).`);
				process.exit(1);
			}
			emptyRounds += 1;
			await sleep(nextPollDelayMs(emptyRounds));
			continue;
		}

		// Uma pergunta cujo prazo já passou não é para ser respondida: quem
		// perguntou já desistiu dela, e responder seria escrever no vazio.
		const live = prompts.filter((pending) => !isExpired(pending));

		if (LIST_ONLY) {
			printList(live);
			process.exit(0);
		}

		if (live.length === 0) {
			if (!WATCH) {
				console.log("nada pendente.");
				process.exit(0);
			}
			emptyRounds += 1;
			if (!saidIdle) {
				console.log(idleLine(nextPollDelayMs(emptyRounds, { base: pollIntervalMs })));
				saidIdle = true;
			}
			await sleep(nextPollDelayMs(emptyRounds, { base: pollIntervalMs }));
			continue;
		}

		emptyRounds = 0;
		saidIdle = false;
		for (const [index, pending] of live.entries()) {
			await attendOne(pending, index, live.length);
		}

		if (!WATCH) process.exit(0);
	}
} catch (err) {
	const code = cancellationExit(err);
	if (code !== null) process.exit(code);
	if (isOperatorCancellation(err)) process.exit(130);
	console.error(`❌ ${err?.message ?? err}`);
	process.exit(1);
}
