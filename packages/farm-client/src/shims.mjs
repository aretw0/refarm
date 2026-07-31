/**
 * shims — o operador digita `farm-ask "olá"`, não um caminho absoluto.
 *
 * O kit vive em `~/.refarm/kit/farm-client`, e até aqui o instalador terminava
 * mandando rodar `node /caminho/longo/bin/farm-ask.mjs "…"`. Num celular, com
 * teclado de vidro, isso é o atrito que faz a ferramenta não ser usada.
 *
 * Então o instalador planta LANÇADORES: um `#!/bin/sh` de uma linha por comando,
 * num diretório de bin POR USUÁRIO. `~/.local/bin` é a convenção que existe nos
 * dois alvos — Linux normal e Termux (onde não há `/usr/local/bin` nem sudo, e
 * `$PREFIX` é do gerenciador de pacotes, não do usuário). `FARM_BIN_DIR` manda
 * em tudo, para quem já tem outro lugar.
 *
 * O que este módulo NÃO faz: mexer no perfil de shell de ninguém. Ele DIZ se o
 * diretório está no PATH e qual é a única linha a acrescentar — e para por aí.
 * Editar o `.bashrc` de alguém em silêncio é exatamente a ação de grande impacto
 * que se pede antes de fazer.
 *
 * Puro onde dá (`shimSource`, `pathStatus`, `pathAdviceLines`), I/O só em
 * `installShims` — o kit inteiro é testável sem terminal e sem HOME de verdade.
 */
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { delimiter, join, resolve } from "node:path";

/** Os comandos que ganham lançador. `farm-announce` fica de fora de propósito:
 *  ele é do lado HOST (anuncia a fazenda), não do aparelho que a alcança.
 *
 *  `farm-attend` entra pelo motivo oposto: é o comando MAIS do lado do aparelho
 *  que existe — a fazenda pergunta, e quem responde está com o telefone na mão.
 *  Um atalho a menos aqui é uma pergunta que fica pendurada por atrito de
 *  teclado de vidro.
 *
 *  `farm-start` entra pelo mesmo motivo, do outro lado: `farm-attend` só serve
 *  para uma pergunta que JÁ existe, e até aqui fazer uma existir exigia estar no
 *  computador. Os dois juntos fecham o ciclo — começar e atender — que é o que
 *  torna o nó operável de longe. */
export const SHIM_NAMES = ["farm-ask", "farm-attend", "farm-hello", "farm-start", "farm-update"];

/** Onde os lançadores vão. `FARM_BIN_DIR` > `~/.local/bin`. */
export function defaultBinDir({ env = process.env, home = homedir() } = {}) {
	const declared = env?.FARM_BIN_DIR;
	if (typeof declared === "string" && declared.trim()) return resolve(declared.trim());
	return join(home, ".local", "bin");
}

/**
 * O lançador: `sh` em vez de um `.mjs` executável, porque o shebang tem de
 * valer em Termux (onde o node NÃO está em /usr/bin) e num Linux normal. `exec`
 * para não deixar um shell pendurado, e `"$@"` para a pergunta chegar inteira,
 * com espaços e acentos. PURO.
 */
export function shimSource(kitDir, name, { node = process.execPath || "node" } = {}) {
	const entry = join(kitDir, "bin", `${name}.mjs`);
	return [
		"#!/bin/sh",
		`# farm-client shim → ${name}. Gerado pelo instalador do kit; edite o kit, não isto.`,
		`exec ${shellQuote(node)} ${shellQuote(entry)} "$@"`,
		"",
	].join("\n");
}

/** Aspas simples POSIX — um caminho com espaço não pode virar dois argumentos. */
function shellQuote(value) {
	return `'${String(value).replaceAll("'", `'\\''`)}'`;
}

/** O diretório de bin está no PATH deste shell? Comparação por caminho
 *  resolvido, para que `~/.local/bin` e `/home/x/.local/bin` sejam o mesmo. PURO. */
export function pathStatus({ binDir, env = process.env } = {}) {
	const target = resolve(binDir);
	const entries = String(env?.PATH ?? "")
		.split(delimiter)
		.filter(Boolean)
		.map((entry) => {
			try {
				return resolve(entry);
			} catch {
				return entry;
			}
		});
	return { binDir: target, onPath: entries.includes(target), exportLine: exportLine(target) };
}

/** A ÚNICA linha que o operador precisa colar. Escrita com `$HOME` quando o
 *  diretório está mesmo sob o home, para colar igual em qualquer aparelho. */
function exportLine(binDir, home = homedir()) {
	const underHome = binDir === join(home, ".local", "bin");
	const shown = underHome ? "$HOME/.local/bin" : binDir;
	return `export PATH="${shown}:$PATH"`;
}

/**
 * O que se DIZ ao operador sobre o PATH — os dois casos, nunca uma edição
 * silenciosa do perfil dele. PURO: devolve linhas, quem chama imprime.
 */
export function pathAdviceLines(status, { names = SHIM_NAMES, kitDir = null } = {}) {
	const example = names.includes("farm-ask") ? 'farm-ask "quem é você?"' : names[0];
	if (status.onPath) {
		return [`  atalhos em ${status.binDir} (já está no seu PATH)`, `  rode: ${example}`];
	}
	const fallback = kitDir
		? `  até lá: node ${join(kitDir, "bin", "farm-ask.mjs")} "quem é você?"`
		: `  até lá: use o caminho completo do kit`;
	return [
		`  atalhos em ${status.binDir} — que NÃO está no seu PATH.`,
		`  Acrescente esta linha ao seu perfil (~/.bashrc, ~/.zshrc ou ~/.profile) e reabra o shell:`,
		`      ${status.exportLine}`,
		`  (não mexo no seu perfil sozinho)`,
		`  depois: ${example}`,
		fallback,
	];
}

/**
 * Planta os lançadores. Best-effort por arquivo: um HOME somente-leitura não
 * pode derrubar uma instalação que já deu certo — o kit continua chamável pelo
 * caminho completo. Devolve `{ binDir, created, failed }`.
 */
export async function installShims({
	kitDir,
	binDir = defaultBinDir(),
	names = SHIM_NAMES,
	node,
} = {}) {
	const created = [];
	const failed = [];
	try {
		await mkdir(binDir, { recursive: true });
	} catch (error) {
		return { binDir, created, failed: names.map((name) => ({ name, error: message(error) })) };
	}
	for (const name of names) {
		const dest = join(binDir, name);
		try {
			await writeFile(dest, shimSource(kitDir, name, node ? { node } : {}));
			await chmod(dest, 0o755);
			created.push(name);
		} catch (error) {
			failed.push({ name, error: message(error) });
		}
	}
	return { binDir, created, failed };
}

function message(error) {
	return error instanceof Error ? error.message : String(error);
}
