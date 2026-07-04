import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// This suite drives the REAL transpiled component, so it needs `pnpm build:component`
// (cargo component build + jco transpile) to have produced `pkg/`. That build is
// heavy (§7) and gitignored, so — like the tractor harness gated on the WASM build —
// the suite SKIPS when `pkg/` is absent instead of failing the repo-wide test run.
// CI builds the component first; a local run does `pnpm build:component` then test.
const componentBuilt = existsSync(
	fileURLToPath(new URL("../pkg/quality_checker_ref.js", import.meta.url)),
);

// The transpiled component uses --instantiation, so WE supply every wasi import.
// That is the sovereignty test made concrete: the host decides what a checker can
// reach. We hand it a FILESYSTEM that denies everything (no preopened dirs; every
// Descriptor op throws), yet check() still returns findings — proving the checker
// is pure compute that never needs fs, and that if it TRIED to touch fs it could
// not, because the host provided none. "The host enforces the boundary" (spec §2.1).

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

const pkgDir = fileURLToPath(new URL("../pkg/", import.meta.url));

function getCoreModule(path: string): WebAssembly.Module {
	// jco passes a path relative to the transpiled module (e.g. the core wasm
	// file name); resolve it against the pkg dir.
	return new WebAssembly.Module(readFileSync(join(pkgDir, path)));
}

/** A tripwire: any call flips `touched` and throws, so a test can assert the
 * capability was never exercised (and would have failed if it were). */
function tripwire(label: string, state: { touched: string[] }) {
	return new Proxy(
		{},
		{
			get(_t, prop) {
				return (..._args: unknown[]) => {
					state.touched.push(`${label}.${String(prop)}`);
					throw new Error(`DENIED: ${label}.${String(prop)}`);
				};
			},
		},
	);
}

/** wasi imports where filesystem is a hard deny and the rest are inert stubs.
 * getDirectories() returns [] — the host preopens NOTHING, so a checker cannot
 * even name a file to open. */
function denyingWasiImports(state: { touched: string[] }): Any {
	const noop = () => {};
	const emptyStream = { blockingWriteAndFlush: noop, write: noop, checkWrite: () => 0n };
	return {
		"wasi:cli/environment": {
			getEnvironment: () => [],
			getArguments: () => [],
			initialCwd: () => undefined,
		},
		"wasi:cli/exit": { exit: noop },
		"wasi:cli/stderr": { getStderr: () => emptyStream },
		"wasi:cli/stdin": { getStdin: () => ({}) },
		"wasi:cli/stdout": { getStdout: () => emptyStream },
		// The capability that matters: NO preopened dirs, and every fs op trips.
		"wasi:filesystem/preopens": { getDirectories: () => [] },
		"wasi:filesystem/types": {
			Descriptor: tripwire("filesystem.Descriptor", state),
			filesystemErrorCode: () => undefined,
		},
		"wasi:io/error": { Error: class {} },
		"wasi:io/streams": {
			InputStream: tripwire("io.InputStream", state),
			OutputStream: class {
				blockingWriteAndFlush() {}
				write() {}
				checkWrite() {
					return 0n;
				}
			},
		},
	};
}

interface Finding {
	severity: string;
	ruleId: string;
	message: string;
	locus?: string;
}
interface Checker {
	check(
		subject: { tag: "text" | "dom"; val: string },
		profile: {
			name: string;
			rules: {
				id: string;
				severity: string;
				description: string;
				category?: string;
				check: string;
			}[];
		},
	): Finding[];
}

async function loadChecker(state: { touched: string[] }): Promise<Checker> {
	const { instantiate } = (await import("../pkg/quality_checker_ref.js")) as Any;
	const root = await instantiate(getCoreModule, denyingWasiImports(state));
	return root.checker as Checker;
}

const containsRule = (id: string, value: string) => ({
	id,
	severity: "warn",
	description: `matched ${value}`,
	category: "test",
	check: JSON.stringify({ type: "contains", value }),
});

describe.skipIf(!componentBuilt)("quality-checker reference component (real WASM dispatch)", () => {
	it("runs check() through the WASM component and returns matching findings", async () => {
		const state = { touched: [] as string[] };
		const checker = await loadChecker(state);

		const findings = checker.check(
			{ tag: "text", val: "As an AI language model, I cannot browse." },
			{
				name: "text-tells",
				rules: [
					containsRule("ai-tell", "AI language model"),
					containsRule("absent", "zzz-not-present"),
				],
			},
		);

		expect(findings).toHaveLength(1);
		expect(findings[0]).toMatchObject({
			ruleId: "ai-tell",
			severity: "warn",
		});
		expect(findings[0]!.locus).toContain("AI language model");
	});

	it("SANDBOX: check() succeeds while the host grants ZERO filesystem — fs is never touched", async () => {
		const state = { touched: [] as string[] };
		const checker = await loadChecker(state);

		// A normal run over the deny-all host.
		const findings = checker.check(
			{ tag: "text", val: "some subject text with a tell inside" },
			{ name: "p", rules: [containsRule("t", "tell")] },
		);

		expect(findings).toHaveLength(1);
		// The proof: the checker reached its result as pure compute, and the
		// filesystem tripwire was NEVER hit — the host provided no fs capability
		// and the checker needed none. It cannot exfiltrate because there is no
		// import through which to try.
		expect(state.touched).toEqual([]);
	});

	it("returns no findings when no rule matches (deterministic empty result)", async () => {
		const state = { touched: [] as string[] };
		const checker = await loadChecker(state);
		const findings = checker.check(
			{ tag: "text", val: "clean prose" },
			{ name: "p", rules: [containsRule("t", "absent-token")] },
		);
		expect(findings).toEqual([]);
	});

	it("createReferenceChecker() (the shipped loader) runs the sandboxed component", async () => {
		const { createReferenceChecker } = (await import("./index.js")) as Any;
		const checker = await createReferenceChecker();
		const findings = checker.check(
			{ tag: "text", val: "text with a tell" },
			{ name: "p", rules: [containsRule("t", "tell")] },
		);
		expect(findings).toHaveLength(1);
		expect(findings[0].ruleId).toBe("t");
	});
});
