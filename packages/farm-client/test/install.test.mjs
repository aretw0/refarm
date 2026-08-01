import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";

const run = promisify(execFile);
const INSTALLER = new URL("../bootstrap/install.mjs", import.meta.url);

/** What `refarm dist publish` does to the template (apps/refarm bakeInstaller). */
function bake(template, { host, port }) {
	return template.replaceAll("__FARM_HOST__", host).replaceAll("__FARM_PORT__", String(port));
}

async function runInstaller(source, env) {
	const dir = await mkdtemp(join(tmpdir(), "farm-install-"));
	try {
		const file = join(dir, "install.mjs");
		await writeFile(file, source);
		// process.execPath, not "node": the test may run under a PATH-less env, and
		// what is under test is the installer's logic, not node's discoverability.
		return await run(process.execPath, [file], {
			env: { PATH: "/usr/bin:/bin", HOME: dir, FARM_KIT_DIR: join(dir, "kit"), FARM_BIN_DIR: join(dir, "bin"), ...env },
		}).then(
			(ok) => ({ code: 0, ...ok }),
			(err) => ({ code: err.code, stdout: err.stdout ?? "", stderr: err.stderr ?? "" }),
		);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}

test("a BAKED installer accepts its own baked farm — the cold-bootstrap one-liner", async () => {
	// The regression: the "nobody baked a host into me" guard was written as the
	// literal placeholder, so `bakeInstaller` substituted the guard along with the
	// value it guarded — `HOST === "serpro-1577853"` — and every baked installer
	// refused the farm it was baked for. The published one-liner
	// (`curl … | node --input-type=module -`) exited 2 before downloading a byte.
	const template = await readFile(INSTALLER, "utf8");
	// A DOCUMENTATION host (RFC 5737 TEST-NET-1) on port 1, never a real farm name.
	// The first version of this test baked `serpro-1577853` — the operator's actual
	// farm — and asserted it was unreachable, so it made a real network request to
	// their machine and passed only while that machine was DOWN. It went red the
	// moment the mesh server came up, which is the opposite of what a test should do.
	// The incident's data is not the test's fixture.
	const baked = bake(template, { host: "192.0.2.1", port: 1 });

	const result = await runInstaller(baked, { FARM_HOST: "" });
	assert.notEqual(result.code, 2, `baked installer refused its baked host:\n${result.stderr}`);
	assert.equal(
		result.stderr.includes("defina FARM_HOST"),
		false,
		"a baked installer must never ask for the host it already carries",
	);
	// It gets as far as the network, and TEST-NET-1:1 can never answer.
	assert.equal(result.stderr.includes("fazenda inalcançável"), true);
});

test("an UNBAKED installer still demands FARM_HOST", async () => {
	// The guard must survive the fix: served raw (or run from the repo), the
	// template has no farm to point at and must say so instead of fetching
	// http://__FARM_HOST__:4321.
	const template = await readFile(INSTALLER, "utf8");
	const result = await runInstaller(template, { FARM_HOST: "" });
	assert.equal(result.code, 2);
	assert.equal(result.stderr.includes("defina FARM_HOST"), true);
});

test("FARM_HOST still overrides the baked farm", async () => {
	const template = await readFile(INSTALLER, "utf8");
	const baked = bake(template, { host: "serpro-1577853", port: 4321 });
	const result = await runInstaller(baked, { FARM_HOST: "127.0.0.1", FARM_DIST_PORT: "1" });
	assert.notEqual(result.code, 2);
	// It reached the network against the OVERRIDE, not the baked farm.
	assert.equal(result.stderr.includes("--host 127.0.0.1"), true, "the override must decide the farm");
	assert.equal(result.stderr.includes("serpro-1577853"), false);
});

test("HTTP 404 proves the installer reached the farm but its manifest is absent", async (t) => {
	const server = createServer((_req, res) => {
		res.statusCode = 404;
		res.end();
	});
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	t.after(() => new Promise((resolve) => server.close(resolve)));
	const template = await readFile(INSTALLER, "utf8");
	const port = server.address().port;
	const result = await runInstaller(bake(template, { host: "127.0.0.1", port }), {});

	assert.equal(result.code, 1);
	assert.match(result.stderr, /manifesto ausente/);
	assert.match(result.stderr, /servidor respondeu HTTP 404/);
	assert.match(result.stderr, /A rede, o nome do host e o web-serve responderam/);
	assert.doesNotMatch(result.stderr, /manifesto inalcançável/);
});
