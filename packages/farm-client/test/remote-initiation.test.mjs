import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import {
	catalogLines,
	classifyCancelResponse,
	classifyOperationStatus,
	classifyStartResponse,
	OPERATIONS_PATH,
	operationStatusPath,
	parseOperationResult,
	operationCancelPath,
	parseOperationCatalog,
	REMOTE_INITIATION_WIRE,
	startRequestBody,
} from "../src/remote-initiation.mjs";

const KIT_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

test("the route and the wire are the node's, spelled once", () => {
	assert.equal(OPERATIONS_PATH, "/operations");
	assert.equal(REMOTE_INITIATION_WIRE, "remote-initiation.v1");
});

// ── LISTAR ────────────────────────────────────────────────────────────────────

/** O CÓDIGO de um arquivo, sem os comentários — uma regra sobre o que o kit FAZ
 *  não pode ser quebrada por uma frase que só explica por quê. */
async function codeOf(...parts) {
	const source = await readFile(join(KIT_ROOT, ...parts), "utf8");
	return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");
}

test("the catalog is the NODE's, relayed — this kit holds no table of its own", async () => {
	// A regra que este teste protege: nenhum código do kit lista operações. Uma
	// segunda cópia da tabela divergiria da do nó calada, e é justamente uma
	// pergunta de segurança.
	for (const file of [
		["src", "remote-initiation.mjs"],
		["bin", "farm-start.mjs"],
	]) {
		const code = await codeOf(...file);
		assert.equal(
			code.includes("delivery add"),
			false,
			`${file.join("/")} must not hard-code an operation id`,
		);
	}

	// E a consequência, com o nó calado: o kit não oferece nada de si.
	assert.deepEqual(parseOperationCatalog({ catalog: { operations: [] } }), []);
	assert.match(catalogLines([]).join("\n"), /Nenhuma opera/);
});

test("parseOperationCatalog reads what the node relayed, and refuses what is not a catalog", () => {
	const body = {
		wire: REMOTE_INITIATION_WIRE,
		catalog: {
			ok: true,
			operations: [
				{ id: "delivery add", command: "refarm delivery add", why: "porque sim" },
				// Sem id: descartada, nunca inventada.
				{ command: "refarm nope" },
				// Sem `command`/`why`: aceita, com o que dá para dizer honestamente.
				{ id: "outra coisa" },
			],
		},
	};
	assert.deepEqual(parseOperationCatalog(body), [
		{ id: "delivery add", command: "refarm delivery add", why: "porque sim" },
		{ id: "outra coisa", command: "refarm outra coisa", why: "" },
	]);

	for (const notACatalog of [null, {}, { catalog: {} }, { catalog: { operations: "x" } }]) {
		assert.equal(parseOperationCatalog(notACatalog), null);
	}
});

test("an empty catalog says the door is shut, not that something broke", () => {
	const lines = catalogLines([]).join("\n");
	assert.match(lines, /Nenhuma opera/);
	assert.match(lines, /Sil[êe]ncio é fechado|fechado/);
});

test("the listing tells the operator exactly what to type next", () => {
	const lines = catalogLines([
		{ id: "delivery add", command: "refarm delivery add", why: "configura um canal" },
	]);
	const text = lines.join("\n");
	assert.match(text, /delivery add/);
	assert.match(text, /refarm delivery add/);
	assert.match(text, /configura um canal/);
	assert.match(text, /farm-start "delivery add"/);
});

// ── COMEÇAR ───────────────────────────────────────────────────────────────────

test("the request body has ONE field and carries the id whole", () => {
	// A regra do nó, do lado do aparelho: um identificador, inteiro, num campo. Não
	// existe argv aqui para ser montado, e por isso não existe argv para escapar.
	for (const id of ["delivery add", "delivery add; rm -rf ~", "", "a\nb", "🌾"]) {
		const body = startRequestBody(id);
		assert.deepEqual(Object.keys(body), ["operation"]);
		assert.equal(body.operation, id);
		assert.equal(JSON.parse(JSON.stringify(body)).operation, id);
	}
});

test("started says WHERE the questions will show up, and that the output will not", () => {
	const verdict = classifyStartResponse(202, {
		wire: REMOTE_INITIATION_WIRE,
		started: true,
		operation: "delivery add",
	});
	assert.equal(verdict.outcome, "started");
	assert.equal(verdict.exitCode, 0);
	const text = verdict.lines.join("\n");
	assert.match(text, /delivery add/);
	assert.match(text, /farm-attend/);
	assert.match(text, /NÃO viaja/);
});

test("a started run carries one follow-up command, not a terminal stream", () => {
	const verdict = classifyStartResponse(202, {
		started: true,
		operation: "workspace:home:refresh",
		runId: "r-one",
	});
	assert.match(verdict.lines.join("\n"), /farm-start --status r-one/);
	assert.equal(operationStatusPath("r/a b"), "/operations/r%2Fa%20b");
	assert.equal(operationCancelPath("r/a b"), "/operations/r%2Fa%20b/cancel");
});

test("operation lifecycle keeps running, success, failure, and expiry distinct", () => {
	for (const [state, exitCode, outcome] of [
		["running", null, "running"],
		["succeeded", 0, "succeeded"],
		["failed", 7, "failed"],
		["cancelled", null, "cancelled"],
	]) {
		const verdict = classifyOperationStatus(200, {
			runId: "r-one",
			operation: "workspace:home:refresh",
			state,
			exitCode,
		});
		assert.equal(verdict.outcome, outcome);
		assert.match(verdict.lines.join("\n"), /r-one/);
	}
	assert.equal(classifyOperationStatus(404, { error: "unknown-run" }).outcome, "unknown-run");
});

test("a bounded structured result is shown without opening stdout", () => {
	const result = {
		wire: "operation-result.v1",
		status: "issues",
		summary: "One boundary is missing.",
		metrics: [{ name: "issueCount", value: 1 }],
		findings: [{ code: "missing-boundary", summary: "Package needs a rule.", location: "package.json" }],
		truncated: false,
		redactionCount: 0,
	};
	assert.equal(parseOperationResult(result), result);
	const verdict = classifyOperationStatus(200, {
		runId: "r-one",
		operation: "workspace:home:check",
		state: "failed",
		exitCode: 1,
		result,
	});
	assert.match(verdict.lines.join("\n"), /One boundary is missing/);
	assert.match(verdict.lines.join("\n"), /missing-boundary/);
	assert.equal(parseOperationResult({ ...result, stdout: "secret" }), null);
});

test("cancellation keeps requested, finished, unknown and unauthorized distinct", () => {
	assert.equal(classifyCancelResponse(202, { state: "cancelling", runId: "r-1" }).outcome, "cancelling");
	assert.equal(classifyCancelResponse(409, { error: "run-finished" }).outcome, "run-finished");
	assert.equal(classifyCancelResponse(404, { error: "unknown-run" }).outcome, "unknown-run");
	assert.equal(classifyCancelResponse(401, {}).outcome, "not-authorized");
});

test("the five answers are five, and none of them is 'tente de novo'", () => {
	// A distinção é o ponto. Um aparelho que colapsasse isso mandaria o operador
	// tentar de novo uma coisa que nunca vai funcionar.
	const cases = [
		[202, { started: true, operation: "delivery add" }, "started"],
		[404, { error: "unknown-operation", detail: "não tem" }, "unknown-operation"],
		[403, { error: "not-remotely-invocable", detail: "fechada" }, "not-remotely-invocable"],
		[401, {}, "not-authorized"],
		[409, { error: "already-running", running: "delivery add" }, "already-running"],
		[503, { error: "could-not-start", detail: "sem refarm no spawnEnv.path" }, "could-not-start"],
	];
	const seen = new Set();
	for (const [status, body, expected] of cases) {
		const verdict = classifyStartResponse(status, body);
		assert.equal(verdict.outcome, expected, `${status} → ${expected}`);
		seen.add(verdict.outcome);
		assert.ok(verdict.lines.length > 0, "every answer says something");
	}
	assert.equal(seen.size, cases.length, "no two statuses collapse into one answer");
});

test("an insufficient credential is told WHAT authority it is missing", () => {
	const verdict = classifyStartResponse(401, {});
	assert.equal(verdict.outcome, "not-authorized");
	const text = verdict.lines.join("\n");
	assert.match(text, /operation:start/);
	assert.match(text, /FARM_TOKEN/);
});

test("a 403 that names not-remotely-invocable is a shut door, not a typo", () => {
	const verdict = classifyStartResponse(403, {
		error: "not-remotely-invocable",
		detail: "silêncio é fechado",
	});
	assert.equal(verdict.outcome, "not-remotely-invocable");
	assert.match(verdict.lines.join("\n"), /silêncio é fechado/);
	assert.notEqual(verdict.outcome, "unknown-operation");
});

test("the ceiling explains itself — one at a time, and why", () => {
	const named = classifyStartResponse(409, { error: "already-running", running: "delivery add", runId: "r-one" });
	assert.equal(named.outcome, "already-running");
	assert.match(named.lines.join("\n"), /delivery add/);
	assert.match(named.lines.join("\n"), /MESMA lista/);
	assert.match(named.lines.join("\n"), /farm-start --cancel r-one/);

	// O nó não diz o nome enquanto não confirmou que aquilo é uma operação declarada
	// — os bytes de um chamador não vazam para outro. O aparelho não inventa um.
	const unnamed = classifyStartResponse(409, { error: "already-running", running: null });
	assert.equal(unnamed.outcome, "already-running");
	assert.equal(
		unnamed.lines.some((line) => line.includes("null")),
		false,
	);
});

test("could-not-start repeats the node's own detail, because the fix is there", () => {
	const verdict = classifyStartResponse(503, {
		error: "could-not-start",
		detail: "no executable `refarm` on this node's declared spawnEnv.path (3 entries)",
	});
	assert.equal(verdict.outcome, "could-not-start");
	assert.match(verdict.lines.join("\n"), /spawnEnv\.path/);

	// E um status sem detalhe ainda diz alguma coisa útil, nunca uma linha vazia.
	const bare = classifyStartResponse(500, {});
	assert.equal(bare.outcome, "could-not-start");
	assert.match(bare.lines.join("\n"), /500/);
});
