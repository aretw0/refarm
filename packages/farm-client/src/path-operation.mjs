/**
 * path-operation — a operação que o instalador se recusava a fazer, agora PEDIDA.
 *
 * Até aqui o kit plantava os atalhos em `~/.local/bin`, via que aquilo não estava
 * no PATH, e mandava o operador acrescentar a linha "na unha". Recusar mexer no
 * perfil de alguém sem pedir estava certo; deixar o trabalho manual não é o que
 * ele quer:
 *
 *   "Quero soberania total, sem precisar fazer nada na unha, facilitar ao máximo
 *    a intenção necessária acontecer com autorização da operação como boa prática
 *    … não configura nada e esquece, lembra até pra poder entender se foi bem feito."
 *
 * São duas exigências, e a segunda é a que costuma ser pulada: **faça por mim, com
 * a minha autorização** e **lembre o que foi feito, para eu poder julgar depois**.
 *
 * A jornada inteira vem do bloco `@refarm.dev/operation-consent-v1`, carregado em
 * `vendor/` como o bloco de perguntas — este módulo só sabe UMA coisa: qual é o
 * arquivo de perfil deste aparelho e qual é a linha. Ele não sabe perguntar, não
 * sabe registrar e não sabe desfazer; isso é do bloco, para o nó e o aparelho
 * usarem a mesma jornada.
 *
 * Três regras que este módulo não quebra:
 *   - **sem terminal, NUNCA pergunta** — a saída é exatamente a de antes;
 *   - **a linha já presente é detectada** — nada é duplicado num `.bashrc`;
 *   - **uma recusa é lembrada** — o assistente não volta a perguntar sozinho; o
 *     operador reabre a questão de propósito, com `--revisit-path`.
 */
import { openSync } from "node:fs";
import { hostname } from "node:os";
import { basename, join } from "node:path";
import { ReadStream } from "node:tty";

import {
	createFileOperationTrail,
	createNodeOperationFileSystem,
	renderOperationRecord,
	runOperationConsent,
	standingDecision,
	undoOperationRecord,
} from "../vendor/operation-consent-v1/dist/index.js";
import { createStdioOperatorChannel } from "../vendor/prompt-contract-v1/dist/index.js";
import { canAskOperator, isOperatorCancellation } from "./ask-host.mjs";
import { pathAdviceLines, SHIM_NAMES } from "./shims.mjs";

/** A família de operação — o que agrupa esta pergunta na trilha. */
export const PATH_OPERATION_KIND = "shell-path";

/**
 * Um terminal para perguntar quando o stdin é um cano.
 *
 * O one-liner do cold-bootstrap — `curl … | node --input-type=module -` — entrega
 * o MÓDULO pelo stdin, então `process.stdin` não é terminal. Mas o operador está
 * ali, olhando o stdout, e é justamente o momento em que a pergunta importa. É o
 * mesmo `/dev/tty` que `sudo`, `git` e `ssh` abrem, pelo mesmo motivo.
 *
 * O stdout ser terminal é a condição: sem ele não há ninguém olhando, e abrir
 * `/dev/tty` seria perguntar para o vazio. Devolve `{ input, close }` ou null.
 */
export function openControllingTty({ output = process.stdout } = {}) {
	if (!output?.isTTY) return null;
	try {
		const stream = new ReadStream(openSync("/dev/tty", "r"));
		// `destroy()` fecha o fd. Sem isso o processo fica pendurado num terminal
		// que ninguém mais vai ler — o oposto de uma pergunta educada.
		return { input: stream, close: () => stream.destroy() };
	} catch {
		return null;
	}
}

/** O comentário que acompanha a linha: quem escreveu, por quê, e ONDE está o
 *  registro. Um `.bashrc` lido daqui a seis meses aponta para o próprio registro,
 *  em vez de deixar o operador adivinhar de onde aquilo veio. PURO. */
export function pathMarkerLine(trailPath, home) {
	return `# refarm/farm-client — atalhos do kit no PATH (registro: ${tildify(trailPath, home)})`;
}

/** `~/x` quando o caminho está sob o home — o jeito que cola igual em qualquer
 *  aparelho, e que o operador reconhece. PURO. */
export function tildify(path, home) {
	if (!home || !path.startsWith(`${home}/`)) return path;
	return `~${path.slice(home.length)}`;
}

/**
 * Onde a trilha de operações mora. Sob o HOME, e NÃO dentro do kit: uma recusa
 * tem de sobreviver a um `farm-update` e até a uma reinstalação do kit, senão
 * "não me pergunte de novo" dura até a próxima atualização. PURO.
 */
export function defaultTrailPath({ env = process.env, home } = {}) {
	const declared = env?.FARM_OPERATION_TRAIL;
	if (typeof declared === "string" && declared.trim()) return declared.trim();
	return join(home, ".refarm", "operations.json");
}

/**
 * Os candidatos a arquivo de perfil, na ordem em que ESTE shell os lê.
 *
 * `$SHELL` é o que o operador de fato usa — no Termux, quase sempre bash; num
 * Linux normal pode ser zsh. A ordem importa: escrever no arquivo errado é uma
 * alteração que não faz nada, e uma alteração inócua é pior que nenhuma, porque
 * o operador acredita que resolveu. PURO.
 */
export function profileCandidates({ home, env = process.env } = {}) {
	const shell = basename(String(env?.SHELL ?? "")).toLowerCase();
	const bashrc = join(home, ".bashrc");
	const zshrc = join(home, ".zshrc");
	const profile = join(home, ".profile");
	if (shell.includes("zsh")) return { shell: "zsh", candidates: [zshrc, profile, bashrc] };
	if (shell.includes("bash")) return { shell: "bash", candidates: [bashrc, profile, zshrc] };
	return { shell: shell || "sh", candidates: [profile, bashrc, zshrc] };
}

/**
 * Qual perfil receberá a linha: o PRIMEIRO que já existe, na ordem do shell.
 * Nenhum existe? O canônico do shell, que será criado — dito no pedido, para o
 * operador ver que um arquivo vai nascer. PURO (recebe quais existem).
 */
export function chooseProfile({ candidates, existing }) {
	const present = candidates.filter((path) => existing.includes(path));
	return { path: present[0] ?? candidates[0], existing: present, creating: present.length === 0 };
}

/** As grafias com que um perfil pode citar o mesmo diretório. PURO. */
function spellings(binDir, home) {
	const forms = [binDir];
	if (home && binDir.startsWith(`${home}/`)) {
		const rel = binDir.slice(home.length + 1);
		forms.push(`$HOME/${rel}`, `\${HOME}/${rel}`, `~/${rel}`);
	}
	return forms;
}

/**
 * O diretório JÁ é acrescentado ao PATH por este arquivo?
 *
 * Comentários não contam — uma linha comentada é justamente a que não faz nada, e
 * tratá-la como feita deixaria o operador sem os atalhos e sem a pergunta. PURO.
 */
export function alreadyOnPath(content, binDir, home) {
	if (!content) return false;
	const forms = spellings(binDir, home);
	return content.split("\n").some((raw) => {
		const line = raw.trim();
		if (!line || line.startsWith("#")) return false;
		if (!line.includes("PATH")) return false;
		return forms.some((form) => line.includes(form));
	});
}

/**
 * O pedido: ESTE arquivo, ESTA linha, NESTA posição, e como o arquivo está agora.
 * O `id` é a identidade da pergunta (o diretório de atalhos), nunca um relógio —
 * é ele que faz uma recusa antiga ser reconhecida em vez de re-perguntada. PURO.
 */
export function planPathOperation({
	binDir,
	exportLine,
	profilePath,
	current = null,
	trailPath,
	home,
	requestedAt,
	requester = "farm-client",
	notes = [],
}) {
	const marker = pathMarkerLine(trailPath, home);
	const text = `${marker}\n${exportLine}`;
	// Um arquivo cuja última linha não termina em \n ganharia a linha nova grudada
	// nela. Normalizar é parte da alteração e aparece nos snapshots — não é um
	// efeito escondido.
	const head =
		current === null || current === "" ? "" : current.endsWith("\n") ? current : `${current}\n`;
	const after = `${head}${text}\n`;
	const line = head === "" ? 1 : head.split("\n").length;
	return {
		id: `${PATH_OPERATION_KIND}:${binDir}`,
		kind: PATH_OPERATION_KIND,
		title: "Pôr os atalhos do kit no seu PATH",
		purpose: `Para você digitar ${SHIM_NAMES[0]} em vez do caminho inteiro do kit, em qualquer terminal novo.`,
		requester,
		requestedAt,
		changes: [
			{
				path: profilePath,
				before: current,
				after,
				insertion: {
					line,
					text,
					placement:
						current === null
							? `o arquivo será criado com estas linhas (linha ${line})`
							: `no fim do arquivo (linha ${line})`,
				},
			},
		],
		undo: {
			kind: "restore-snapshot",
			summary: `Restaura ${tildify(profilePath, home)} exatamente como está agora (o registro guarda o arquivo inteiro).`,
		},
		notes: [
			...notes,
			"Só vale em terminais abertos depois disso — reabra o shell (ou dê `source` no arquivo).",
		],
	};
}

/** As linhas que explicam uma decisão já tomada — sem re-perguntar. PURO. */
export function standingDecisionLines(record, { kitDir, home, trailPath, status }) {
	const revisit = revisitCommand(kitDir);
	if (record.decision === "authorized") {
		return [
			`  o PATH já foi autorizado em ${record.decidedAt} e escrito em ${tildify(record.changes[0]?.path ?? "", home)}.`,
			`  ainda não vale neste shell? reabra o terminal (ou: . ${tildify(record.changes[0]?.path ?? "", home)}).`,
			`  registro: ${tildify(trailPath, home)} — para desfazer: ${undoCommand(kitDir)}`,
		];
	}
	const verb = record.decision === "declined" ? "recusou" : "desfez";
	return [
		...pathAdviceLines(status, { kitDir }),
		`  (você ${verb} isto em ${record.decidedAt} — não pergunto de novo. Para rever: ${revisit})`,
	];
}

/** O caminho deliberado de volta à pergunta. Deliberado de propósito: um comando
 *  que o operador digita é a diferença entre rever e ser re-perguntado. PURO. */
export function revisitCommand(kitDir) {
	return `node ${join(kitDir, "bin", "farm-update.mjs")} --revisit-path`;
}

/** O caminho para desfazer o que foi autorizado. PURO. */
export function undoCommand(kitDir) {
	return `node ${join(kitDir, "bin", "farm-update.mjs")} --undo-path`;
}

/**
 * A jornada inteira, do jeito que o kit a vive.
 *
 * Devolve `{ status, lines, record }` — nunca imprime: quem chama decide onde as
 * linhas vão (o instalador e o `farm-update` imprimem em stdout). `status` é um
 * dos: `on-path`, `no-operator`, `already-present`, `already-decided`,
 * `authorized`, `declined`, `deferred`, `cancelled`, `failed`.
 */
export async function ensurePathOperation({
	binDir,
	kitDir,
	status,
	home,
	env = process.env,
	now = () => new Date().toISOString(),
	input = process.stdin,
	output = process.stdout,
	channel,
	trail,
	fs = createNodeOperationFileSystem(),
	trailPath = defaultTrailPath({ env, home }),
	decidedBy = env?.USER || env?.LOGNAME || "operador",
	host = safeHostname(),
	revisit = false,
	openTty = openControllingTty,
} = {}) {
	// Já está no PATH: nada a propor. A fala de sempre.
	if (status.onPath)
		return { status: "on-path", lines: pathAdviceLines(status, { kitDir }), record: null };

	// SEM TERMINAL, NUNCA PERGUNTA. Nem lê a trilha, nem registra: um script, um
	// cron, um pipe sem operador recebem exatamente a saída de antes desta operação
	// existir. O cano do cold-bootstrap é a exceção honesta: o stdin é o módulo, mas
	// o stdout é o terminal de alguém — aí a pergunta vai por `/dev/tty`.
	let tty = null;
	let ask = input;
	if (!canAskOperator({ input, output })) {
		tty = openTty({ output });
		if (!tty) {
			return { status: "no-operator", lines: pathAdviceLines(status, { kitDir }), record: null };
		}
		ask = tty.input;
	}
	try {
		return await proposePathOperation({
			binDir,
			kitDir,
			status,
			home,
			env,
			now,
			input: ask,
			output,
			channel,
			trail,
			fs,
			trailPath,
			decidedBy,
			host,
			revisit,
		});
	} finally {
		tty?.close();
	}
}

/** O miolo da jornada, já com um terminal em mãos. */
async function proposePathOperation({
	binDir,
	kitDir,
	status,
	home,
	env,
	now,
	input,
	output,
	channel,
	trail,
	fs,
	trailPath,
	decidedBy,
	host,
	revisit,
}) {
	const store = trail ?? createFileOperationTrail(trailPath, fs);
	const { shell, candidates } = profileCandidates({ home, env });
	const existing = [];
	const contents = new Map();
	for (const candidate of candidates) {
		const content = await fs.readFile(candidate);
		if (content !== null) {
			existing.push(candidate);
			contents.set(candidate, content);
		}
	}
	const chosen = chooseProfile({ candidates, existing });
	const current = contents.get(chosen.path) ?? null;

	// A linha já está lá: nada a acrescentar, e sobretudo nada a DUPLICAR. O que
	// falta é reabrir o shell, e é isso que se diz.
	const present = existing.find((path) => alreadyOnPath(contents.get(path), binDir, home));
	if (present) {
		return {
			status: "already-present",
			record: null,
			lines: [
				`  ${tildify(present, home)} já acrescenta ${tildify(binDir, home)} ao PATH — não mexo em nada.`,
				`  reabra o terminal (ou: . ${tildify(present, home)}) e rode: ${SHIM_NAMES[0]} "quem é você?"`,
			],
		};
	}

	const notes = [];
	if (chosen.creating) {
		notes.push(
			`nenhum perfil existe ainda; crio ${tildify(chosen.path, home)}, que é o do seu shell (${shell}).`,
		);
	} else if (chosen.existing.length > 1) {
		const others = chosen.existing
			.slice(1)
			.map((path) => tildify(path, home))
			.join(", ");
		notes.push(
			`escolhi ${tildify(chosen.path, home)} porque seu shell é ${shell}; também existem ${others}.`,
		);
	}

	const request = planPathOperation({
		binDir,
		exportLine: status.exportLine,
		profilePath: chosen.path,
		current,
		trailPath,
		home,
		requestedAt: now(),
		requester: `farm-client (${shell})`,
		notes,
	});

	const lines = [];
	let outcome;
	try {
		outcome = await runOperationConsent({
			request,
			trail: store,
			fs,
			channel: channel ?? createStdioOperatorChannel({ input, output }),
			now,
			decidedBy,
			host,
			revisit,
			announce: (line) => output.write(`${line}\n`),
		});
	} catch (error) {
		// Ctrl+C no meio da pergunta: uma linha e a instrução de sempre. Nada foi
		// escrito e nada foi registrado — uma pergunta cancelada não foi respondida.
		if (isOperatorCancellation(error)) {
			return {
				status: "cancelled",
				record: null,
				lines: ["  ✋ cancelado — nada foi alterado.", ...pathAdviceLines(status, { kitDir })],
			};
		}
		return {
			status: "failed",
			record: null,
			lines: [
				`  (não consegui aplicar: ${error?.message ?? error})`,
				...pathAdviceLines(status, { kitDir }),
			],
		};
	}

	if (outcome.status === "already-decided") {
		return {
			status: "already-decided",
			record: outcome.record,
			lines: standingDecisionLines(outcome.record, { kitDir, home, trailPath, status }),
		};
	}
	if (outcome.status === "authorized") {
		lines.push(`  ✔ acrescentei em ${tildify(chosen.path, home)}:`);
		lines.push(`      ${status.exportLine}`);
		lines.push(
			`  reabra o terminal (ou: . ${tildify(chosen.path, home)}) e rode: ${SHIM_NAMES[0]} "quem é você?"`,
		);
		lines.push(`  registro: ${tildify(trailPath, home)} — para desfazer: ${undoCommand(kitDir)}`);
		return { status: "authorized", record: outcome.record, lines };
	}
	if (outcome.status === "declined") {
		return {
			status: "declined",
			record: outcome.record,
			lines: [
				...pathAdviceLines(status, { kitDir }),
				`  (registrei a recusa em ${tildify(trailPath, home)} — não pergunto de novo. Para rever: ${revisitCommand(kitDir)})`,
			],
		};
	}
	return {
		status: "deferred",
		record: null,
		lines: [...pathAdviceLines(status, { kitDir }), "  (pergunto de novo na próxima vez)"],
	};
}

/**
 * Desfaz a operação de PATH que está de pé — e o desfazer é ele mesmo registrado,
 * porque a trilha é append-only: o registro antigo não é editado para fingir que
 * a alteração nunca aconteceu.
 */
export async function undoPathOperation({
	binDir,
	home,
	env = process.env,
	fs = createNodeOperationFileSystem(),
	trail,
	trailPath = defaultTrailPath({ env, home }),
	now = () => new Date().toISOString(),
} = {}) {
	const store = trail ?? createFileOperationTrail(trailPath, fs);
	const standing = standingDecision(await store.read(), `${PATH_OPERATION_KIND}:${binDir}`);
	if (!standing || standing.decision !== "authorized") {
		return {
			status: "nothing-to-undo",
			record: null,
			lines: [
				`  nada a desfazer: não há operação de PATH autorizada em ${tildify(trailPath, home)}.`,
			],
		};
	}
	const undone = await undoOperationRecord({ record: standing, trail: store, fs, now });
	return {
		status: "undone",
		record: undone,
		lines: [
			`  ↩ desfeito — ${tildify(standing.changes[0]?.path ?? "", home)} voltou ao que era.`,
			...renderOperationRecord(standing).map((line) => `  ${line}`),
		],
	};
}

function safeHostname() {
	try {
		return hostname();
	} catch {
		return "desconhecido";
	}
}
