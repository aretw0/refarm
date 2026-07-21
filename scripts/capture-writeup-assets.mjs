#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultOut = path.join(repoRoot, ".dgk", "writeup-captures", timestampSlug(new Date()));

const args = parseArgs(process.argv.slice(2));
const outDir = path.resolve(args.out ?? defaultOut);
const stateDir = path.join(outDir, "state");
const htmlDir = path.join(outDir, "html");
const pngDir = path.join(outDir, "png");
const svgDir = path.join(outDir, "svg");
const recordsDir = path.join(outDir, "records");
const diagramsDir = path.join(outDir, "diagrams");
const chrome = args.chrome ?? process.env.CHROME_PATH ?? process.env.GOOGLE_CHROME ?? findCommand("google-chrome");
const skipScreenshots = args["no-screenshots"] === true;
const selected = new Set(String(args.only ?? "t1,t2,t3").split(",").map((s) => s.trim()).filter(Boolean));

for (const dir of [outDir, stateDir, htmlDir, pngDir, svgDir, recordsDir, diagramsDir]) mkdirSync(dir, { recursive: true });

const cli = {
	t1: path.join(repoRoot, "examples", "devbench-t1", "dist", "cli.js"),
	t2: path.join(repoRoot, "examples", "wallet-t2", "dist", "cli.js"),
	t3: path.join(repoRoot, "examples", "reqbench-t3", "dist", "cli.js"),
};

const sharedEnv = {
	...process.env,
	NO_COLOR: process.env.NO_COLOR ?? "1",
	DGK_WALLET_STATE_PATH: path.join(stateDir, "wallet.manifest.json"),
	DGK_REQUIREMENTS_STATE_PATH: path.join(stateDir, "requirements.manifest.json"),
};

/**
 * The neutral namespace this package speaks in. The examples white-label their COMMAND through
 * `DGK_COMMAND`, but package ids and CSS class prefixes come from the source tree and carry the
 * framework's name into the artifact regardless — `@refarm/agent` renders inside the figure, and
 * `refarm-table` rides along in the HTML that produced it.
 *
 * These captures are meant for readers who must not be told which framework produced them, so the
 * package is neutralized AT GENERATION rather than sanitized afterwards. Sanitizing later is a
 * step someone eventually forgets, and no gate catches a brand name inside a PNG.
 *
 * Published identifiers that a claim depends on (a served JSON-LD context, for instance) are NOT
 * rewritten — only the framework's own name in package ids and style hooks.
 */
const NAMESPACE = process.env.DGK_COMMAND ?? "poc";
const BRAND = /\brefarm\b/gi;

function neutralize(text) {
	return typeof text === "string" ? text.replace(BRAND, NAMESPACE) : text;
}

/** Write an artifact with the framework's name mapped to the neutral namespace. */
function writeNeutralized(file, contents) {
	writeFileSync(file, neutralize(contents), "utf8");
}

const assets = [];
const failures = [];

if (args.build === true) {
	for (const pkg of ["devbench-t1", "wallet-t2", "reqbench-t3"]) {
		runCommand(`build ${pkg}`, "pnpm", ["--filter", pkg, "build"], { cwd: repoRoot, env: process.env, fatal: false });
	}
}

for (const [key, file] of Object.entries(cli)) {
	if (selected.has(key) && !existsSync(file)) {
		failures.push({
			label: `${key} cli`,
			message: `CLI build artifact missing: ${path.relative(repoRoot, file)}. Run with --build, or run the scoped build first.`,
		});
	}
}

if (selected.has("t1")) captureT1();
if (selected.has("t2")) captureT2();
if (selected.has("t3")) captureT3();
copyReferenceDiagrams();
copyReportRecords();
writeIndexes();

console.log(JSON.stringify({ ok: failures.length === 0, outDir, screenshotCount: assets.filter((a) => a.png).length, assetCount: assets.length, failures }, null, 2));

function captureT1() {
	const governance = runJson("T1 governance-poc", cli.t1, ["governance-poc", "--json"]);
	if (governance?.governanceHtml) {
		writeHtmlAsset({
			slug: "t1-governance-dashboard",
			title: "T1 — Governança executada",
			kicker: "Plugins WASM / máquina extensível",
			caption: "Decisão, bloqueio, isolamento e scorecard são dados executados: 6 combinações, 2 bloqueios fora do grant, 1 falha isolada e gate de continuação.",
			body: governance.governanceHtml,
			command: "node examples/devbench-t1/dist/cli.js governance-poc --json",
			claim: "A governança da extensibilidade não é apenas diagrama: ela gera placar e desfechos observáveis.",
		});
	}

	const graph = runJson("T1 extension-graph", cli.t1, ["extension-graph", "--json"]);
	if (graph?.graphSvg) {
		writeSvgAsset({
			slug: "t1-extension-graph",
			title: "T1 — Grafo SPI de extensões",
			kicker: "requiresApi → providesApi",
			caption: `Grafo com ${graph.pluginCount ?? "?"} plugins, ${graph.spiEdges ?? "?"} arestas SPI e ${graph.executedCount ?? "?"} arestas executadas marcadas.`,
			svg: graph.graphSvg,
			command: "node examples/devbench-t1/dist/cli.js extension-graph --json",
			claim: "Uma extensão aparece como relação rastreável entre capacidades, não como acoplamento invisível.",
		});
	}

	const extension = runJson("T1 extension", cli.t1, ["extension", "--json"]);
	if (extension) {
		writeHtmlAsset({
			slug: "t1-declare-once-surfaces",
			title: "T1 — Declare uma vez → aparece nas superfícies",
			kicker: extension.pluginId ?? "@devbench/coding-agent",
			caption: "O manifesto declara agent:code e agent:review; a ponte sintetiza verbos de primeira classe para CLI, HTTP, REPL, TUI e web.",
			body: renderT1Extension(extension),
			command: "node examples/devbench-t1/dist/cli.js extension --json",
			claim: "A POC materializa o efeito de extensibilidade multi-superfície.",
		});
	}

	captureAgentPluginMaterial();

	runReport("T1 report", cli.t1, ["report", "--apply", "--json"]);
}

function captureAgentPluginMaterial() {
	const agentManifest = readJsonFile(path.join(repoRoot, "packages", "agent", "plugin.json"));
	const lspManifest = readJsonFile(path.join(repoRoot, "packages", "lsp-code-ops", "plugin.json"));
	if (agentManifest && lspManifest) {
		const liveAsk = readJsonFile(path.join(repoRoot, ".dgk", "agent-live-record", "script-live-after-sow", "ask-live.json"));
		writeHtmlAsset({
			slug: "t1-agent-plugin-and-lsp-flow",
			title: "T1 — Agent como plugin + ferramenta LSP",
			kicker: "Aplicação assistida por agente / extensão governada",
			caption: "O agente não é uma tela de chat solta: ele é um plugin WASM carregado pelo runtime; o lsp-code-ops é outro plugin que adiciona operações semânticas de editor ao agente.",
			body: renderAgentPluginFlow(agentManifest, lspManifest, liveAsk),
			command: "packages/agent/plugin.json + packages/lsp-code-ops/plugin.json + pnpm run writeup:agent-record",
			// A figura descreve o que foi executado; quem julga se isso é inovação é quem lê.
			claim: "Cadeia executada: plugin de agente → ferramenta contribuída por plugin → operação semântica auditável.",
		});
	}

	const telemetry = runJson("T1 agent telemetry", cli.t1, ["agent-telemetry", "--mock", "--with-effects", "--json"]);
	if (telemetry?.timeline) {
		writeHtmlAsset({
			slug: "t1-agent-telemetry-trace",
			title: "T1 — Execução do agente com trilha causal",
			kicker: "agent:* + host-effect:*",
			caption: `${telemetry.timeline.iterations ?? "?"} iterações, ${(telemetry.timeline.toolCalls ?? []).length} tool calls e ${telemetry.trace?.effectCount ?? "?"} efeitos de host correlacionados no audit log.`,
			body: renderAgentTelemetry(telemetry),
			command: "node examples/devbench-t1/dist/cli.js agent-telemetry --mock --with-effects --json",
			claim: "O comportamento agentic fica verificável: rota, iterações, ferramentas, efeitos e tokens viram registro técnico, não narrativa.",
		});
	}

	const references = runJson("T1 code-ops find-references", cli.t1, ["code-ops", "find-references", "--line", "1", "--column", "5", "--json"]);
	const rename = runJson("T1 code-ops rename-symbol", cli.t1, ["code-ops", "rename-symbol", "--line", "1", "--column", "5", "--new-name", "secureSubject", "--json"]);
	if (references?.ok && rename?.ok) {
		writeHtmlAsset({
			slug: "t1-lsp-code-ops-value",
			title: "T1 — Valor tangível: inspeção e refatoração semântica",
			kicker: "lsp-code-ops / verificação assistida",
			caption: `${(references.result ?? []).length} referências encontradas por LSP; rename aplicou ${rename.result?.editsApplied ?? "?"} edições em ${rename.result?.filesChanged ?? "?"} arquivo(s).`,
			body: renderCodeOpsValue(references, rename),
			command: "node examples/devbench-t1/dist/cli.js code-ops find-references ... && code-ops rename-symbol ...",
			claim: "A POC entrega um uso agentic concreto: localizar evidência de código e aplicar mudança semântica auditável — a base para triagem de vulnerabilidades e dívida técnica.",
		});
	}
}

function captureT2() {
	const wallet = runJson("T2 wallet", cli.t2, ["wallet", "--json"]);
	if (wallet?.walletHtml) {
		writeHtmlAsset({
			slug: "t2-wallet",
			title: "T2 — Minha Carteira Digital",
			kicker: "Cidadão soberano / local-first",
			caption: `${wallet.total ?? "?"} itens na carteira; ${wallet.byState?.verified ?? "?"} verificados e ${wallet.byState?.draft ?? "?"} a verificar.`,
			body: wallet.walletHtml,
			command: "node examples/wallet-t2/dist/cli.js wallet --json",
			claim: "O cidadão vê um produto concreto: seus itens, seus estados e sua decisão de compartilhamento.",
		});
	}

	const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
	const authorization = runJson("T2 authorize", cli.t2, [
		"authorize",
		"Receita Federal",
		"--purpose",
		"Comprovar cadastro",
		"--scope",
		"cpf,nome",
		"--expires",
		expires,
		"--json",
	]);
	if (authorization?.id) runJson("T2 present", cli.t2, ["present", authorization.id, "--json"]);

	const sovereignty = runJson("T2 sovereignty", cli.t2, ["sovereignty", "--json"]);
	if (sovereignty?.sovereigntyHtml) {
		writeHtmlAsset({
			slug: "t2-sovereignty-dashboard",
			title: "T2 — Consentimento e disclosure",
			kicker: "Escopo, finalidade e histórico",
			caption: "Um pedido autorizado aparece como disclosure com escopo explícito; a superfície mostra consentimentos ativos/revogados e última mudança.",
			body: sovereignty.sovereigntyHtml,
			command: "node examples/wallet-t2/dist/cli.js authorize ... && node examples/wallet-t2/dist/cli.js sovereignty --json",
			claim: "Compartilhar dados vira registro auditável, com escopo e finalidade visíveis.",
		});
	}

	const disclosure = runJson("T2 disclosure-graph", cli.t2, ["disclosure-graph", "--json"]);
	if (disclosure?.graphSvg) {
		writeSvgAsset({
			slug: "t2-disclosure-graph",
			title: "T2 — Grafo de compartilhamento",
			kicker: "Com quem compartilhei o quê",
			caption: `${disclosure.disclosureCount ?? "?"} disclosure(s) no grafo após a autorização sintética de demonstração.`,
			svg: disclosure.graphSvg,
			command: "node examples/wallet-t2/dist/cli.js disclosure-graph --json",
			claim: "A POC transforma consentimento em superfície de auditoria para o titular.",
		});
	}

	runReport("T2 report", cli.t2, ["report", "--apply", "--json"]);
}

function captureT3() {
	const moc = runJson("T3 requirements", cli.t3, ["requirements", "--json"]);
	if (moc?.mocHtml) {
		writeHtmlAsset({
			slug: "t3-requirements-moc",
			title: "T3 — Mapa de Conteúdo de requisitos",
			kicker: "Analista de requisitos / result mode",
			caption: `${moc.total ?? "?"} requisitos organizados em ${moc.groupCount ?? "?"} grupos, com relações preservadas nos itens.`,
			body: moc.mocHtml,
			command: "node examples/reqbench-t3/dist/cli.js requirements --json",
			claim: "O analista recebe um artefato navegável, não apenas uma arquitetura proposta.",
		});
	}

	const overview = runJson("T3 requirements-overview", cli.t3, ["requirements-overview", "--json"]);
	if (overview?.overviewHtml) {
		writeHtmlAsset({
			slug: "t3-vault-overview",
			title: "T3 — Saúde e cobertura do vault",
			kicker: "Cobertura, rastreabilidade e qualidade",
			caption: `Corpus com ${overview.total ?? "?"} requisitos, ${overview.relations ?? "?"} relações e ${overview.attachments ?? "?"} anexos registrados.`,
			body: overview.overviewHtml,
			command: "node examples/reqbench-t3/dist/cli.js requirements-overview --json",
			claim: "A POC mede cobertura e saúde do corpus, reduzindo a dependência de narrativa manual.",
		});
	}

	const graph = runJson("T3 requirements-graph", cli.t3, ["requirements-graph", "--json"]);
	if (graph?.svg) {
		writeSvgAsset({
			slug: "t3-requirements-graph",
			title: "T3 — Rede de requisitos",
			kicker: "Rastreabilidade visual",
			caption: `${graph.total ?? "?"} requisitos projetados como grafo; os links vêm dos registros, não de desenho manual.`,
			svg: graph.svg,
			command: "node examples/reqbench-t3/dist/cli.js requirements-graph --json",
			claim: "Rastreabilidade passa a ser artefato navegável e regenerável.",
		});
	}

	const search = runJson("T3 requirements-search", cli.t3, ["requirements-search", "CNPJ", "--json"]);
	if (search) {
		writeHtmlAsset({
			slug: "t3-search-cnpj",
			title: "T3 — Busca facetada por CNPJ",
			kicker: "Consulta sobre o corpus",
			caption: `${search.matched ?? "?"} requisitos encontrados para a consulta “CNPJ”.`,
			body: renderSearchResults(search),
			command: "node examples/reqbench-t3/dist/cli.js requirements-search CNPJ --json",
			claim: "O corpus materializado pode ser consultado e explicado por facetas.",
		});
	}

	runReport("T3 report", cli.t3, ["requirements-report", "--apply", "--json"]);
}

function runReport(label, file, commandArgs) {
	const result = runJson(label, file, commandArgs);
	return result;
}

function runJson(label, file, commandArgs) {
	if (!existsSync(file)) return null;
	const result = runCommand(label, process.execPath, [file, ...commandArgs], { cwd: outDir, env: sharedEnv, fatal: false });
	if (result.status !== 0) {
		failures.push({ label, status: result.status, message: result.stderr || result.stdout });
		writeFailureAsset(label, commandArgs.join(" "), result);
		return null;
	}
	try {
		return JSON.parse(result.stdout);
	} catch (error) {
		failures.push({ label, message: `Could not parse JSON: ${error.message}` });
		writeFailureAsset(label, commandArgs.join(" "), result);
		return null;
	}
}

function runCommand(label, cmd, cmdArgs, { cwd, env, fatal = true }) {
	const result = spawnSync(cmd, cmdArgs, { cwd, env, encoding: "utf8", maxBuffer: 20 * 1024 * 1024 });
	if (fatal && result.status !== 0) {
		throw new Error(`${label} failed (${result.status})\n${result.stderr || result.stdout}`);
	}
	return { status: result.status ?? 0, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

function writeHtmlAsset({ slug, title, kicker, caption, body, command, claim }) {
	const htmlPath = path.join(htmlDir, `${slug}.html`);
	const pngPath = path.join(pngDir, `${slug}.png`);
	writeNeutralized(htmlPath, wrapHtml({ title, kicker, caption, body, command, claim }));
	const png = screenshot(htmlPath, pngPath) ? pngPath : null;
	assets.push({ slug, title, caption, claim, command, html: htmlPath, png });
}

function writeSvgAsset({ slug, title, kicker, caption, svg, command, claim }) {
	const svgPath = path.join(svgDir, `${slug}.svg`);
	writeNeutralized(svgPath, svg);
	writeHtmlAsset({
		slug,
		title,
		kicker,
		caption,
		body: `<div class="svg-frame">${svg}</div>`,
		command,
		claim,
	});
}

function writeFailureAsset(label, command, result) {
	const slug = slugify(`failure-${label}`);
	writeHtmlAsset({
		slug,
		title: `Falha — ${label}`,
		kicker: "capture-writeup-assets",
		caption: "Esta captura registra por que um material não pôde ser gerado nesta execução.",
		body: `<pre>${escapeHtml((result.stderr || result.stdout || "").slice(0, 12000))}</pre>`,
		command,
		claim: "Falhas também são evidência operacional: não inventar print quando o comando não executa.",
	});
}

function screenshot(htmlPath, pngPath) {
	if (skipScreenshots) return false;
	if (!chrome) {
		failures.push({ label: "chrome", message: "google-chrome not found; HTML assets were written without PNG screenshots." });
		return false;
	}
	const result = spawnSync(chrome, [
		"--headless=new",
		"--disable-gpu",
		"--no-sandbox",
		"--hide-scrollbars",
		"--allow-file-access-from-files",
		"--window-size=1440,1100",
		`--screenshot=${pngPath}`,
		pathToFileURL(htmlPath).href,
	], { encoding: "utf8", maxBuffer: 1024 * 1024 });
	if (result.status !== 0 || !existsSync(pngPath)) {
		failures.push({ label: `screenshot ${path.basename(htmlPath)}`, status: result.status, message: result.stderr || result.stdout });
		return false;
	}
	return true;
}

function copyReferenceDiagrams() {
	const refs = [
		["t1", "examples/devbench-t1/diagrams"],
		["t2", "examples/wallet-t2/diagrams"],
		["t3", "examples/reqbench-t3/diagrams"],
	];
	for (const [prefix, rel] of refs) {
		if (!selected.has(prefix)) continue;
		const srcDir = path.join(repoRoot, rel);
		if (!existsSync(srcDir)) continue;
		for (const name of readdirSync(srcDir)) {
			if (!name.endsWith(".svg")) continue;
			const dest = path.join(diagramsDir, `${prefix}-${name}`);
			copyFileSync(path.join(srcDir, name), dest);
		}
	}
}

function copyReportRecords() {
	const reportRoot = path.join(outDir, ".dgk", "report");
	if (!existsSync(reportRoot)) return;
	for (const name of readdirSync(reportRoot)) {
		const src = path.join(reportRoot, name);
		const dest = path.join(recordsDir, name);
		copyFileSync(src, dest);
	}
}

function writeIndexes() {
	const md = [
		"# Capturas para escrita dos trabalhos",
		"",
		`Gerado em: ${new Date().toISOString()}`,
		`Saída: \`${outDir}\``,
		"",
		"## Como usar",
		"",
		"Use as imagens em `png/` como prints prontos. Os arquivos em `html/` são a fonte reproduzível de cada print; `svg/`, `diagrams/` e `records/` guardam material vetorial e relatórios.",
		"",
		"## Shot list com legenda pronta",
		"",
		"| Arquivo | Legenda curta | Claim que sustenta | Comando |",
		"| --- | --- | --- | --- |",
		...assets.map((asset) => `| ${asset.png ? `\`png/${path.basename(asset.png)}\`` : `\`html/${path.basename(asset.html)}\``} | ${escapeMd(asset.caption)} | ${escapeMd(asset.claim)} | \`${escapeMd(asset.command)}\` |`),
		"",
		"## Limites honestos para a escrita",
		"",
		"- T1: não afirmar governança de plugins em produção; afirmar prova local de decisão, recusa, auditoria e resiliência.",
		"- T2: não afirmar conformidade LGPD/W3C/EUDI certificada; afirmar carteira local-first com consentimento e disclosure auditáveis.",
		"- T3: não afirmar integração ALM/vault de produção completa; afirmar materialização reprodutível, busca, rastreabilidade e saúde do corpus em POC.",
		"",
	];
	if (failures.length > 0) {
		md.push("## Falhas / avisos", "");
		for (const failure of failures) md.push(`- **${failure.label}**: ${String(failure.message ?? "").split("\n")[0]}`);
		md.push("");
	}
	writeNeutralized(path.join(outDir, "INDEX.md"), md.join("\n"));

	const htmlIndex = [
		wrapHtml({
			title: "Capturas para escrita dos trabalhos",
			kicker: "Refarm POCs",
			caption: "Galeria local das capturas geradas automaticamente.",
			body: `<div class="gallery">${assets.map(renderGalleryCard).join("\n")}</div>`,
			command: "node scripts/capture-writeup-assets.mjs",
			claim: "Poucos registros fortes valem mais que muitos diagramas maçantes.",
		}),
	].join("\n");
	writeNeutralized(path.join(outDir, "index.html"), htmlIndex);
}

function renderGalleryCard(asset) {
	const img = asset.png ? `<img src="png/${escapeHtml(path.basename(asset.png))}" alt="${escapeHtml(asset.title)}" />` : "";
	return `<article class="gallery-card">${img}<h2>${escapeHtml(asset.title)}</h2><p>${escapeHtml(asset.caption)}</p><p class="claim">${escapeHtml(asset.claim)}</p></article>`;
}

function renderT1Extension(extension) {
	const surfaced = Array.isArray(extension.surfaced) ? extension.surfaced : [];
	const apiLinks = Array.isArray(extension.apiLinks) ? extension.apiLinks : [];
	return `<section class="refarm-stack">
		<div class="metric-row">
			<div class="metric"><span>${escapeHtml(String(extension.declared?.length ?? 0))}</span><small>capacidades declaradas</small></div>
			<div class="metric"><span>${escapeHtml(String(surfaced.length))}</span><small>verbos sintetizados</small></div>
			<div class="metric"><span>${escapeHtml(String(apiLinks.length))}</span><small>links SPI</small></div>
		</div>
		<table class="refarm-table"><thead><tr><th>Verbo</th><th>Resumo</th><th>Superfícies</th></tr></thead><tbody>
		${surfaced.map((row) => `<tr><td><code>${escapeHtml(row.verb)}</code></td><td>${escapeHtml(row.summary ?? "")}</td><td>${escapeHtml((row.surfaces ?? []).join(" · "))}</td></tr>`).join("")}
		</tbody></table>
		<p class="refarm-note">${escapeHtml(extension.note ?? "")}</p>
	</section>`;
}

function renderSearchResults(search) {
	const rows = Array.isArray(search.results) ? search.results : [];
	return `<section class="refarm-stack">
		<div class="metric-row">
			<div class="metric"><span>${escapeHtml(String(search.matched ?? rows.length))}</span><small>matches</small></div>
			<div class="metric"><span>${escapeHtml(String(search.scope?.searched ?? "?"))}</span><small>registros pesquisados</small></div>
		</div>
		<table class="refarm-table"><thead><tr><th>Requisito</th><th>Tipo</th><th>Score</th></tr></thead><tbody>
		${rows.map((row) => `<tr><td><code>${escapeHtml(row.recordId ?? "")}</code><br/>${escapeHtml(row.title ?? "")}</td><td>${escapeHtml(row.tipo ?? "")}</td><td>${escapeHtml(String(row.score ?? ""))}</td></tr>`).join("")}
		</tbody></table>
	</section>`;
}

function renderAgentPluginFlow(agentManifest, lspManifest, liveAsk) {
	const agentVerbs = manifestVerbNames(agentManifest);
	const lspVerbs = manifestVerbNames(lspManifest);
	const answer = liveAsk?.content ? `<p class="refarm-note"><strong>Registro real:</strong> ${escapeHtml(liveAsk.content)}</p>` : "";
	return `<section class="refarm-stack">
		<div class="flow-map" role="img" aria-label="Fluxo: usuário chama o agente; agente usa ferramentas contribuídas por plugins; lsp-code-ops chama o LSP; o runtime audita.">
			<div class="flow-node flow-node--user"><span>Operador</span><small>pedido / verificação</small></div>
			<div class="flow-arrow">→</div>
			<div class="flow-node flow-node--agent"><span>${escapeHtml(agentManifest.id)}</span><small>${agentVerbs.join(" · ")}</small></div>
			<div class="flow-arrow">→</div>
			<div class="flow-node flow-node--tool"><span>${escapeHtml(lspManifest.id)}</span><small>${lspVerbs.join(" · ")}</small></div>
			<div class="flow-arrow">→</div>
			<div class="flow-node flow-node--lsp"><span>LSP</span><small>referências · rename · move</small></div>
			<div class="flow-arrow">→</div>
			<div class="flow-node flow-node--audit"><span>Auditoria</span><small>task · stream · scarecrow</small></div>
		</div>
		<div class="metric-row">
			<div class="metric"><span>${escapeHtml(String((agentManifest.permissions ?? []).length))}</span><small>permissões do agent</small></div>
			<div class="metric"><span>${escapeHtml(String(lspVerbs.length))}</span><small>verbos LSP plugáveis</small></div>
			<div class="metric"><span>${escapeHtml(String(liveAsk?.ok === true ? "ok" : "doc"))}</span><small>registro live</small></div>
		</div>
		<table class="refarm-table"><thead><tr><th>Peça</th><th>Papel no trabalho</th><th>Limite honesto</th></tr></thead><tbody>
			<tr><td><code>${escapeHtml(agentManifest.id)}</code></td><td>Runtime agent como plugin carregado, não chat externo; responde via <code>integration:respond</code>.</td><td>Prova POC local; não medir qualidade do modelo.</td></tr>
			<tr><td><code>${escapeHtml(lspManifest.id)}</code></td><td>Plugin efeito-capable que acrescenta operações semânticas de código ao agente via <code>code-ops</code>.</td><td>Usa LSP/fake LSP de demonstração; não é scanner completo.</td></tr>
			<tr><td><code>tractor</code></td><td>Carrega componentes WASM, aplica permissões e registra efeitos.</td><td>Governança demonstrada localmente, não certificação de produção.</td></tr>
		</tbody></table>
		${answer}
	</section>`;
}

function renderAgentTelemetry(telemetry) {
	const calls = telemetry.timeline.toolCalls ?? [];
	const traceSteps = telemetry.trace?.steps ?? [];
	return `<section class="refarm-stack">
		<div class="metric-row">
			<div class="metric"><span>${escapeHtml(String(telemetry.timeline.iterations ?? "?"))}</span><small>iterações</small></div>
			<div class="metric"><span>${escapeHtml(String(calls.length))}</span><small>tool calls</small></div>
			<div class="metric"><span>${escapeHtml(String(telemetry.trace?.effectCount ?? "?"))}</span><small>efeitos de host</small></div>
		</div>
		<table class="refarm-table"><thead><tr><th>Camada</th><th>Evidência</th><th>Valor para gestão</th></tr></thead><tbody>
			<tr><td>Rota</td><td><code>${escapeHtml(telemetry.timeline.route?.provider ?? "?")}/${escapeHtml(telemetry.timeline.route?.model ?? "?")}</code></td><td>Mostra qual provedor/modelo executou a decisão.</td></tr>
			<tr><td>Loop</td><td>${escapeHtml(String(telemetry.timeline.iterations ?? "?"))}/${escapeHtml(String(telemetry.timeline.maxIterations ?? "?"))} iterações</td><td>Evita tratar o agente como caixa-preta.</td></tr>
			<tr><td>Tokens</td><td>${escapeHtml(String(telemetry.timeline.tokensIn ?? 0))} in · ${escapeHtml(String(telemetry.timeline.tokensOut ?? 0))} out</td><td>Base para custo, quota e governança operacional.</td></tr>
			<tr><td>Outcome</td><td><span class="refarm-badge refarm-badge-ok">${escapeHtml(telemetry.timeline.outcome ?? "?")}</span></td><td>Resultado observável da execução.</td></tr>
		</tbody></table>
		<table class="refarm-table"><thead><tr><th>Tool</th><th>Argumentos</th><th>Efeitos correlacionados</th></tr></thead><tbody>
			${calls.map((call, index) => `<tr><td><code>${escapeHtml(call.tool)}</code></td><td>${escapeHtml(call.argsSummary ?? "")}</td><td>${escapeHtml((traceSteps[index]?.effects ?? []).map((effect) => effect.event).join(" · ") || "—")}</td></tr>`).join("")}
		</tbody></table>
	</section>`;
}

function renderCodeOpsValue(references, rename) {
	const refs = Array.isArray(references.result) ? references.result : [];
	return `<section class="refarm-stack">
		<div class="metric-row">
			<div class="metric"><span>${escapeHtml(String(refs.length))}</span><small>referências LSP</small></div>
			<div class="metric"><span>${escapeHtml(String(rename.result?.editsApplied ?? "?"))}</span><small>edições aplicadas</small></div>
			<div class="metric"><span>${escapeHtml(String(rename.result?.filesChanged ?? "?"))}</span><small>arquivos mudados</small></div>
		</div>
		<table class="refarm-table"><thead><tr><th>Referência</th><th>Arquivo</th><th>Por que importa</th></tr></thead><tbody>
			${refs.map((ref, index) => `<tr><td>#${index + 1} · linha ${escapeHtml(ref.line)} col ${escapeHtml(ref.column)}</td><td><code>${escapeHtml(shortenPath(ref.file))}</code></td><td>${escapeHtml(ref.kind ?? "reference")} localizado pelo servidor de linguagem, não por busca textual.</td></tr>`).join("")}
		</tbody></table>
		<div class="value-strip">
			<div><strong>Uso análogo a vulnerabilidades:</strong> o agente recebe um achado ou suspeita, chama <code>code-ops_find-references</code> para mapear todos os usos de uma API/símbolo crítico, e só então propõe patch ou revisão.</div>
			<div><strong>Honestidade:</strong> isto não é um scanner de CVE; é o substrato agentic que torna a verificação e a correção menos manuais e mais auditáveis.</div>
		</div>
	</section>`;
}

function manifestVerbNames(manifest) {
	return Object.keys(manifest?.capabilities?.verbs?.list ?? {});
}

function shortenPath(file) {
	const value = String(file ?? "");
	const repoRelative = path.relative(repoRoot, value);
	if (repoRelative && !repoRelative.startsWith("..")) return repoRelative;
	const parts = value.split(/[\\/]/).filter(Boolean);
	return parts.slice(-3).join("/") || value;
}

function readJsonFile(file) {
	try {
		if (!existsSync(file)) return null;
		return JSON.parse(readFileSync(file, "utf8"));
	} catch {
		return null;
	}
}

function wrapHtml({ title, kicker, caption, body, command, claim }) {
	return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)}</title>
<style>
:root { color-scheme: light; --bg:#f4f7f1; --card:#ffffff; --ink:#122016; --muted:#5e6d61; --accent:#2f8a4d; --accent2:#255c99; --line:#d9e2d8; --warn:#b7791f; --danger:#b83232; --ok:#2f8a4d; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
* { box-sizing: border-box; }
body { margin: 0; background: radial-gradient(circle at 12% 10%, #e3f5dd 0, transparent 22rem), linear-gradient(135deg, #f7faf5, var(--bg)); color: var(--ink); }
.capture { width: min(1180px, calc(100vw - 72px)); margin: 36px auto; }
.hero { display: grid; grid-template-columns: 1.15fr .85fr; gap: 18px; align-items: stretch; margin-bottom: 18px; }
.panel, .surface-card, .refarm-surface-card, .gallery-card { background: rgba(255,255,255,.92); border: 1px solid var(--line); border-radius: 22px; box-shadow: 0 18px 50px rgba(20, 60, 28, .12); }
.panel { padding: 24px; }
.eyebrow, .refarm-eyebrow { color: var(--accent); text-transform: uppercase; letter-spacing: .1em; font-size: 12px; font-weight: 750; margin: 0 0 8px; }
h1 { font-size: clamp(32px, 4vw, 58px); line-height: 1.02; margin: 0; letter-spacing: -.04em; }
h2, h3 { margin: .15rem 0 .6rem; letter-spacing: -.02em; }
p { line-height: 1.55; }
.caption { color: var(--muted); font-size: 18px; margin: 12px 0 0; }
.claim { border-left: 4px solid var(--accent); padding-left: 14px; color: #28452e; font-weight: 650; }
.command { color: var(--muted); font: 13px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; overflow-wrap: anywhere; }
.content { padding: 26px; }
.refarm-stack { display: flex; flex-direction: column; gap: 14px; }
.refarm-card-row { display:flex; align-items:center; justify-content:space-between; gap: 14px; }
.refarm-surface-card { padding: 16px 18px; }
.refarm-muted, .refarm-note { color: var(--muted); }
.refarm-badge, .governance-gate { display:inline-flex; border-radius:999px; padding: 5px 10px; font-size: 12px; font-weight: 800; background:#edf7ed; color: var(--ok); border:1px solid #cfe8d1; }
.refarm-badge-muted { background:#f5f5f0; color:#5f665b; border-color:#e1e4da; }
.refarm-badge-ok, .governance-gate--continue { background:#e8f7ec; color: var(--ok); border-color:#bfe8c8; }
.refarm-code, code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; color:#1b5e37; text-decoration: none; }
.refarm-table, .governance-table, .vault-overview-coverage, .sovereignty-disclosures { width:100%; border-collapse: separate; border-spacing: 0; overflow:hidden; border:1px solid var(--line); border-radius: 16px; background: #fff; }
th, td { padding: 11px 13px; text-align:left; border-bottom:1px solid var(--line); vertical-align: top; }
th { background:#edf5ea; color:#27452d; font-size: 12px; text-transform: uppercase; letter-spacing:.06em; }
tr:last-child td { border-bottom:0; }
.num { text-align:right; font-variant-numeric: tabular-nums; }
.outcome { font-weight:800; }
.outcome--completed { color: var(--ok); } .outcome--blocked, .outcome--aborted { color: var(--danger); } .outcome--isolated { color: var(--warn); }
.metric-row { display:grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
.metric { background:#f7fbf6; border:1px solid var(--line); border-radius:18px; padding:16px; }
.metric span { display:block; font-size:32px; font-weight:850; color: var(--accent); }
.metric small { color:var(--muted); text-transform:uppercase; letter-spacing:.08em; }
.flow-map { display:grid; grid-template-columns: 1fr auto 1.2fr auto 1.2fr auto 1fr auto 1fr; gap: 10px; align-items:center; }
.flow-node { min-height: 112px; border:1px solid var(--line); border-radius:20px; padding:15px; background:#f8fbf6; display:flex; flex-direction:column; justify-content:center; box-shadow: inset 0 0 0 1px rgba(255,255,255,.65); }
.flow-node span { font-weight:850; color:#17391f; overflow-wrap:anywhere; }
.flow-node small { color:var(--muted); margin-top:6px; line-height:1.35; }
.flow-node--agent { background:#e8f7ec; border-color:#bfe8c8; }
.flow-node--tool { background:#eaf2ff; border-color:#c7d8f6; }
.flow-node--audit { background:#fff7e8; border-color:#f0d8a8; }
.flow-arrow { color:var(--accent); font-size:28px; font-weight:900; text-align:center; }
.value-strip { display:grid; grid-template-columns:1fr 1fr; gap:12px; }
.value-strip > div { border:1px solid var(--line); border-radius:18px; padding:16px; background:#f8fbf6; line-height:1.5; }
.svg-frame { background:#fff; border-radius:18px; padding: 12px; overflow:hidden; }
.svg-frame svg, svg.surveyor-graph { width:100%; min-height: 620px; display:block; }
ul { margin-top: 0; }
pre { white-space: pre-wrap; word-break: break-word; background:#102017; color:#e8f7ec; border-radius:18px; padding:18px; font-size: 13px; line-height: 1.5; }
.gallery { display:grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 18px; }
.gallery-card { padding: 16px; }
.gallery-card img { width:100%; border-radius:14px; border:1px solid var(--line); display:block; }
@media (max-width: 860px) { .hero { grid-template-columns: 1fr; } .metric-row, .flow-map, .value-strip { grid-template-columns: 1fr; } .flow-arrow { transform: rotate(90deg); } .capture { width: min(100vw - 28px, 1180px); margin: 14px auto; } }
</style>
</head>
<body>
<main class="capture">
  <section class="hero">
    <div class="panel">
      <p class="eyebrow">${escapeHtml(kicker)}</p>
      <h1>${escapeHtml(title)}</h1>
      <p class="caption">${escapeHtml(caption)}</p>
    </div>
    <aside class="panel">
      <p class="eyebrow">O que a figura mostra</p>
      <p class="claim">${escapeHtml(claim)}</p>
      <p class="eyebrow">Como reproduzir</p>
      <p class="command">${escapeHtml(command)}</p>
    </aside>
  </section>
  <section class="panel content">${body}</section>
</main>
</body>
</html>`;
}

function parseArgs(argv) {
	const parsed = {};
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (!arg.startsWith("--")) continue;
		const key = arg.slice(2);
		if (key === "build" || key === "no-screenshots") {
			parsed[key] = true;
			continue;
		}
		const value = argv[i + 1];
		if (value && !value.startsWith("--")) {
			parsed[key] = value;
			i++;
		} else {
			parsed[key] = true;
		}
	}
	return parsed;
}

function findCommand(name) {
	const paths = String(process.env.PATH ?? "").split(path.delimiter);
	for (const dir of paths) {
		const candidate = path.join(dir, name);
		if (existsSync(candidate)) return candidate;
	}
	return null;
}

function timestampSlug(date) {
	return date.toISOString().replace(/[:.]/g, "-");
}

function slugify(value) {
	return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function escapeHtml(value) {
	return String(value ?? "")
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

function escapeMd(value) {
	return String(value ?? "").replace(/\|/g, "\\|").replace(/`/g, "\\`").replace(/\n/g, " ");
}
