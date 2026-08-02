/**
 * remote-initiation — COMEÇAR, do bolso, um trabalho que roda no nó.
 *
 * O kit já sabia ATENDER: `farm-attend` lê as perguntas penduradas no nó e as
 * responde. Faltava a outra metade — não havia como FAZER uma aparecer. Para
 * configurar o Telegram naquele computador o operador ainda tinha que ir até ele
 * e digitar `refarm delivery add`. Este módulo é o lado do aparelho da rota que
 * fecha esse ciclo (R4 do desenho de onboarding componível).
 *
 * ── O que o nó abre, e o que ele não abre ────────────────────────────────────
 * O aparelho manda um IDENTIFICADOR e nada mais. Não manda argv, não manda
 * opção, não manda nome de canal: quem decide o que aquele identificador começa
 * é uma tabela que vive no nó, em TypeScript, e cujo silêncio é fechado — uma
 * operação que não se declarou iniciável remotamente NÃO pode ser começada
 * daqui, inclusive uma acrescentada amanhã. Este módulo não tem cópia dessa
 * tabela e não deve ganhar uma: duas respostas para a mesma pergunta de
 * segurança divergem, e divergem calado.
 *
 * Por isso `farm-start` sem argumento PERGUNTA ao nó o que ele oferece, em vez
 * de recitar uma lista de memória. A lista é sempre a do nó com quem se está
 * falando.
 *
 * ── Autoridade estreita, não terminal remoto ─────────────────────────────────
 * `GET /operations` exige `operation:read`; `POST /operations`, `operation:start`.
 * Uma credencial de aparelho carrega autoridade completa, enquanto uma superfície
 * verificada recebe somente os escopos que o operador confirmou. Um `401` significa
 * que a credencial está ausente, expirou ou não recebeu a autoridade desta rota.
 *
 * ── Cinco respostas, nunca uma ───────────────────────────────────────────────
 * O nó distingue, e o aparelho não pode colapsar de volta:
 *   - começou;
 *   - **não conheço essa operação** (o id não é comando nenhum lá);
 *   - **conheço e está fechada** (é comando de verdade, não se declarou);
 *   - **não consegui começar** (o nó não achou o `refarm` que ele mesmo declarou);
 *   - **já tem uma rodando** (o teto: uma operação por vez).
 *
 * Tudo aqui é PURO — sem rede, sem relógio, sem terminal. Quem faz I/O é
 * `bin/farm-start.mjs`. Zero dependência, como o resto do kit.
 */

/** A rota que lista o que pode ser começado, e que começa uma. */
export const OPERATIONS_PATH = "/operations";

/** O fio desta superfície. `REMOTE_INITIATION_WIRE` no nó é a outra metade. */
export const REMOTE_INITIATION_WIRE = "remote-initiation.v1";

/** A run id is one URL segment. Encoding is the client's whole contribution to the path. */
export function operationStatusPath(runId) {
	return `${OPERATIONS_PATH}/${encodeURIComponent(runId)}`;
}

export function operationCancelPath(runId) {
	return `${operationStatusPath(runId)}/cancel`;
}

export function parseOperationResult(value) {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	const keys = Object.keys(value).sort();
	if (keys.join("|") !== "findings|metrics|redactionCount|status|summary|truncated|wire") return null;
	if (value.wire !== "operation-result.v1" || !["succeeded", "issues", "failed"].includes(value.status)) return null;
	if (typeof value.summary !== "string" || value.summary.length > 512) return null;
	if (!Array.isArray(value.metrics) || value.metrics.length > 32) return null;
	if (!Array.isArray(value.findings) || value.findings.length > 50) return null;
	if (typeof value.truncated !== "boolean" || !Number.isInteger(value.redactionCount) || value.redactionCount < 0) return null;
	if (value.metrics.some((metric) => !metric || typeof metric !== "object" || typeof metric.name !== "string" || !Number.isFinite(metric.value))) return null;
	if (value.findings.some((finding) => !finding || typeof finding !== "object" || typeof finding.code !== "string" || typeof finding.summary !== "string")) return null;
	return value;
}

/** Lifecycle, without pretending that command output is part of this wire. */
export function classifyOperationStatus(status, body) {
	if (status === 200 && typeof body?.runId === "string") {
		const state = ["running", "succeeded", "failed", "cancelled"].includes(body?.state)
			? body.state
			: null;
		if (state !== null) {
			const operation = typeof body?.operation === "string" ? body.operation : "a operação";
			const symbols = { running: "⏳", succeeded: "✓", failed: "✗", cancelled: "■" };
			const labels = { running: "rodando", succeeded: "concluída", failed: "falhou", cancelled: "abandonada" };
			const suffix = Number.isInteger(body?.exitCode) ? ` (exit ${body.exitCode})` : "";
			const result = parseOperationResult(body?.result);
			const resultLines = result
				? [
					"",
					`   ${result.summary}`,
					...result.metrics.map((metric) => `   · ${metric.name}: ${metric.value}${metric.unit ? ` ${metric.unit}` : ""}`),
					...result.findings.map((finding) => `   ! ${finding.code}: ${finding.summary}${finding.location ? ` — ${finding.location}` : ""}`),
					...(result.truncated ? ["   … resultado truncado pelo contrato"] : []),
				]
				: [];
			return {
				outcome: state,
				exitCode: state === "failed" ? 1 : 0,
				lines: [
					`${symbols[state]} ${operation}: ${labels[state]}${suffix}`,
					`   run: ${body.runId}`,
					...resultLines,
					...(body?.resultError === "invalid-or-missing-operation-result"
						? ["   ✗ a operação prometeu operation-result.v1, mas não entregou um envelope válido"]
						: []),
				],
				result,
			};
		}
	}
	if (status === 404 || body?.error === "unknown-run") {
		return {
			outcome: "unknown-run",
			exitCode: 1,
			lines: ["❓ este nó não retém essa execução.", "   Ele guarda somente a atual/mais recente."],
		};
	}
	return {
		outcome: "could-not-read",
		exitCode: 1,
		lines: ["❌ não deu para consultar a execução.", `   O nó respondeu ${status}.`],
	};
}

export function classifyCancelResponse(status, body) {
	if (status === 202 && body?.state === "cancelling") {
		return {
			outcome: "cancelling",
			exitCode: 0,
			lines: [`■ abandonando ${body?.operation ?? "a operação"}…`, `   run: ${body?.runId ?? "?"}`],
		};
	}
	if (status === 404 || body?.error === "unknown-run") {
		return { outcome: "unknown-run", exitCode: 1, lines: ["❓ este nó não retém essa execução."] };
	}
	if (status === 409 || body?.error === "run-finished") {
		return { outcome: "run-finished", exitCode: 1, lines: ["✓ essa execução já terminou; nada foi abandonado."] };
	}
	if (status === 401 || status === 403) {
		return { outcome: "not-authorized", exitCode: 1, lines: ["🔒 esta credencial não pode abandonar operações neste nó."] };
	}
	return { outcome: "could-not-cancel", exitCode: 1, lines: [`❌ não deu para abandonar a execução (${status}).`] };
}

/**
 * O catálogo que o nó devolveu, ou `null` quando aquilo não é um catálogo.
 *
 * O nó relata o documento que o próprio `refarm auth remote --json` imprimiu,
 * inteiro, embaixo de `catalog` — ele não interpreta a tabela e este módulo
 * também não. Aqui só se pega a lista e se descartam entradas sem forma. PURO.
 */
export function parseOperationCatalog(body) {
	const operations = body?.catalog?.operations;
	if (!Array.isArray(operations)) return null;
	const parsed = [];
	for (const entry of operations) {
		const id = typeof entry?.id === "string" ? entry.id : null;
		if (!id) continue;
		parsed.push({
			id,
			command: typeof entry?.command === "string" ? entry.command : `refarm ${id}`,
			why: typeof entry?.why === "string" ? entry.why : "",
		});
	}
	return parsed;
}

/** As linhas do catálogo, para o operador ler numa tela pequena. PURO. */
export function catalogLines(operations, { start = "farm-start" } = {}) {
	if (operations.length === 0) {
		return [
			"Nenhuma operação deste nó pode ser começada de um aparelho.",
			"   Silêncio é fechado: o que não se declarou iniciável remotamente não começa daqui.",
		];
	}
	const lines = [`O que este nó deixa você começar (${operations.length}):`];
	for (const operation of operations) {
		lines.push("", `  • ${operation.id}`);
		lines.push(`      no computador seria:  ${operation.command}`);
		if (operation.why) lines.push(`      ${operation.why}`);
	}
	lines.push("", `Para começar:  ${start} "${operations[0].id}"`);
	return lines;
}

/**
 * O desfecho de um `POST /operations`, das CINCO maneiras que ele tem — nunca
 * de uma. PURO: recebe status e corpo, devolve `{ outcome, lines, exitCode }`.
 *
 * Nenhum ramo manda "tente de novo" sem dizer o que mudaria: um teto pede que se
 * termine o que já está rodando, um 401 pede a credencial de aparelho, e um
 * `could-not-start` repete o que o nó disse — que é onde está o conserto, porque
 * é o nó que sabe qual `spawnEnv.path` ele declarou.
 */
export function classifyStartResponse(
	status,
	body,
	{ attend = "farm-attend", start = "farm-start" } = {},
) {
	const detail = typeof body?.detail === "string" ? body.detail : "";
	if (status === 202 || body?.started === true) {
		const named = typeof body?.operation === "string" ? body.operation : "a operação";
		const runId = typeof body?.runId === "string" ? body.runId : null;
		return {
			outcome: "started",
			exitCode: 0,
			lines: [
				`▶ começou no nó: ${named}`,
				"",
				"   As perguntas dela chegam onde você já atende. Continue com:",
				`     ${attend} --watch`,
				...(runId ? ["", "   Para acompanhar o desfecho:", `     ${start} --status ${runId}`] : []),
				"",
				"   O stdout não viaja. Se a operação declarou resultado estruturado,",
				"   ele aparece no status; perguntas continuam chegando no attend.",
			],
		};
	}
	if (status === 401 || status === 403) {
		if (body?.error === "not-remotely-invocable") {
			return {
				outcome: "not-remotely-invocable",
				exitCode: 1,
				lines: [
					"✋ esse comando existe nesse nó, e não está aberto para aparelhos.",
					`   ${detail}`,
					"",
					"   Isso não é engano seu: é uma porta fechada de propósito. Abrir é um",
					"   commit no nó, que é justamente quando alguém pode perguntar por quê.",
				],
			};
		}
		return {
			outcome: "not-authorized",
			exitCode: 1,
			lines: [
				"🔒 esta credencial não pode começar operações neste nó.",
				"   Use uma credencial de aparelho em FARM_TOKEN ou autorize uma superfície",
				"   estreita com o escopo operation:start.",
			],
		};
	}
	if (status === 404) {
		return {
			outcome: "unknown-operation",
			exitCode: 1,
			lines: [
				"❓ esse nó não tem essa operação.",
				`   ${detail}`,
				"",
				"   Veja o que ele oferece com:  farm-start",
			],
		};
	}
	if (status === 409) {
		const running = typeof body?.running === "string" ? body.running : null;
		const runId = typeof body?.runId === "string" ? body.runId : null;
		return {
			outcome: "already-running",
			exitCode: 1,
			lines: [
				running
					? `⏳ já tem uma rodando neste nó: ${running}`
					: "⏳ já tem uma operação rodando neste nó.",
				"   É uma por vez, de propósito: duas fazem perguntas na MESMA lista e",
				"   ninguém consegue dizer qual pergunta é de qual.",
				"",
				"   Termine a que está aberta (farm-attend) e volte.",
				...(runId ? ["   Ou abandone explicitamente:", `     ${start} --cancel ${runId}`] : []),
			],
		};
	}
	return {
		outcome: "could-not-start",
		exitCode: 1,
		lines: [
			"❌ o nó não conseguiu começar.",
			detail ? `   ${detail}` : `   O nó respondeu ${status}.`,
		],
	};
}

/** O corpo do pedido — UM campo, e o identificador vai inteiro. PURO. */
export function startRequestBody(operation) {
	return { operation };
}

/**
 * A linha de comando do `farm-start`, lida como dado. PURO.
 *
 * Tudo que não é opção é o identificador da operação, INTEIRO. As opções
 * `--status`/`--cancel` consomem o próprio valor; o que sobra é o id.
 *
 * O cuidado que dá nome a esta função: uma opção AUSENTE não pode consumir
 * nada. `indexOf` devolve -1 quando não acha, e um índice derivado de -1 aponta
 * para o primeiro posicional — que é justamente o id da operação. Por isso o
 * consumo só acontece quando a opção está de fato presente.
 */
export function parseStartArgs(args) {
	const statusAt = args.indexOf("--status");
	const cancelAt = args.indexOf("--cancel");
	const consumed = new Set();
	if (statusAt >= 0) consumed.add(statusAt).add(statusAt + 1);
	if (cancelAt >= 0) consumed.add(cancelAt).add(cancelAt + 1);

	let list = false;
	const rest = [];
	for (const [index, arg] of args.entries()) {
		if (consumed.has(index)) continue;
		if (arg === "--list" || arg === "-l") {
			list = true;
			continue;
		}
		rest.push(arg);
	}

	return {
		operation: rest.length > 0 ? rest.join(" ") : null,
		// PEDIR e INFORMAR O VALOR são perguntas separadas de propósito. `--cancel` sem id
		// precisa recusar dizendo qual id falta; se só o valor viajasse, "não pediu" e "pediu
		// sem valor" ficariam iguais, e a segunda cairia calada no caminho da primeira.
		statusRequested: statusAt >= 0,
		statusRunId: statusAt >= 0 ? (args[statusAt + 1] ?? null) : null,
		cancelRequested: cancelAt >= 0,
		cancelRunId: cancelAt >= 0 ? (args[cancelAt + 1] ?? null) : null,
		list,
	};
}
