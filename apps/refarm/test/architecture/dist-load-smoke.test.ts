/**
 * THE THIRD ENVIRONMENT-TRUTH HARNESS. `crypto.subtle` needed a real browser; `PATH` under `sudo`
 * needed a real privileged invocation; this one needs a real Node module load.
 *
 * `refarm init` was COMPLETELY BROKEN — `ERR_AMBIGUOUS_MODULE_SYNTAX`, because `packages/sower` is
 * `"type": "module"` and its source used `__dirname`, which does not exist in ESM (fixed in
 * `7fd576b1`). The sower suite was 8/8 green throughout, because Vitest TRANSPILES: it never loads
 * the emitted `.js` the way Node loads it at process start, and it silently shims `__dirname` for
 * whatever it imports. Proven below (`"vitest itself does not see this class of bug"`) rather than
 * asserted — an in-process `import()` of this file's own broken fixture does not throw.
 *
 * So this harness does the one thing no other test in the repo does: it spawns the BUILT CLI —
 * `node dist/index.js …`, a real subprocess, not an `import()` inside this process — and asserts
 * that loading it, and loading every module the CLI can reach, does not crash.
 *
 * ── WHY `--help`, AND WHAT IT DOES NOT COVER ─────────────────────────────────────────────────
 * `--help` is the only safe surface: every OTHER surface either mutates `.refarm/`, blocks on an
 * interactive prompt, or binds a socket — the same reasons `cli-refusal-conformance.test.ts`
 * excludes `refarm init` / `sow` / `migrate` / `web serve` from its own deep probe. Commander never
 * runs a command's action for `--help`, so this is a LOAD check, not a behaviour suite: it proves
 * the module graph a command depends on can be imported by Node without a module-format crash, not
 * that the command's logic is correct.
 *
 * `program.ts` imports most commands (`cert`, `health`, `web`, …) with a static top-level `import`,
 * so THE WHOLE eager graph is already loaded before `parseAsync` ever inspects argv — one `node
 * dist/index.js --help` already proves every one of those files loads cleanly. Three commands
 * (`init`, `sow`, `migrate`) and one hook (`delivery-mount`) are different: `program.ts` loads them
 * with `await import(...)` ONLY when that specific command actually runs — never for `--help` —
 * which is exactly the shape the sower bug lived in (`commands/init.ts` → `@refarm.dev/sower`).
 * `--help` alone would NOT have caught it. Those targets are discovered from `program.ts`'s own
 * source (never a hand-maintained list) and loaded directly — a real `node --input-type=module -e
 * "import(...)"` subprocess against the exact compiled file `program.ts` would load, which forces
 * Node's real loader to evaluate the file's module-scope code with NO side effect beyond that,
 * since nothing calls into anything the import returns.
 *
 * This does not reach code that only runs partway through a command's OWN logic (a bug buried
 * inside a function body, reached only after specific input) — `sower`'s actual defect was one
 * line INSIDE `SowerCore`'s constructor, not at module scope, and only executing that line
 * reproduces it (verified by hand while building this harness). Catching that class needs a
 * behaviour suite driving real input, which is deliberately out of scope here: this is a load
 * check, kept fast enough to live in the suite, not a substitute for one.
 *
 * ── MUTATION-VERIFY ──────────────────────────────────────────────────────────────────────────
 * `test/fixtures/dist-load-smoke/broken-esm.js` reintroduces a top-level `__dirname` reference
 * under a `"type": "module"` package — the exact shape of the fixed bug, at the shallowest depth
 * (module scope) this harness's load-only technique can detect. `ok-esm.js` is its fixed sibling,
 * so the harness is proven to pass on a healthy module too, not just fail on a broken one.
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { program } from "../../src/program.js";

const APP_ROOT = path.resolve(__dirname, "../..");
const DIST_ENTRY = path.join(APP_ROOT, "dist", "index.js");
const PROGRAM_SOURCE = path.join(APP_ROOT, "src", "program.ts");
const FIXTURE_DIR = path.resolve(__dirname, "../fixtures/dist-load-smoke");

const SPAWN_TIMEOUT_MS = 15_000;

/** `    at Object.<anonymous> (/path:1:2)` — the shape a crash leaves behind, and the one thing
 *  neither a `--help` render nor a clean module load should ever produce. */
const STACK_FRAME = /^\s+at\s+\S/m;

// ─────────────────────────────────────────────────────────────────────────────────────────────
// SANDBOX — `--help` never runs a command's action, so nothing here should touch real state, but
// the CLI's module graph is loaded regardless of argv (see the file header), and some module
// somewhere may read config eagerly. A throwaway HOME costs nothing and removes the question.
// ─────────────────────────────────────────────────────────────────────────────────────────────

let sandboxRoot: string;

beforeAll(() => {
	if (!existsSync(DIST_ENTRY)) {
		throw new Error(
			`dist-load-smoke: ${DIST_ENTRY} is missing — this harness tests the BUILT CLI, not the ` +
				"TypeScript source, so it cannot run without one. Build first:\n" +
				"  pnpm --filter @refarm.dev/refarm run build",
		);
	}
	sandboxRoot = mkdtempSync(path.join(tmpdir(), "refarm-dist-load-smoke-"));
});

afterAll(() => {
	if (sandboxRoot) rmSync(sandboxRoot, { recursive: true, force: true });
});

function sandboxEnv(): NodeJS.ProcessEnv {
	const home = path.join(sandboxRoot, "home");
	mkdirSync(home, { recursive: true });
	// `src/cli-main.ts` skips `runCliMain()` entirely when `process.env.VITEST` is set — a guard
	// against the CLI actually executing if something ever imports it from inside a test. Vitest
	// sets `VITEST=true` (plus `VITEST_MODE` / `VITEST_POOL_ID` / `VITEST_WORKER_ID`) on ITS OWN
	// process, and `...process.env` below would otherwise hand that straight to the child — which
	// silently exits 0 with NO output at all, the exact failure this harness is built to catch,
	// except self-inflicted. Caught by hand while building this file: the first version of this
	// helper did not strip these, and `--help` on the bare root came back empty. Stripped here so
	// the child runs exactly as it would from the operator's own shell, which never sets `VITEST`.
	const env = { ...process.env };
	for (const key of Object.keys(env)) {
		if (key === "VITEST" || key.startsWith("VITEST_")) delete env[key];
	}
	return {
		...env,
		HOME: home,
		USERPROFILE: home,
		XDG_CONFIG_HOME: path.join(home, ".config"),
		XDG_DATA_HOME: path.join(home, ".local", "share"),
		XDG_CACHE_HOME: path.join(home, ".cache"),
		XDG_STATE_HOME: path.join(home, ".state"),
		NO_COLOR: "1",
	};
}

interface RunResult {
	status: number | null;
	stdout: string;
	stderr: string;
	crashed: boolean;
}

/** `execvp`, and nothing more — never a shell, so there is no quoting to get wrong. */
function runNode(args: readonly string[]): RunResult {
	const result = spawnSync(process.execPath, [...args], {
		cwd: sandboxRoot,
		env: sandboxEnv(),
		encoding: "utf8",
		timeout: SPAWN_TIMEOUT_MS,
		stdio: ["ignore", "pipe", "pipe"],
	});
	const stdout = result.stdout ?? "";
	const stderr = result.stderr ?? "";
	return {
		status: result.status,
		stdout,
		stderr,
		crashed:
			result.error !== undefined ||
			result.signal !== null ||
			STACK_FRAME.test(stdout) ||
			STACK_FRAME.test(stderr),
	};
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// DISCOVERY — never a hand-maintained list. Top-level commands come from `program` itself;
// LAZY targets come from `program.ts`'s own source, the same way it tells Node what to load.
// ─────────────────────────────────────────────────────────────────────────────────────────────

const TOP_LEVEL_COMMANDS = program.commands.map((command) => command.name()).sort();

/** Every `await import("./commands/X.js")` in `program.ts` — the lazy command loaders AND the
 *  `preAction` hook's `delivery-mount` import, whichever ones exist today. Read fresh from source
 *  rather than named here, so a lazy command added later is covered on the next run for free. */
function lazyCommandModuleTargets(): string[] {
	const source = readFileSync(PROGRAM_SOURCE, "utf8");
	const found = new Set<string>();
	for (const match of source.matchAll(/await import\(\s*["'](\.\/commands\/[^"']+\.js)["']\s*\)/g)) {
		found.add(match[1]!);
	}
	return [...found].sort();
}

const LAZY_TARGETS = lazyCommandModuleTargets();

/** `./commands/init.js` (as `program.ts` writes it) → the compiled file that import resolves to
 *  at runtime, as an absolute `file://` URL a subprocess can load directly. */
function distUrlFor(relativeFromProgram: string): string {
	return pathToFileURL(path.join(APP_ROOT, "dist", relativeFromProgram)).href;
}

/** Load a module in a FRESH subprocess and report whether the load itself succeeded — no action
 *  is invoked, nothing exported is called, so a module with side-effect-free top-level code (every
 *  module in this repo, by convention) has nothing to do but succeed or reveal a format crash. */
function importsCleanly(fileUrl: string): RunResult {
	const script =
		`import(${JSON.stringify(fileUrl)})` +
		`.then(() => { process.stdout.write("LOAD_OK\\n"); })` +
		`.catch((e) => { process.stderr.write(String((e && e.stack) || e)); process.exitCode = 1; });`;
	return runNode(["--input-type=module", "-e", script]);
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// THE SUITE
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe("dist load smoke — the built CLI, loaded the way Node actually loads it", () => {
	it("harvests a non-trivial surface — a harness that discovers nothing passes vacuously", () => {
		expect(TOP_LEVEL_COMMANDS.length).toBeGreaterThan(20);
		expect(TOP_LEVEL_COMMANDS).toContain("cert");
		// Pinned so a refactor that moves these off the lazy `load:` pattern is noticed here, not
		// silently: it would mean this harness's `--help` sweep (which now covers them) is the
		// whole story, and the direct-import sweep below has nothing left to prove.
		expect(LAZY_TARGETS).toEqual(
			expect.arrayContaining(["./commands/init.js", "./commands/sow.js", "./commands/migrate.js"]),
		);
	});

	it("the bare CLI loads — every EAGERLY-imported command's module graph, in one invocation", () => {
		const result = runNode([DIST_ENTRY, "--help"]);
		expect(result.crashed, `stderr:\n${result.stderr}`).toBe(false);
		expect(result.status).toBe(0);
		expect(result.stdout).toContain("Usage:");
	});

	for (const name of TOP_LEVEL_COMMANDS) {
		it(`refarm ${name} --help — loads and prints help without crashing`, () => {
			const result = runNode([DIST_ENTRY, name, "--help"]);
			expect(result.crashed, `stderr:\n${result.stderr}\nstdout:\n${result.stdout}`).toBe(false);
			expect(result.status).toBe(0);
		});
	}

	describe("lazily-loaded commands — --help never reaches these; loaded directly instead", () => {
		for (const target of LAZY_TARGETS) {
			it(`${target} — the compiled module Node would load when the command actually runs`, () => {
				const result = importsCleanly(distUrlFor(target));
				expect(result.crashed, `stderr:\n${result.stderr}`).toBe(false);
				expect(result.status).toBe(0);
				expect(result.stdout).toContain("LOAD_OK");
			});
		}
	});

	describe("the harness itself — proven against fixtures, not merely asserted", () => {
		it("vitest itself does not see this class of bug — the reason a subprocess is required", async () => {
			// The premise this whole file rests on, pinned as a real check rather than prose: an
			// in-process `import()` of the exact same broken module Vitest transpiles/shims and does
			// NOT throw, even though real Node does (the next test). If this ever starts throwing,
			// Vitest has changed how it handles CJS-only globals in dynamically imported files, and
			// the file header's claim needs revisiting.
			await expect(
				import(pathToFileURL(path.join(FIXTURE_DIR, "broken-esm.js")).href),
			).resolves.toBeDefined();
		});

		it("goes red on the deliberately-broken fixture", () => {
			const url = pathToFileURL(path.join(FIXTURE_DIR, "broken-esm.js")).href;
			const result = importsCleanly(url);
			expect(result.status).not.toBe(0);
			expect(result.stderr).toMatch(/__dirname/);
		});

		it("passes on the fixed sibling fixture", () => {
			const url = pathToFileURL(path.join(FIXTURE_DIR, "ok-esm.js")).href;
			const result = importsCleanly(url);
			expect(result.crashed, `stderr:\n${result.stderr}`).toBe(false);
			expect(result.status).toBe(0);
			expect(result.stdout).toContain("LOAD_OK");
		});
	});
});
