import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

import {
	createPendingPromptHub,
	createRemoteOperatorChannel,
	handlePendingPromptHttp,
} from "../vendor/prompt-contract-v1.mjs";

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

/** A node that speaks exactly the two routes the kit needs, plus the `/plugins`
 *  liveness probe every kit command uses to decide the farm is reachable. */
async function startNode({ authenticatedDevice = "pixel-7" } = {}) {
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
			res.writeHead(response.status, { "content-type": "application/json" });
			res.end(JSON.stringify(response.body));
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
after(async () => {
	for (const node of running) await node.close();
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
	return { child, done };
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

	node.hub.list()[0] && node.hub.answer(node.hub.list()[0].id, "cleanup", "pixel-7");
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

	const { child, done } = runAttend(node.port, { keepStdinOpen: true });
	// Let the command render the prompt, then settle it from somewhere else —
	// the terminal that asked, in this case — before its answer arrives.
	await new Promise((resolve) => setTimeout(resolve, 400));
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
