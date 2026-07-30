import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { test } from "node:test";

import { createNodeOperationFileSystem } from "../vendor/operation-consent-v1.mjs";
import { OperatorPromptCancelledError } from "../vendor/prompt-contract-v1.mjs";
import {
	alreadyOnPath,
	chooseProfile,
	defaultTrailPath,
	ensurePathOperation,
	pathMarkerLine,
	planPathOperation,
	profileCandidates,
	tildify,
	undoPathOperation,
} from "../src/path-operation.mjs";
import { pathAdviceLines, pathStatus } from "../src/shims.mjs";

/**
 * The PATH operation — the line the installer used to refuse to write.
 *
 * Every test here runs against a throwaway HOME under the system temp dir. The
 * operator's real `~/.bashrc`, `~/.profile`, `~/.zshrc` and `~/.refarm` are never
 * this suite's business, and a test that touched them would be exactly the silent
 * edit the whole design exists to prevent.
 */

async function withHome(run) {
	const home = await mkdtemp(join(tmpdir(), "farm-path-"));
	try {
		return await run({
			home,
			binDir: join(home, ".local", "bin"),
			kitDir: join(home, ".refarm", "kit", "farm-client"),
			trailPath: join(home, ".refarm", "operations.json"),
		});
	} finally {
		await rm(home, { recursive: true, force: true });
	}
}

/** A terminal that exists only for the test: both ends "are" TTYs, so the journey
 *  takes the interactive path without any real terminal or /dev/tty. */
function fakeTty() {
	const written = [];
	return {
		input: { isTTY: true },
		output: { isTTY: true, write: (s) => written.push(s) },
		get text() {
			return written.join("");
		},
	};
}

function channelAnswering(answer) {
	return { async ask() { return answer; } };
}

function channelThatMustNotBeAsked() {
	return {
		async ask() {
			throw new Error("the operator was asked again — the recorded decision was ignored");
		},
	};
}

const NO_PATH_ENV = { PATH: ["/usr/bin", "/bin"].join(delimiter), SHELL: "/bin/bash", USER: "op" };

function statusFor(binDir) {
	return pathStatus({ binDir, env: NO_PATH_ENV });
}

// ── which file, chosen how ────────────────────────────────────────────────────

test("the candidates are ordered by the shell the operator actually uses", () => {
	const home = "/data/data/com.termux/files/home";
	assert.deepEqual(profileCandidates({ home, env: { SHELL: "/bin/zsh" } }), {
		shell: "zsh",
		candidates: [join(home, ".zshrc"), join(home, ".profile"), join(home, ".bashrc")],
	});
	// Termux: bash, no sudo, HOME is the only writable place — the same ladder.
	assert.deepEqual(
		profileCandidates({ home, env: { SHELL: "/data/data/com.termux/files/usr/bin/bash" } }).candidates,
		[join(home, ".bashrc"), join(home, ".profile"), join(home, ".zshrc")],
	);
	// An unknown/absent SHELL falls back to the POSIX file every shell reads.
	assert.equal(profileCandidates({ home, env: {} }).candidates[0], join(home, ".profile"));
});

test("the chosen profile is the first that EXISTS; when none does, one is created", () => {
	const candidates = ["/h/.bashrc", "/h/.profile", "/h/.zshrc"];
	assert.deepEqual(chooseProfile({ candidates, existing: ["/h/.profile", "/h/.zshrc"] }), {
		path: "/h/.profile",
		existing: ["/h/.profile", "/h/.zshrc"],
		creating: false,
	});
	assert.deepEqual(chooseProfile({ candidates, existing: [] }), {
		path: "/h/.bashrc",
		existing: [],
		creating: true,
	});
});

test("a line already on PATH is recognised in every spelling — and a comment is not one", () => {
	const home = "/h";
	const bin = "/h/.local/bin";
	assert.equal(alreadyOnPath('export PATH="/h/.local/bin:$PATH"', bin, home), true);
	assert.equal(alreadyOnPath('export PATH="$HOME/.local/bin:$PATH"', bin, home), true);
	assert.equal(alreadyOnPath('export PATH="${HOME}/.local/bin:$PATH"', bin, home), true);
	assert.equal(alreadyOnPath('PATH=~/.local/bin:$PATH', bin, home), true);
	// A commented line is precisely the one that does nothing.
	assert.equal(alreadyOnPath('# export PATH="$HOME/.local/bin:$PATH"', bin, home), false);
	// Mentioning the dir without touching PATH is not the same operation.
	assert.equal(alreadyOnPath("ls $HOME/.local/bin", bin, home), false);
	assert.equal(alreadyOnPath("", bin, home), false);
	assert.equal(alreadyOnPath(null, bin, home), false);
});

// ── R2: the request is the diff ───────────────────────────────────────────────

test("the request states the file, the line, the position and the current contents", () => {
	const request = planPathOperation({
		binDir: "/h/.local/bin",
		exportLine: 'export PATH="$HOME/.local/bin:$PATH"',
		profilePath: "/h/.bashrc",
		current: "# perfil\nexport EDITOR=vim\n",
		trailPath: "/h/.refarm/operations.json",
		home: "/h",
		requestedAt: "2026-07-30T10:00:00.000Z",
	});

	const change = request.changes[0];
	assert.equal(change.path, "/h/.bashrc");
	assert.equal(change.before, "# perfil\nexport EDITOR=vim\n");
	assert.equal(change.insertion.line, 3);
	assert.equal(change.insertion.placement, "no fim do arquivo (linha 3)");
	assert.equal(
		change.after,
		`# perfil\nexport EDITOR=vim\n${pathMarkerLine("/h/.refarm/operations.json", "/h")}\nexport PATH="$HOME/.local/bin:$PATH"\n`,
	);
	// The identity is the bin dir, not a clock — that is what makes a prior answer findable.
	assert.equal(request.id, "shell-path:/h/.local/bin");
	assert.equal(request.undo.kind, "restore-snapshot");
	// The marker in the file points back at the record: a `.bashrc` read six months
	// later says where the decision lives.
	assert.ok(change.insertion.text.includes("~/.refarm/operations.json"));
});

test("a profile that does not exist yet is created, and the request says so", () => {
	const request = planPathOperation({
		binDir: "/h/.local/bin",
		exportLine: 'export PATH="/h/.local/bin:$PATH"',
		profilePath: "/h/.bashrc",
		current: null,
		trailPath: "/h/.refarm/operations.json",
		home: "/h",
		requestedAt: "2026-07-30T10:00:00.000Z",
	});
	assert.equal(request.changes[0].before, null);
	assert.equal(request.changes[0].insertion.line, 1);
	assert.ok(request.changes[0].insertion.placement.includes("será criado"));
});

test("a file whose last line lacks a newline is not glued to the new line", () => {
	const request = planPathOperation({
		binDir: "/h/.local/bin",
		exportLine: "export PATH=x",
		profilePath: "/h/.bashrc",
		current: "export EDITOR=vim",
		trailPath: "/h/.refarm/operations.json",
		home: "/h",
		requestedAt: "2026-07-30T10:00:00.000Z",
	});
	assert.ok(request.changes[0].after.startsWith("export EDITOR=vim\n#"));
	assert.equal(request.changes[0].insertion.line, 2);
});

test("tildify and the trail path are the same words the operator reads", () => {
	assert.equal(tildify("/h/.refarm/operations.json", "/h"), "~/.refarm/operations.json");
	assert.equal(tildify("/opt/x", "/h"), "/opt/x");
	assert.equal(defaultTrailPath({ env: {}, home: "/h" }), join("/h", ".refarm", "operations.json"));
	assert.equal(defaultTrailPath({ env: { FARM_OPERATION_TRAIL: "/tmp/t.json" }, home: "/h" }), "/tmp/t.json");
});

// ── no TTY: exactly today's behaviour ─────────────────────────────────────────

test("with no terminal it never prompts, never records, and prints exactly today's message", async () => {
	await withHome(async ({ home, binDir, kitDir, trailPath }) => {
		const status = statusFor(binDir);
		const result = await ensurePathOperation({
			binDir,
			kitDir,
			status,
			home,
			env: NO_PATH_ENV,
			trailPath,
			input: { isTTY: false },
			output: { isTTY: false, write: () => {} },
			channel: channelThatMustNotBeAsked(),
			// A pipe with no terminal behind it: /dev/tty must not be reached for either.
			openTty: () => null,
		});

		assert.equal(result.status, "no-operator");
		assert.deepEqual(result.lines, pathAdviceLines(status, { kitDir }));
		assert.equal(result.record, null);
		// Not a byte on disk: no trail, no profile.
		await assert.rejects(readFile(trailPath, "utf8"));
		await assert.rejects(readFile(join(home, ".bashrc"), "utf8"));
	});
});

test("when the dir is already on PATH there is nothing to propose", async () => {
	await withHome(async ({ home, binDir, kitDir, trailPath }) => {
		const status = pathStatus({ binDir, env: { PATH: binDir, SHELL: "/bin/bash" } });
		const result = await ensurePathOperation({
			binDir,
			kitDir,
			status,
			home,
			env: NO_PATH_ENV,
			trailPath,
			channel: channelThatMustNotBeAsked(),
			...fakeTty(),
		});
		assert.equal(result.status, "on-path");
		assert.deepEqual(result.lines, pathAdviceLines(status, { kitDir }));
	});
});

// ── authorising, recording, undoing ───────────────────────────────────────────

test("authorising writes exactly the proposed change, and the record's undo reverses it", async () => {
	await withHome(async ({ home, binDir, kitDir, trailPath }) => {
		const bashrc = join(home, ".bashrc");
		const zshrc = join(home, ".zshrc");
		await writeFile(bashrc, "# perfil\nexport EDITOR=vim\n");
		await writeFile(zshrc, "# zsh\n");
		const before = await readFile(bashrc, "utf8");
		const tty = fakeTty();

		const result = await ensurePathOperation({
			binDir,
			kitDir,
			status: statusFor(binDir),
			home,
			env: NO_PATH_ENV,
			trailPath,
			channel: channelAnswering("authorize"),
			...tty,
		});

		assert.equal(result.status, "authorized");
		// The operator SAW the diff before deciding.
		assert.ok(tty.text.includes(bashrc));
		assert.ok(tty.text.includes("no fim do arquivo (linha 3)"));
		assert.ok(tty.text.includes("export EDITOR=vim"));

		// Exactly that change, and nothing else.
		const after = await readFile(bashrc, "utf8");
		assert.equal(after, `${before}${pathMarkerLine(trailPath, home)}\n${statusFor(binDir).exportLine}\n`);
		assert.equal(await readFile(zshrc, "utf8"), "# zsh\n");

		// The record round-trips off disk, carrying what changed, why, who, when, undo.
		const document = JSON.parse(await readFile(trailPath, "utf8"));
		assert.equal(document.capability, "operation-consent:v1");
		const [record] = document.records;
		assert.equal(record.decision, "authorized");
		assert.equal(record.changes[0].before, before);
		assert.equal(record.changes[0].after, after);
		assert.equal(record.decidedBy, "op");
		assert.ok(record.purpose.includes("farm-ask"));
		assert.equal(record.undo.kind, "restore-snapshot");

		// APPLY the undo — a stored sentence proves nothing.
		const undone = await undoPathOperation({ binDir, home, env: NO_PATH_ENV, trailPath });
		assert.equal(undone.status, "undone");
		assert.equal(await readFile(bashrc, "utf8"), before);

		// And the undo is itself recorded: the trail is append-only, not rewritten.
		const trail = JSON.parse(await readFile(trailPath, "utf8"));
		assert.deepEqual(trail.records.map((r) => r.decision), ["authorized", "undone"]);
	});
});

test("a created profile is removed again by the undo", async () => {
	await withHome(async ({ home, binDir, kitDir, trailPath }) => {
		const bashrc = join(home, ".bashrc");
		const result = await ensurePathOperation({
			binDir,
			kitDir,
			status: statusFor(binDir),
			home,
			env: NO_PATH_ENV,
			trailPath,
			channel: channelAnswering("authorize"),
			...fakeTty(),
		});
		assert.equal(result.status, "authorized");
		assert.ok((await readFile(bashrc, "utf8")).includes("export PATH="));

		await undoPathOperation({ binDir, home, env: NO_PATH_ENV, trailPath });
		await assert.rejects(readFile(bashrc, "utf8"), /ENOENT/);
	});
});

test("there is nothing to undo when nothing was authorised", async () => {
	await withHome(async ({ home, binDir, trailPath }) => {
		const result = await undoPathOperation({ binDir, home, env: NO_PATH_ENV, trailPath });
		assert.equal(result.status, "nothing-to-undo");
	});
});

// ── R4: the decline is remembered ─────────────────────────────────────────────

test("declining is recorded, the second run does not re-ask, and the revisit path works", async () => {
	await withHome(async ({ home, binDir, kitDir, trailPath }) => {
		const bashrc = join(home, ".bashrc");
		await writeFile(bashrc, "# perfil\n");

		const declined = await ensurePathOperation({
			binDir,
			kitDir,
			status: statusFor(binDir),
			home,
			env: NO_PATH_ENV,
			trailPath,
			channel: channelAnswering("decline"),
			...fakeTty(),
		});
		assert.equal(declined.status, "declined");
		assert.equal(await readFile(bashrc, "utf8"), "# perfil\n");
		// It falls back to today's message, plus how to revisit.
		const text = declined.lines.join("\n");
		assert.ok(text.includes("NÃO está no seu PATH"));
		assert.ok(text.includes("--revisit-path"));

		// A SECOND run: the channel would throw if consulted.
		const second = await ensurePathOperation({
			binDir,
			kitDir,
			status: statusFor(binDir),
			home,
			env: NO_PATH_ENV,
			trailPath,
			channel: channelThatMustNotBeAsked(),
			...fakeTty(),
		});
		assert.equal(second.status, "already-decided");
		assert.equal(second.record.decision, "declined");
		assert.ok(second.lines.join("\n").includes("--revisit-path"));
		assert.equal(JSON.parse(await readFile(trailPath, "utf8")).records.length, 1);

		// The DELIBERATE revisit re-opens it — and the refusal stays in the trail.
		const revisited = await ensurePathOperation({
			binDir,
			kitDir,
			status: statusFor(binDir),
			home,
			env: NO_PATH_ENV,
			trailPath,
			channel: channelAnswering("authorize"),
			revisit: true,
			...fakeTty(),
		});
		assert.equal(revisited.status, "authorized");
		assert.ok((await readFile(bashrc, "utf8")).includes("export PATH="));
		const records = JSON.parse(await readFile(trailPath, "utf8")).records;
		assert.deepEqual(records.map((r) => r.decision), ["declined", "authorized"]);
		assert.equal(records[1].revisitOf, records[0].id);
	});
});

test('"agora não" records nothing, so the question comes back', async () => {
	await withHome(async ({ home, binDir, kitDir, trailPath }) => {
		await writeFile(join(home, ".bashrc"), "# perfil\n");
		const deferred = await ensurePathOperation({
			binDir,
			kitDir,
			status: statusFor(binDir),
			home,
			env: NO_PATH_ENV,
			trailPath,
			channel: channelAnswering("later"),
			...fakeTty(),
		});
		assert.equal(deferred.status, "deferred");
		await assert.rejects(readFile(trailPath, "utf8"));

		const again = await ensurePathOperation({
			binDir,
			kitDir,
			status: statusFor(binDir),
			home,
			env: NO_PATH_ENV,
			trailPath,
			channel: channelAnswering("authorize"),
			...fakeTty(),
		});
		assert.equal(again.status, "authorized");
	});
});

test("cancelling mid-prompt is graceful, changes nothing and records nothing", async () => {
	await withHome(async ({ home, binDir, kitDir, trailPath }) => {
		await writeFile(join(home, ".bashrc"), "# perfil\n");
		const cancelling = {
			async ask() {
				throw new OperatorPromptCancelledError();
			},
		};
		const result = await ensurePathOperation({
			binDir,
			kitDir,
			status: statusFor(binDir),
			home,
			env: NO_PATH_ENV,
			trailPath,
			channel: cancelling,
			...fakeTty(),
		});
		assert.equal(result.status, "cancelled");
		assert.ok(result.lines.join("\n").includes("cancelado"));
		// Today's instruction still follows — the operator is never stranded.
		assert.ok(result.lines.join("\n").includes("NÃO está no seu PATH"));
		assert.equal(await readFile(join(home, ".bashrc"), "utf8"), "# perfil\n");
		await assert.rejects(readFile(trailPath, "utf8"));
	});
});

// ── the awkward real cases ────────────────────────────────────────────────────

test("a line already present is detected — nothing is appended, nobody is asked", async () => {
	await withHome(async ({ home, binDir, kitDir, trailPath }) => {
		const bashrc = join(home, ".bashrc");
		const content = `# perfil\nexport PATH="$HOME/.local/bin:$PATH"\n`;
		await writeFile(bashrc, content);

		const result = await ensurePathOperation({
			binDir,
			kitDir,
			status: statusFor(binDir),
			home,
			env: NO_PATH_ENV,
			trailPath,
			channel: channelThatMustNotBeAsked(),
			...fakeTty(),
		});

		assert.equal(result.status, "already-present");
		assert.equal(await readFile(bashrc, "utf8"), content, "no duplicate line");
		assert.ok(result.lines.join("\n").includes("já acrescenta"));
		await assert.rejects(readFile(trailPath, "utf8"));
	});
});

test("with several profiles present the request names the one chosen AND the others", async () => {
	await withHome(async ({ home, binDir, kitDir, trailPath }) => {
		await writeFile(join(home, ".bashrc"), "# bash\n");
		await writeFile(join(home, ".profile"), "# sh\n");
		await writeFile(join(home, ".zshrc"), "# zsh\n");
		const tty = fakeTty();

		const result = await ensurePathOperation({
			binDir,
			kitDir,
			status: statusFor(binDir),
			home,
			env: NO_PATH_ENV,
			trailPath,
			channel: channelAnswering("authorize"),
			...tty,
		});

		assert.equal(result.status, "authorized");
		assert.ok(tty.text.includes("escolhi ~/.bashrc porque seu shell é bash"));
		assert.ok(tty.text.includes("~/.profile"));
		// Only the chosen one changed.
		assert.equal(await readFile(join(home, ".profile"), "utf8"), "# sh\n");
		assert.equal(await readFile(join(home, ".zshrc"), "utf8"), "# zsh\n");
		assert.equal(result.record.notes.length, 2);
	});
});

test("the operator's shell decides the file — zsh gets .zshrc, not .bashrc", async () => {
	await withHome(async ({ home, binDir, kitDir, trailPath }) => {
		await writeFile(join(home, ".bashrc"), "# bash\n");
		await writeFile(join(home, ".zshrc"), "# zsh\n");
		const result = await ensurePathOperation({
			binDir,
			kitDir,
			status: statusFor(binDir),
			home,
			env: { ...NO_PATH_ENV, SHELL: "/usr/bin/zsh" },
			trailPath,
			channel: channelAnswering("authorize"),
			...fakeTty(),
		});
		assert.equal(result.record.changes[0].path, join(home, ".zshrc"));
		assert.equal(await readFile(join(home, ".bashrc"), "utf8"), "# bash\n");
	});
});

test("a trail that cannot be written rolls the profile back — nothing is changed unrecorded", async () => {
	await withHome(async ({ home, binDir, kitDir, trailPath }) => {
		const bashrc = join(home, ".bashrc");
		await writeFile(bashrc, "# perfil\n");
		const real = createNodeOperationFileSystem();
		const fs = {
			readFile: real.readFile,
			removeFile: real.removeFile,
			async writeFile(path, content) {
				if (path === trailPath) throw new Error("trilha somente-leitura");
				return real.writeFile(path, content);
			},
		};

		const result = await ensurePathOperation({
			binDir,
			kitDir,
			status: statusFor(binDir),
			home,
			env: NO_PATH_ENV,
			trailPath,
			fs,
			channel: channelAnswering("authorize"),
			...fakeTty(),
		});

		assert.equal(result.status, "failed");
		assert.equal(await readFile(bashrc, "utf8"), "# perfil\n");
	});
});

test("farm-update exposes the deliberate revisit and undo commands", async () => {
	const updater = await readFile(new URL("../bin/farm-update.mjs", import.meta.url), "utf8");
	assert.ok(updater.includes("--revisit-path"));
	assert.ok(updater.includes("--undo-path"));
	assert.ok(updater.includes("ensurePathOperation"));
	// And the cold-bootstrap installer runs the same journey, not a private copy.
	const installer = await readFile(new URL("../bootstrap/install.mjs", import.meta.url), "utf8");
	assert.ok(installer.includes('"src", "path-operation.mjs"'));
	assert.ok(installer.includes("ensurePathOperation"));
});
