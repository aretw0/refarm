/**
 * reach — o que um DISPOSITIVO tenta em seguida para achar a fazenda, e o que se
 * diz a ele quando não achou.
 *
 * Puro: sem I/O, sem spawn, sem rede. Os bins (`farm-hello`, `farm-ask`) são a
 * casca de I/O em volta destas decisões, o que as torna testáveis sem tailnet,
 * sem LAN e sem fazenda de pé. Zero-dependência como todo o kit — é isso que
 * deixa o kit rodar de um `git pull` num celular.
 */

/**
 * O que fazer depois de PERGUNTAR à tailnet (`tailnetPeersReport`).
 *
 * O ponto inteiro: **"a tailnet respondeu que não há ninguém" e "não consegui
 * perguntar à tailnet" não são a mesma resposta.** É a mesma distinção que o
 * relatório de peers já faz (`no-peers` vs `cli-missing`/`query-failed`/
 * `bad-output`), que o probe de conexão faz (`down` vs `unknown`) e que o
 * `sidecar::tailnet_resolve` do Rust faz (`Down` vs `CouldNotAsk`). Até aqui o
 * `farm-hello` colapsava as duas em "zero peers" e seguia para a varredura.
 *
 * Onde não dá para ENUMERAR, o caminho que funciona é o NOME: o MagicDNS resolve
 * de qualquer rede sem CLI nenhuma. Por isso ele é o PRIMEIRO oferecido, não o
 * último. Esse é exatamente o caso do celular — no Android roda o APP do
 * Tailscale, não a CLI, então enumerar peers ali é estruturalmente impossível,
 * não uma falha de configuração que se conserte instalando algo. E varrer 253
 * endereços unicast num aparelho desses é gastar bateria e tempo respondendo a
 * pergunta errada, então a varredura fica DESLIGADA nesse caminho.
 *
 * @param report o retorno de `tailnetPeersReport` (nunca rejeita, sempre tem `reason`)
 * @param options.self como este script foi invocado, para as linhas serem copiáveis
 * @returns `{ askedTailnet, peers, suggestByName, sweepSubnet, lines }`
 */
export function planTailnetReach(report, { self = "farm-hello" } = {}) {
	const reason = typeof report?.reason === "string" ? report.reason : "query-failed";
	const peers = Array.isArray(report?.peers) ? report.peers : [];

	if (reason === "peers" && peers.length > 0) {
		return {
			askedTailnet: true,
			peers,
			suggestByName: false,
			sweepSubnet: true,
			lines: [`🔎 Tailnet detectada — testando ${peers.length} peer(s)…`],
		};
	}
	if (reason === "peers" || reason === "no-peers") {
		// A tailnet RESPONDEU, e a resposta é "não há mais ninguém aqui agora".
		// Resposta completa e confiável: seguir para os dialetos de LAN (inclusive
		// a varredura) é honesto, porque a pergunta já foi feita e respondida.
		return {
			askedTailnet: true,
			peers: [],
			suggestByName: false,
			sweepSubnet: true,
			lines: ["🔎 A tailnet respondeu: nenhum outro dispositivo online nela agora."],
		};
	}
	// `cli-missing` | `query-failed` | `bad-output` — NÃO houve resposta.
	return {
		askedTailnet: false,
		peers: [],
		suggestByName: true,
		sweepSubnet: false,
		lines: [
			`🔎 Não consegui PERGUNTAR à tailnet — ${whyCouldNotAsk(report, reason)}.`,
			...byNameLines(self),
			"   (sem enumeração não varro a sub-rede inteira — só o broadcast barato)",
		],
	};
}

/**
 * O alcance por NOME: o único que não depende de enumerar nem de estar na mesma
 * LAN. Uma função só, para que o mesmo texto sirva o caminho "não consegui
 * perguntar" e o caminho "não achei em lugar nenhum".
 */
export function byNameLines(self = "farm-hello") {
	return [
		"   O caminho que NÃO precisa enumerar é o NOME do host — o MagicDNS resolve",
		"   de qualquer rede, sem CLI de tailnet neste aparelho:",
		`      ${self} <nome-do-host>          # ex.: <nome-do-host> = serpro-1577853`,
		`      FARM_HOST=<nome-do-host> ${self}   # o mesmo, por ambiente`,
	];
}

/** Por que a pergunta não pôde ser feita, em uma linha que o operador consegue agir. */
function whyCouldNotAsk(report, reason) {
	const detail = typeof report?.detail === "string" && report.detail ? report.detail : null;
	if (reason === "cli-missing") {
		// Estrutural, não configuração: no Android existe o app do Tailscale, e ele
		// não expõe CLI. Dizer "instale a CLI" aqui seria mandar o operador atrás de
		// algo que não existe para o aparelho dele.
		return "a CLI `tailscale` não está no PATH (no Android roda o app, não a CLI)";
	}
	if (reason === "bad-output") {
		return detail ?? "`tailscale status --json` não respondeu um documento de status";
	}
	return detail ?? "a consulta ao `tailscale` falhou";
}

/**
 * Como uma fazenda passa a expor o sidecar HTTP para este dispositivo.
 *
 * Substitui a orientação antiga (`REFARM_HTTP_HOST=0.0.0.0 …`), que mandava o
 * operador contornar a própria declaração — exatamente o footgun que o trabalho
 * de `surfaces` existe para remover. Uma superfície não se abre com uma flag:
 * ela é DECLARADA, e o que não é declarado fica fechado.
 * Ver docs/superpowers/specs/2026-07-29-declared-surfaces-design.md.
 */
export function sidecarExposureLines({ expose = "tailnet" } = {}) {
	return [
		"   Uma superfície não se abre por flag — ela é DECLARADA. No host, em",
		"   .refarm/config.json:",
		`     "surfaces": { "sidecar-http": { "expose": "${expose}", "gate": "device-token" } }`,
		'     (expose: "loopback" | "host:<ip>" | "tailnet" — o não declarado fica fechado)',
		"   E este dispositivo precisa da credencial dele:",
		"     refarm auth enroll <rótulo-deste-aparelho>   # no host; o token aparece 1x",
		"     export FARM_TOKEN=<token>                    # aqui, no aparelho",
	];
}

/** Classify an HTTP sidecar probe without confusing reachability with authorisation. */
export function classifySidecarProbe(status) {
	if (!Number.isInteger(status)) return { reachable: false, usable: false, reason: "unreachable" };
	if (status >= 200 && status < 300) return { reachable: true, usable: true, reason: "ready" };
	if (status === 401) return { reachable: true, usable: false, reason: "credential-required" };
	if (status === 403) return { reachable: true, usable: false, reason: "credential-refused" };
	return { reachable: true, usable: false, reason: "http-error" };
}

/** Actionable diagnosis once a host answered but the sidecar refused the probe. */
export function sidecarProbeFailureLines(probe, base) {
	if (probe?.reason === "credential-required") {
		return [
			`❌ sidecar alcançável em ${base}, mas a credencial não foi aceita (HTTP 401)`,
			"   Confirme que o token deste aparelho está exportado nesta sessão:",
			"     test -n \"$FARM_TOKEN\" && echo 'FARM_TOKEN presente'",
			"   Se estiver presente, ele é antigo ou não corresponde ao aparelho: gere outro com",
			"     refarm auth enroll <rótulo-deste-aparelho>   # no host; o token aparece 1x",
		];
	}
	if (probe?.reason === "credential-refused") {
		return [
			`❌ sidecar alcançável em ${base}, mas esta credencial não autoriza a operação (HTTP 403)`,
			"   Use uma credencial de aparelho criada por `refarm auth enroll`.",
		];
	}
	if (probe?.reason === "http-error") {
		return [`❌ sidecar alcançável em ${base}, mas respondeu HTTP ${probe.status}`];
	}
	return [`❌ sidecar inalcançável em ${base}`];
}

/**
 * O mesmo, para o WebSocket do CRDT.
 *
 * A afirmação antiga — "o WS :42000 já ouve em 0.0.0.0, cobre LAN e tailnet por
 * padrão" — era falsa: o WS fica em loopback, e o daemon RECUSA bind fora do
 * loopback sem declaração. A que a substituiu por um tempo ("o handshake de
 * credencial do WS (ADR-093) ainda não existe") envelheceu no dia em que o
 * ADR-093 shipou. O que é verdade hoje: o WS é declarado como qualquer outra
 * superfície, e o handshake É autenticado contra a MESMA política de
 * device-token do sidecar — `farmSyncWsProtocols` já oferece `bearer.<token>`.
 */
export function daemonWsExposureLines() {
	return [
		"   O WS fica em LOOPBACK enquanto ninguém o declara. Para alcançá-lo daqui,",
		"   o host declara, em .refarm/config.json:",
		'     "surfaces": { "daemon-ws": { "expose": "host:<ip>", "gate": "device-token" } }',
		"   e este aparelho apresenta a credencial no handshake — com FARM_TOKEN setado,",
		"   o kit já oferece `bearer.<token>` automaticamente (ADR-093).",
	];
}
