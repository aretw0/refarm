/**
 * ask-host — quando o kit NÃO SABE o nome da fazenda, ele PERGUNTA.
 *
 * O caminho que alcança a fazenda de qualquer rede é o NOME (MagicDNS): não
 * depende de enumerar peers, não depende de estar na mesma LAN. Só que num
 * aparelho onde a CLI `tailscale` não existe — o normal no Android, que roda o
 * APP — o kit não tem como descobrir esse nome sozinho. Até aqui ele varria a
 * sub-rede inteira e depois EXPLICAVA, em quatro parágrafos, que o nome era o
 * caminho. Explicar não é perguntar.
 *
 * Aqui ele pergunta — e guarda a resposta em `.farm-host`, onde o kit já lembra
 * a fazenda, então pergunta UMA vez por aparelho.
 *
 * A pergunta vem do BLOCO (`@refarm.dev/prompt-contract-v1`), carregado em
 * `vendor/` — não de um readline feito à mão aqui dentro. Zero-dependência é
 * "nada a instalar", não "nada a reusar": o bloco tem zero dependências e
 * importa só `node:readline`, então viaja dentro do kit (ver scripts/vendor.mjs).
 *
 * Sem terminal, NUNCA pergunta: um script recebe o erro honesto e a dica do
 * nome, exatamente como antes.
 */
import {
	createStdioOperatorChannel,
	OperatorPromptCancelledError,
} from "../vendor/prompt-contract-v1/dist/index.js";
import { readRememberedHost, writeRememberedHost } from "./farm-host.mjs";

export { OperatorPromptCancelledError };

/** O texto da pergunta, exportado para que os testes (e qualquer outra
 *  superfície) usem A MESMA frase, em vez de uma cópia que envelhece. */
export const ASK_HOST_INTRO =
	"🌱 Não sei o nome da sua fazenda — e é o NOME que alcança de qualquer rede, sem enumerar nada.";
export const ASK_HOST_QUESTION = "Como se chama a sua fazenda?";
export const ASK_HOST_PLACEHOLDER = "nome MagicDNS, ex.: serpro-1577853";

/** Só há alguém para perguntar quando as DUAS pontas são terminal. Um pipe, um
 *  cron, um `| node -` não têm operador do outro lado — perguntar ali é travar. */
export function canAskOperator({ input = process.stdin, output = process.stdout } = {}) {
	return Boolean(input?.isTTY) && Boolean(output?.isTTY);
}

/** A cancelação do operador (Ctrl+C / Ctrl+D) chega como REJEIÇÃO do bloco.
 *  Reconhecida por instância e por nome — o kit pode carregar uma cópia do
 *  bloco diferente da de quem construiu o erro. */
export function isOperatorCancellation(error) {
	return (
		error instanceof OperatorPromptCancelledError ||
		error?.name === "OperatorPromptCancelledError"
	);
}

/**
 * O que o kit faz com uma cancelação: uma linha e sai. NUNCA um stack trace —
 * despejar pilha na cara de quem apertou Ctrl+C é o oposto de perguntar com
 * educação. Retorna o código de saída (130, a convenção de SIGINT) ou null
 * quando o erro não é uma cancelação (aí quem chamou relança).
 *
 * `nothingHappened` é o que NÃO aconteceu, na voz do comando que chamou: quem
 * envia diz "nada foi enviado", quem grava diz "nada foi guardado". Quem acabou
 * de cancelar é exatamente quem precisa saber se algo escapou, e a frase errada
 * aí é uma dúvida a mais, não uma a menos.
 */
export function cancellationExit(
	error,
	{ write = (s) => process.stderr.write(s), nothingHappened = "nada foi enviado" } = {},
) {
	if (!isOperatorCancellation(error)) return null;
	write(`\n✋ cancelado — ${nothingHappened}.\n`);
	return 130;
}

/**
 * Pergunta o nome da fazenda e o GUARDA. Retorna `{ host, asked }`:
 *   - sem terminal      → `{ host: null, asked: false }` (nunca pergunta)
 *   - resposta vazia    → `{ host: null, asked: true }`
 *   - resposta          → `{ host, asked: true }`, já persistida em `.farm-host`
 *
 * Rejeita com `OperatorPromptCancelledError` quando o operador cancela — quem
 * chama trata com `cancellationExit`.
 *
 * `channel` é injetável (é como os testes dirigem a pergunta sem terminal); por
 * padrão é o canal stdio do bloco.
 */
export async function askFarmHost({
	kitRootDir,
	channel,
	input = process.stdin,
	output = process.stdout,
	tty,
	announce = (line) => process.stderr.write(`${line}\n`),
} = {}) {
	const interactive = tty ?? canAskOperator({ input, output });
	if (!interactive) return { host: null, asked: false };

	announce(ASK_HOST_INTRO);
	const operator = channel ?? createStdioOperatorChannel({ input, output });
	const answer = await operator.ask({
		type: "text",
		question: ASK_HOST_QUESTION,
		placeholder: ASK_HOST_PLACEHOLDER,
	});
	const host = typeof answer === "string" ? answer.trim() : "";
	if (!host) return { host: null, asked: true };

	if (kitRootDir) {
		const remembered = await writeRememberedHost(kitRootDir, host);
		if (remembered) announce(`   ✔ guardado — não pergunto de novo neste aparelho.`);
	}
	return { host, asked: true };
}

/**
 * A escada do dispositivo até o endereço da fazenda. Injetável de ponta a ponta
 * (nenhuma rede aqui dentro), para que cada degrau seja testável sem tailnet e
 * sem fazenda de pé:
 *
 *   1. explícito (FARM_HOST / argv)      — sempre ganha
 *   2. a fazenda lembrada, se responder   — o padrão do aparelho
 *   3. peers da tailnet, se algum responder
 *   4. localhost, se responder
 *   5. PERGUNTAR — quando nada respondeu E o kit não conhece nome nenhum
 *   6. o que se conhece (lembrado) ou localhost — quem chamou imprime o erro honesto
 *
 * O degrau 5 só existe quando NÃO há nome lembrado: um nome conhecido que está
 * fora do ar é um problema de alcance, não de identidade — repetir a pergunta
 * ali seria trocar a ladainha por um interrogatório.
 *
 * Retorna `{ host, source, asked }`.
 */
export async function resolveFarmHost({
	kitRootDir,
	explicit = null,
	probe = async () => false,
	peers = async () => [],
	fallback = "127.0.0.1",
	...ask
} = {}) {
	if (explicit) return { host: explicit, source: "explicit", asked: false };

	const remembered = await readRememberedHost(kitRootDir);
	if (remembered && (await probe(remembered))) {
		return { host: remembered, source: "remembered", asked: false };
	}
	for (const peer of await peers()) {
		if (await probe(peer)) return { host: peer, source: "tailnet", asked: false };
	}
	if (await probe(fallback)) return { host: fallback, source: "fallback", asked: false };

	if (!remembered) {
		const answer = await askFarmHost({ kitRootDir, ...ask });
		if (answer.host) return { host: answer.host, source: "asked", asked: true };
		return { host: fallback, source: "unknown", asked: answer.asked };
	}
	return { host: remembered, source: "unreachable", asked: false };
}
