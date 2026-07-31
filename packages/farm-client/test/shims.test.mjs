import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";

import {
	defaultBinDir,
	installShims,
	pathAdviceLines,
	pathStatus,
	SHIM_NAMES,
	shimSource,
} from "../src/shims.mjs";

const run = promisify(execFile);

async function withTmp(run_) {
	const dir = await mkdtemp(join(tmpdir(), "farm-shims-"));
	try {
		return await run_(dir);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}

test("the device commands get launchers — including the one that ANSWERS", () => {
	// `farm-attend` is the most device-side command there is: the farm asks, and
	// whoever answers is holding the phone. Missing its shim is a question left
	// hanging over glass-keyboard friction.
	assert.deepEqual(SHIM_NAMES, ["farm-ask", "farm-attend", "farm-hello", "farm-update"]);
});

test("defaultBinDir is ~/.local/bin — the per-user convention that exists on Termux too", () => {
	assert.equal(defaultBinDir({ env: {}, home: "/home/op" }), join("/home/op", ".local", "bin"));
	// No /usr/local/bin, no sudo: Termux's HOME is the only writable, PATH-able place.
	assert.equal(defaultBinDir({ env: {}, home: "/data/data/com.termux/files/home" }), join("/data/data/com.termux/files/home", ".local", "bin"));
	// FARM_BIN_DIR wins, for an operator who already has somewhere else.
	assert.equal(defaultBinDir({ env: { FARM_BIN_DIR: "/opt/bin" }, home: "/home/op" }), "/opt/bin");
	assert.equal(defaultBinDir({ env: { FARM_BIN_DIR: "  " }, home: "/home/op" }), join("/home/op", ".local", "bin"));
});

test("a shim is a sh launcher that execs the kit's own entry point", () => {
	const source = shimSource("/kit", "farm-ask", { node: "/usr/bin/node" });
	assert.ok(source.startsWith("#!/bin/sh\n"));
	assert.ok(source.includes(`'/usr/bin/node' '${join("/kit", "bin", "farm-ask.mjs")}' "$@"`));
	assert.ok(source.includes("exec "), "exec, so no shell is left hanging");
	// "$@" and not $* — the question arrives whole, spaces and accents included.
	assert.ok(source.includes('"$@"'));
});

test("a path with spaces cannot split into two arguments", () => {
	const source = shimSource("/kit dir", "farm-hello", { node: "/us r/node" });
	assert.ok(source.includes(`'/us r/node' '${join("/kit dir", "bin", "farm-hello.mjs")}'`));
});

test("shims are created, are executable, and point at the right entry point", async () => {
	await withTmp(async (dir) => {
		const kitDir = join(dir, "kit");
		const binDir = join(dir, "bin");
		const result = await installShims({ kitDir, binDir });

		assert.deepEqual(result.created, ["farm-ask", "farm-attend", "farm-hello", "farm-update"]);
		assert.deepEqual(result.failed, []);
		assert.equal(result.binDir, binDir);

		for (const name of SHIM_NAMES) {
			const shim = join(binDir, name);
			const info = await stat(shim);
			assert.equal(info.mode & 0o111, 0o111, `${name} must be executable by everyone`);
			const source = await readFile(shim, "utf8");
			assert.ok(
				source.includes(join(kitDir, "bin", `${name}.mjs`)),
				`${name} must invoke ${name}.mjs, not another command`,
			);
		}
	});
});

test("a planted shim actually runs its entry point, with the argument intact", async () => {
	await withTmp(async (dir) => {
		const kitDir = join(dir, "kit");
		const binDir = join(dir, "bin");
		// A stand-in entry point: proves the shim resolves + forwards, without
		// starting a real farm client.
		await installShims({ kitDir, binDir, names: ["farm-ask"] });
		await run("mkdir", ["-p", join(kitDir, "bin")]);
		await writeFile(
			join(kitDir, "bin", "farm-ask.mjs"),
			'process.stdout.write(JSON.stringify(process.argv.slice(2)));\n',
		);

		const { stdout } = await run(join(binDir, "farm-ask"), ["olá, tudo bem?"]);
		assert.deepEqual(JSON.parse(stdout), ["olá, tudo bem?"]);
	});
});

test("an unwritable bin dir degrades instead of failing the install", async () => {
	await withTmp(async (dir) => {
		// A FILE where the bin dir should be: mkdir cannot succeed.
		const blocked = join(dir, "not-a-dir");
		await writeFile(blocked, "");
		const result = await installShims({ kitDir: join(dir, "kit"), binDir: blocked });
		assert.deepEqual(result.created, []);
		assert.equal(result.failed.length, SHIM_NAMES.length);
	});
});

test("pathStatus reports correctly when the dir IS on PATH", () => {
	const status = pathStatus({ binDir: "/home/op/.local/bin", env: { PATH: ["/usr/bin", "/home/op/.local/bin"].join(delimiter) } });
	assert.equal(status.onPath, true);
	assert.equal(status.binDir, "/home/op/.local/bin");
});

test("pathStatus reports correctly when the dir is NOT on PATH", () => {
	const status = pathStatus({ binDir: "/home/op/.local/bin", env: { PATH: ["/usr/bin", "/bin"].join(delimiter) } });
	assert.equal(status.onPath, false);
	assert.ok(status.exportLine.includes(".local/bin"));
	assert.ok(status.exportLine.startsWith("export PATH="));
});

test("pathStatus does not mistake a trailing-slash or relative entry for a miss", () => {
	const status = pathStatus({ binDir: "/home/op/.local/bin", env: { PATH: ["/home/op/.local/bin/"].join(delimiter) } });
	assert.equal(status.onPath, true);
});

test("an empty PATH is honestly 'not on PATH', never a crash", () => {
	assert.equal(pathStatus({ binDir: "/home/op/.local/bin", env: {} }).onPath, false);
	assert.equal(pathStatus({ binDir: "/home/op/.local/bin", env: { PATH: "" } }).onPath, false);
});

test("the advice tells the operator plainly which case they are in", () => {
	const on = pathAdviceLines({ binDir: "/home/op/.local/bin", onPath: true, exportLine: 'export PATH="$HOME/.local/bin:$PATH"' });
	assert.ok(on.join("\n").includes("já está no seu PATH"));
	assert.ok(on.join("\n").includes('farm-ask "quem é você?"'));
	assert.ok(!on.join("\n").includes("export PATH="), "no noise when there is nothing to do");

	const off = pathAdviceLines(
		{ binDir: "/home/op/.local/bin", onPath: false, exportLine: 'export PATH="$HOME/.local/bin:$PATH"' },
		{ kitDir: "/home/op/.refarm/kit/farm-client" },
	);
	const text = off.join("\n");
	assert.ok(text.includes("NÃO está no seu PATH"));
	// Exactly ONE line to add, and it is shown verbatim.
	assert.ok(text.includes('export PATH="$HOME/.local/bin:$PATH"'));
	assert.ok(text.includes("~/.bashrc"), "and where to put it");
	assert.ok(text.includes("não mexo no seu perfil"), "the profile is never edited silently");
	// Until then, the absolute path still works — the operator is never stranded.
	assert.ok(text.includes(join("/home/op/.refarm/kit/farm-client", "bin", "farm-ask.mjs")));
});

test("the installer plants shims through THIS module, not a private copy", async () => {
	// install.mjs cannot import the kit before installing it — but it can after,
	// and it does. This guard keeps the delegation from being quietly replaced by
	// an inlined reimplementation that then drifts from what farm-update plants.
	const installer = await readFile(new URL("../bootstrap/install.mjs", import.meta.url), "utf8");
	assert.ok(installer.includes('"src", "shims.mjs"'), "install.mjs must import the installed shims module");
	for (const fn of ["defaultBinDir", "installShims", "pathStatus", "pathAdviceLines"]) {
		assert.ok(installer.includes(fn), `install.mjs must use ${fn} from the kit`);
	}
	// And farm-update replants them, so a kit installed before shims existed gains them.
	const updater = await readFile(new URL("../bin/farm-update.mjs", import.meta.url), "utf8");
	assert.ok(updater.includes("installShims"));
});

test("shims.mjs stays the ADVICE module — it never writes to a shell profile", async () => {
	// The kit can now change a profile, but only through the authorised journey in
	// src/path-operation.mjs. This module must stay what it is: it plants launchers,
	// it says how the PATH stands, and it writes nothing else. A profile writer
	// appearing here would be a silent edit by another name.
	const source = await readFile(new URL("../src/shims.mjs", import.meta.url), "utf8");
	for (const profile of ["bashrc", "zshrc", ".profile", "bash_profile"]) {
		assert.equal(
			new RegExp(`writeFile\\([^)]*${profile}`).test(source),
			false,
			`shims.mjs must never write to ${profile}`,
		);
	}
});

test("the module that DOES edit a profile only writes through the consent journey", async () => {
	// path-operation.mjs proposes the change; the block applies it after the operator
	// authorises. If this file ever grew its own writeFile/appendFile, the change
	// would escape the request, the record and the undo — the whole point.
	const source = await readFile(new URL("../src/path-operation.mjs", import.meta.url), "utf8");
	assert.equal(/\b(writeFile|appendFile|writeFileSync|appendFileSync)\s*\(/.test(source), false);
	assert.ok(source.includes("runOperationConsent"), "the decision must come from the block");
	assert.ok(source.includes("vendor/operation-consent-v1.mjs"), "and from the carried block, not a copy");
});
