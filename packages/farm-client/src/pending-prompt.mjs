/**
 * pending-prompt — o lado do APARELHO de uma pergunta que ficou pendurada no nó.
 *
 * O nó publica perguntas com a forma de fio de `@refarm.dev/prompt-contract-v1`
 * (`PendingPrompt`). Este módulo é o que o aparelho precisa por cima disso e que
 * a forma de propósito NÃO carrega: como desenhar a pergunta, de quanto em
 * quanto tempo é educado perguntar de novo, e o que significa cada resposta do
 * sidecar. A forma diz o que a pergunta É; a superfície decide como ela aparece.
 *
 * Tudo aqui é PURO — sem rede, sem relógio implícito, sem terminal. Quem faz I/O
 * é `bin/farm-attend.mjs`. É isso que deixa a jornada inteira testável sem
 * levantar um servidor e sem um TTY de verdade.
 *
 * Duas regras que este módulo não quebra:
 *   - **a resposta nunca vira texto** — nada aqui recebe, formata ou devolve o
 *     VALOR de uma resposta; um segredo respondido do celular atravessa o fio
 *     uma vez só, do dedo do operador para quem perguntou;
 *   - **poll honesto** — intervalo declarado e backoff, nunca um laço apertado.
 */

/** A rota que lista o que está pendente no nó. */
export const PROMPTS_PATH = "/prompts";

/** A rota que responde UMA pergunta. */
export function answerPath(promptId) {
	return `/prompts/${encodeURIComponent(promptId)}/answer`;
}

// ── Poll honesto ──────────────────────────────────────────────────────────────

/** O piso, quando o nó não disse nada. O nó DIZ o dele em `pollIntervalMs`. */
export const DEFAULT_POLL_INTERVAL_MS = 2_000;
/** O teto que o backoff alcança — passado disso, insistir não é atender, é ruído. */
export const MAX_POLL_INTERVAL_MS = 20_000;

/**
 * O intervalo da PRÓXIMA consulta, contando quantas voltas seguidas vieram
 * vazias. Volta ao piso assim que alguma coisa aparece (`emptyRounds = 0`), e
 * dobra até o teto quando não aparece nada — um aparelho esquecido na mesa
 * pergunta de minuto em minuto, não dez vezes por segundo. PURO.
 */
export function nextPollDelayMs(emptyRounds, { base = DEFAULT_POLL_INTERVAL_MS, max = MAX_POLL_INTERVAL_MS } = {}) {
	const floor = Math.max(1, Math.trunc(base));
	const ceiling = Math.max(floor, Math.trunc(max));
	const rounds = Number.isFinite(emptyRounds) && emptyRounds > 0 ? Math.trunc(emptyRounds) : 0;
	// 2^rounds cresce rápido; o `Math.min` prende antes de virar um número absurdo.
	const grown = floor * 2 ** Math.min(rounds, 20);
	return Math.min(grown, ceiling);
}

/** O intervalo que o NÓ declarou, quando declarou um usável. PURO. */
export function declaredPollIntervalMs(listBody) {
	const declared = listBody?.pollIntervalMs;
	return typeof declared === "number" && Number.isFinite(declared) && declared > 0
		? Math.trunc(declared)
		: DEFAULT_POLL_INTERVAL_MS;
}

// ── O que o sidecar respondeu ─────────────────────────────────────────────────

/**
 * Traduz a resposta HTTP de um envio de resposta no DESFECHO, com as palavras
 * que o operador vai ler. Nunca inclui o valor enviado. PURO.
 *
 *   200 → answered        — foi esta resposta que valeu
 *   409 → already-settled — alguém respondeu antes (e diz QUEM)
 *   400 → invalid         — a pergunta recusou a resposta (ex.: opção que não existe)
 *   404 → gone            — quem perguntou foi embora; a pergunta morreu com ele
 */
export function classifyAnswerResponse(status, body = {}) {
	if (status === 200) return { outcome: "answered", device: body.device ?? null };
	if (status === 409) {
		return {
			outcome: "already-settled",
			device: body.device ?? null,
			// `abandoned` aqui quer dizer que ninguém respondeu: cancelaram ou o
			// prazo de quem perguntou passou.
			settledAs: body.outcome ?? null,
			reason: body.reason ?? null,
		};
	}
	if (status === 400) return { outcome: "invalid", detail: body.detail ?? null };
	if (status === 404) return { outcome: "gone" };
	return { outcome: "error", status };
}

/** A linha que se mostra para cada desfecho. Nunca ecoa a resposta. PURO. */
export function answerOutcomeLine(result) {
	switch (result.outcome) {
		case "answered":
			return "✔ respondido.";
		case "already-settled":
			return result.settledAs === "abandoned"
				? `↩ tarde demais — a pergunta foi encerrada${result.reason ? ` (${translateReason(result.reason)})` : ""}.`
				: `↩ tarde demais — já foi respondido${result.device ? ` em ${describeDevice(result.device)}` : ""}.`;
		case "invalid":
			return `✋ a pergunta recusou essa resposta${result.detail ? `: ${result.detail}` : ""}.`;
		case "gone":
			return "🌫 quem perguntou foi embora — a pergunta não existe mais.";
		default:
			return `❌ o nó respondeu HTTP ${result.status}.`;
	}
}

function translateReason(reason) {
	if (reason === "expired") return "o prazo de quem perguntou passou";
	if (reason === "cancelled") return "cancelada no terminal";
	return reason;
}

/** As identidades reservadas do bloco começam com espaço, de propósito, para
 *  nunca colidirem com um rótulo de aparelho. Aqui elas viram algo legível. */
export function describeDevice(device) {
	if (device === " terminal") return "no terminal que perguntou";
	if (device === " node-local") return "no próprio nó";
	return device;
}

// ── Como a pergunta aparece no aparelho ───────────────────────────────────────

/** Quanto tempo falta para o prazo de quem perguntou (P5). PURO. */
export function remainingLabel(pending, now = Date.now()) {
	if (pending?.expiresAt == null) return null;
	const ms = pending.expiresAt - now;
	if (ms <= 0) return "prazo esgotado";
	const seconds = Math.round(ms / 1000);
	if (seconds < 90) return `${seconds}s restantes`;
	return `${Math.round(seconds / 60)}min restantes`;
}

/** A pergunta já passou do prazo de quem perguntou? PURO. */
export function isExpired(pending, now = Date.now()) {
	return pending?.expiresAt != null && pending.expiresAt <= now;
}

/**
 * O cabeçalho que vem ANTES do prompt: quem perguntou, de onde, quanto tempo
 * falta — e, quando for o caso, o aviso do P4.
 *
 * O aviso não é decoração. Respondida daqui, a resposta ATRAVESSA o fio;
 * autenticada por aparelho e dentro do WireGuard da tailnet, mas atravessa. Quem
 * preferir levantar e ir até a mesa merece saber disso ANTES de digitar, não
 * depois. PURO: devolve linhas, quem chama imprime.
 */
export function promptHeaderLines(pending, { now = Date.now(), index = null, total = null } = {}) {
	const lines = [];
	const position = index !== null && total !== null && total > 1 ? ` [${index + 1}/${total}]` : "";
	const where = pending.asker?.host ? ` em ${pending.asker.host}` : "";
	lines.push(`\n▸ ${pending.asker?.command ?? "alguém"}${where}${position}`);
	const remaining = remainingLabel(pending, now);
	if (remaining) lines.push(`  ⏳ ${remaining}`);
	if (pending.answerTravels) {
		lines.push("  🔐 esta resposta ATRAVESSA a rede até o nó (autenticada, dentro da tailnet).");
		lines.push("     Se preferir não mandar por aqui, responda no terminal que perguntou.");
	}
	return lines;
}

/** Nada pendente — dito uma vez, com o intervalo declarado, para o operador
 *  saber que o silêncio é silêncio e não travamento. PURO. */
export function idleLine(pollIntervalMs) {
	return `nada pendente — conferindo a cada ${Math.round(pollIntervalMs / 1000)}s (Ctrl+C sai)`;
}
