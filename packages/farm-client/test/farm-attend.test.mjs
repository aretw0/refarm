import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { afterEach, test } from "node:test";
import { fileURLToPath } from "node:url";

import {
	createPendingPromptHub,
	createRemoteOperatorChannel,
	handlePendingPromptHttp,
} from "../vendor/prompt-contract-v1/dist/index.js";

/**
 * The kit command, end to end, against a THROWAWAY node — never the operator's.
 *
 * The whole point of the slice is that a phone answers a question the node asked
 * without any wizard changing, so the thing worth proving is the round trip: an
 * asker blocks on `OperatorChannel`, the question appears over HTTP, the kit
 * renders it THROUGH THE VENDORED BLOCK, and the answer settles the asker.
 *
 * The server here is the same `handlePendingPromptHttp` the node would mount —
 * imported from `vendor/`, so this also proves the vendored copy is the block.
 */

const KIT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const ATTEND = join(KIT_DIR, "bin", "farm-attend.mjs");

/** Bind somewhere in the 439xx range reserved for this suite, never on a port a
 *  real runtime uses. */
async function listenLocal(handler) {
	const server = createServer(handler);
	for (let port = 43901; port <= 43919; port++) {
		const bound = await new Promise((resolve) => {
			server.once("error", () => resolve(false));
			server.listen(port, "127.0.0.1", () => resolve(true));
		});
		if (bound) return { server, port };
		server.removeAllListeners("error");
	}
	throw new Error("no free port in 43901-43919");
}

/**
 * A node that speaks exactly the two routes the kit needs, plus the `/plugins`
 * liveness probe every kit command uses to decide the farm is reachable.
 *
 * `declaredWire` rewrites what `GET /prompts` declares, which is the only way to
 * stand a SKEWED node up: `undefined` leaves the block's own declaration alone,
 * a string overrides it, and `null` removes the field entirely — the shape a
 * node older than the declaration serves, and the shape any frozen side produces
 * for a field it never learned about.
 */
async function startNode({ authenticatedDevice = "pixel-7", declaredWire } = {}) {
	const hub = createPendingPromptHub();
	const { server, port } = await listenLocal((req, res) => {
		const url = new URL(req.url, "http://127.0.0.1");
		if (url.pathname === "/plugins") {
			res.writeHead(200, { "content-type": "application/json" });
			res.end("[]");
			return;
		}
		const chunks = [];
		req.on("data", (chunk) => chunks.push(chunk));
		req.on("end", () => {
			let body;
			try {
				body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : undefined;
			} catch {
				body = undefined;
			}
			const response = handlePendingPromptHttp(hub, {
				method: req.method,
				path: url.pathname,
				body,
				authenticatedDevice,
			});
			let served = response.body;
			if (declaredWire !== undefined && url.pathname === "/prompts") {
				served = { ...served };
				if (declaredWire === null) delete served.wire;
				else served.wire = declaredWire;
			}
			res.writeHead(response.status, { "content-type": "application/json" });
			res.end(JSON.stringify(served));
		});
	});
	return {
		hub,
		port,
		async close() {
			await new Promise((resolve) => server.close(resolve));
		},
	};
}

const running = [];
afterEach(async () => {
	for (const node of running.splice(0)) await node.close();
});

async function startNodeTracked(options) {
	const node = await startNode(options);
	running.push(node);
	return node;
}

/** Run the kit command against the throwaway node, feeding it `stdin`. */
function runAttend(port, { stdin = "", args = [], env = {}, keepStdinOpen = false } = {}) {
	const child = spawn(process.execPath, [ATTEND, ...args], {
		env: {
			...process.env,
			FARM_HOST: "127.0.0.1",
			FARM_HTTP_PORT: String(port),
			NO_COLOR: "1",
			...env,
		},
		stdio: ["pipe", "pipe", "pipe"],
	});
	let stdout = "";
	let stderr = "";
	child.stdout.on("data", (chunk) => (stdout += String(chunk)));
	child.stderr.on("data", (chunk) => (stderr += String(chunk)));
	if (stdin) child.stdin.write(stdin);
	if (!keepStdinOpen) child.stdin.end();
	const done = new Promise((resolve) => {
		child.on("close", (code) => resolve({ code, stdout, stderr, output: `${stdout}\n${stderr}` }));
	});
	/** Resolve once the command has PRINTED something matching `pattern` — the only honest way
	 *  to know it reached a given point. A fixed sleep guesses how fast the child starts, and on a
	 *  cold, saturated runner it guessed wrong (PR #59, 2026-08-30). */
	const waitForOutput = (pattern, timeoutMs = 15_000) =>
		new Promise((resolve, reject) => {
			const startedAt = Date.now();
			const tick = () => {
				if (pattern.test(stdout)) return resolve(stdout);
				if (Date.now() - startedAt > timeoutMs) {
					return reject(new Error(`attend never printed ${pattern} — stdout so far:\n${stdout}\nstderr:\n${stderr}`));
				}
				setTimeout(tick, 20);
			};
			tick();
		});
	return { child, done, waitForOutput };
}

/** Wait until the node is holding a published question. */
async function waitForPending(hub) {
	for (let attempt = 0; attempt < 200; attempt++) {
		if (hub.list().length > 0) return hub.list()[0];
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
	throw new Error("no prompt was published");
}

const ASKER = { command: "refarm auth enroll", pid: process.pid, host: "test-node" };

test("says so, and exits clean, when nothing is pending", async () => {
	const node = await startNodeTracked();
	const { done } = runAttend(node.port);
	const result = await done;
	assert.equal(result.code, 0, result.output);
	assert.match(result.stdout, /nada pendente/);
});

test("lists a pending question without answering it", async () => {
	const node = await startNodeTracked();
	const channel = createRemoteOperatorChannel({ hub: node.hub, asker: ASKER });
	const asking = channel.ask({ type: "text", question: "Como se chama a sua fazenda?" });
	await waitForPending(node.hub);

	const { done } = runAttend(node.port, { args: ["--list"] });
	const result = await done;
	assert.equal(result.code, 0, result.output);
	assert.match(result.stdout, /Como se chama a sua fazenda\?/);
	assert.match(result.stdout, /refarm auth enroll/);
	// --list looks; it does not answer.
	assert.equal(node.hub.list().length, 1);

	const pending = node.hub.list()[0];
	if (pending) node.hub.answer(pending.id, "cleanup", "pixel-7");
	await asking;
});

test("answers a text question, and the blocked asker receives the value", async () => {
	const node = await startNodeTracked();
	const channel = createRemoteOperatorChannel({ hub: node.hub, asker: ASKER });
	const asking = channel.ask({ type: "text", question: "Como se chama a sua fazenda?" });
	await waitForPending(node.hub);

	const { done } = runAttend(node.port, { stdin: "serpro-1577853\n" });
	const result = await done;

	assert.equal(result.code, 0, result.output);
	assert.match(result.stdout, /Como se chama a sua fazenda\?/);
	assert.match(result.stdout, /respondido/);
	// The identity recorded is the GATE's, shown back to the device (P3).
	assert.match(result.stdout, /pixel-7/);
	assert.equal(await asking, "serpro-1577853");
	assert.equal(channel.lastSettlement().device, "pixel-7");
});

test("answers a select only with an option that was offered", async () => {
	const node = await startNodeTracked();
	const channel = createRemoteOperatorChannel({ hub: node.hub, asker: ASKER });
	const asking = channel.ask({
		type: "select",
		question: "Qual provedor?",
		options: [
			{ value: "openai", label: "OpenAI" },
			{ value: "anthropic", label: "Anthropic" },
		],
		default: "openai",
	});
	await waitForPending(node.hub);

	// The vendored block renders the numbered picker on a non-TTY stdin — the
	// same code path the terminal uses, which is the whole point of vendoring it.
	const { done } = runAttend(node.port, { stdin: "2\n" });
	const result = await done;

	assert.equal(result.code, 0, result.output);
	assert.match(result.stdout, /Anthropic/);
	assert.equal(await asking, "anthropic");
});

test("a secret answered from the device reaches the asker and appears NOWHERE else (P4)", async () => {
	const SECRET = "s3nh4-do-cofre-nunca-logar";
	const node = await startNodeTracked();
	const channel = createRemoteOperatorChannel({ hub: node.hub, asker: ASKER });
	const asking = channel.ask({ type: "secret", question: "Senha da VPN?" });
	const published = await waitForPending(node.hub);

	assert.equal(published.answerTravels, true);

	const { done } = runAttend(node.port, { stdin: `${SECRET}\n` });
	const result = await done;

	assert.equal(result.code, 0, result.output);
	// The device is TOLD the answer will travel, before it is typed.
	assert.match(result.stdout, /ATRAVESSA/);
	// The asker — and only the asker — gets the value.
	assert.equal(await asking, SECRET);
	// Nothing the command printed, on either stream, contains it.
	assert.ok(
		!result.output.includes(SECRET),
		"the secret must never appear in the command's output",
	);
	// Nor does the node's own record of who answered.
	assert.ok(!JSON.stringify(node.hub.settlementOf(published.id)).includes(SECRET));
});

test("is told it LOST the race, and by which device, instead of failing silently", async () => {
	const node = await startNodeTracked();
	const channel = createRemoteOperatorChannel({ hub: node.hub, asker: ASKER });
	const asking = channel.ask({ type: "text", question: "Qual o nome?" });
	const published = await waitForPending(node.hub);

	const { child, done, waitForOutput } = runAttend(node.port, { keepStdinOpen: true });
	// Wait until the command has RENDERED the prompt, then settle it from somewhere else —
	// the terminal that asked, in this case — before its answer arrives. Not a fixed sleep: with
	// 400 ms, a cold clean-room runner had not even fetched the question yet, so the command
	// reported "nada pendente" instead of losing a race it never entered.
	await waitForOutput(/Qual o nome\?/);
	node.hub.answer(published.id, "typed-at-the-desk", "tablet-1");
	child.stdin.end("late-answer\n");

	const result = await done;
	assert.match(result.stdout, /tarde demais/);
	assert.match(result.stdout, /tablet-1/);
	assert.equal(await asking, "typed-at-the-desk");
});

test("does not offer a question whose asker already gave up (P1/P5)", async () => {
	const node = await startNodeTracked();
	const channel = createRemoteOperatorChannel({ hub: node.hub, asker: ASKER, timeoutMs: 60 });
	const asking = channel.ask({ type: "text", question: "Pergunta que vai expirar" });
	await waitForPending(node.hub);
	await assert.rejects(asking, (error) => error.name === "OperatorPromptExpiredError");

	const { done } = runAttend(node.port);
	const result = await done;
	assert.equal(result.code, 0, result.output);
	assert.match(result.stdout, /nada pendente/);
	assert.doesNotMatch(result.stdout, /Pergunta que vai expirar/);
});

test("refuses to poll forever at a node that does not speak the wire", async () => {
	// A node older than this command. Saying so beats asking a silent endpoint
	// every two seconds until someone notices.
	const { server, port } = await listenLocal((req, res) => {
		if (req.url === "/plugins") {
			res.writeHead(200, { "content-type": "application/json" });
			res.end("[]");
			return;
		}
		res.writeHead(404, { "content-type": "application/json" });
		res.end('{"error":"not-found"}');
	});
	try {
		const { done } = runAttend(port, { args: ["--watch"] });
		const result = await done;
		assert.equal(result.code, 1);
		assert.match(result.stderr, /ainda não publica perguntas pendentes/);
	} finally {
		await new Promise((resolve) => server.close(resolve));
	}
});

// ── The declared wire version, honoured ───────────────────────────────────────
//
// The node has always declared `wire` on every `GET /prompts`. Until now nothing
// read it, which made it decoration: the three cases below are the whole reason
// it stops being decoration, and each is run against a real node over a real
// socket, through the same binary the operator's phone runs.

test("a node speaking THIS wire is proceeded with, and nothing is said about versions", async () => {
	const node = await startNodeTracked();
	const channel = createRemoteOperatorChannel({ hub: node.hub, asker: ASKER });
	const asking = channel.ask({ type: "text", question: "Qual o nome?" });
	await waitForPending(node.hub);

	const { done } = runAttend(node.port, { stdin: "compatível\n" });
	const result = await done;

	assert.equal(result.code, 0, result.output);
	assert.equal(await asking, "compatível");
	// Compatible is the silent case: a version that matches is not news.
	assert.ok(
		!/versão do fio/.test(result.output),
		`a matching version must say nothing:\n${result.output}`,
	);
});

test("a node speaking a wire this kit does not know is REFUSED, with the one command that fixes it", async () => {
	const node = await startNodeTracked({ declaredWire: "pending-prompt.v2" });
	const channel = createRemoteOperatorChannel({ hub: node.hub, asker: ASKER });
	const asking = channel.ask({ type: "text", question: "Qual o nome?" });
	const published = await waitForPending(node.hub);

	const { done } = runAttend(node.port, { stdin: "nunca deveria chegar\n" });
	const result = await done;

	assert.equal(result.code, 1, result.output);
	// What is old, what is new, and the ONE command.
	assert.match(result.stderr, /este kit fala: pending-prompt\.v1/);
	assert.match(result.stderr, /o nó fala:\s+pending-prompt\.v2/);
	assert.match(result.stderr, /farm-update/);
	// And the fallback that is true whatever happens.
	assert.match(result.stderr, /responda no terminal que perguntou/);
	// It refused rather than proceeding and hoping: the question was NOT drawn and
	// NOT answered. Without the check the parser would have dropped every entry and
	// the device would have shown "nada pendente" for a farm full of questions.
	assert.ok(!/Qual o nome\?/.test(result.stdout), result.output);
	assert.ok(!/nada pendente/.test(result.stdout), result.output);
	assert.equal(node.hub.list().length, 1);

	node.hub.answer(published.id, "cleanup", "pixel-7");
	await asking;
});

test("a skewed node is refused in --watch too — waiting does not change a version", async () => {
	const node = await startNodeTracked({ declaredWire: "pending-prompt.v2" });
	const { done } = runAttend(node.port, { args: ["--watch"] });
	const result = await done;
	assert.equal(result.code, 1, result.output);
	assert.match(result.stderr, /farm-update/);
});

test("a node that declares NOTHING is proceeded with — and said so once, not silently", async () => {
	// The unknown case, and the one with teeth: this is the shape a peer older than
	// the declaration serves. Refusing here would lock the operator out of a device
	// that works today, which is the opposite of what a safety mechanism is for.
	const node = await startNodeTracked({ declaredWire: null });
	const channel = createRemoteOperatorChannel({ hub: node.hub, asker: ASKER });
	const asking = channel.ask({ type: "text", question: "Qual o nome?" });
	await waitForPending(node.hub);

	const { done } = runAttend(node.port, { stdin: "ainda funciona\n" });
	const result = await done;

	// It still works, end to end: the question is drawn and the asker is unblocked.
	assert.equal(result.code, 0, result.output);
	assert.match(result.stdout, /Qual o nome\?/);
	assert.equal(await asking, "ainda funciona");
	// But it is NOT silent — "declared nothing" never masquerades as "checked and fine".
	assert.match(result.stderr, /não declarou a versão do fio/);
	assert.ok(!/farm-update/.test(result.stderr), "unknown is not a refusal");
});

test("the undeclared warning is said once per run, not once per poll", async () => {
	const node = await startNodeTracked({ declaredWire: null });
	const { child, done } = runAttend(node.port, { args: ["--watch"] });
	// Long enough for several empty rounds at the declared 2s floor plus backoff.
	await new Promise((resolve) => setTimeout(resolve, 5000));
	child.kill("SIGINT");
	const result = await done;
	const said = result.stderr.match(/não declarou a versão do fio/g) ?? [];
	assert.equal(said.length, 1, `warned ${said.length} times:\n${result.stderr}`);
});
