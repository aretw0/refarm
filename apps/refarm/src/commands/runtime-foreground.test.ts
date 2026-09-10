import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type {
	AttachedProcessHandoffOptions,
	ProcessHandoffSpec,
} from "@refarm.dev/cli/process-handoff";

import { runRuntimeForeground } from "./runtime-foreground.js";

/**
 * A PRODUCTION-SHAPED fixture home: `<home>/plugins/refarm_<name>/plugin.wasm`, with the
 * artifact named `plugin.wasm` for every plugin. Naming it after the plugin instead would
 * make a stem accidentally equal an id and hide exactly the class of defect these tests
 * exist to catch.
 */
let home: string;

function installPlugin(name: string, runtimeId: string): void {
	const dir = join(home, "plugins", `refarm_${name}`);
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, "plugin.wasm"), "\0asm");
	writeFileSync(join(dir, "plugin.json"), JSON.stringify({ id: `@refarm/${name}`, runtimeId }));
}

beforeAll(() => {
	home = mkdtempSync(join(tmpdir(), "refarm-foreground-"));
	installPlugin("agent", "agent");
	installPlugin("lsp-code-ops", "lsp-code-ops");
	writeFileSync(
		join(home, "config.json"),
		JSON.stringify({ trusted_plugins: ["agent", "lsp-code-ops"] }),
	);
});

afterAll(() => {
	rmSync(home, { recursive: true, force: true });
});

interface FakeChild {
	kill: ReturnType<typeof vi.fn>;
	wait(): Promise<number>;
	settle(code: number): void;
}

function fakeChild(): FakeChild {
	let settle: ((code: number) => void) | undefined;
	const exited = new Promise<number>((resolve) => {
		settle = resolve;
	});
	return {
		kill: vi.fn(),
		wait: () => exited,
		settle: (code) => settle?.(code),
	};
}

/** An attached-handoff starter that reports the child exiting with `code`. */
function startThatExits(child: FakeChild, code: number) {
	// The parameters are DECLARED so the mock's call tuple carries their types — an untyped
	// `vi.fn(() => ...)` records calls as `[]` and every assertion on an argument becomes a cast.
	return vi.fn((_spec: ProcessHandoffSpec, _options?: AttachedProcessHandoffOptions) => {
		queueMicrotask(() => child.settle(code));
		return child as never;
	});
}

describe("runRuntimeForeground", () => {
	it("derives the plugin arguments at call time rather than carrying a frozen list", async () => {
		const child = fakeChild();
		const startAttached = startThatExits(child, 0);
		const result = await runRuntimeForeground("/repo-without-start-script", "rust", {
			startAttached: startAttached as never,
			resolveHome: () => home,
			nodeEnv: async () => ({ PROBE: "1" }),
		});
		expect(result.exitCode).toBe(0);
		const args = startAttached.mock.calls[0]?.[0].args ?? [];
		// The agent AND the trusted plugin — two, derived from what is installed under this home.
		expect(args.filter((a) => a === "--plugin")).toHaveLength(2);
		expect(args).toContain("--refarm-dir");
		expect(args[args.indexOf("--refarm-dir") + 1]).toBe(home);
	});

	it("hands the child the node environment", async () => {
		const child = fakeChild();
		const startAttached = startThatExits(child, 0);
		await runRuntimeForeground("/repo-without-start-script", "rust", {
			startAttached: startAttached as never,
			resolveHome: () => home,
			nodeEnv: async () => ({ MODEL_AUTHORIZATION_PROBE: "yes" }),
		});
		const options = startAttached.mock.calls[0]?.[1];
		expect(options?.env?.MODEL_AUTHORIZATION_PROBE).toBe("yes");
		// stdio inheritance is the attached primitive's own contract, proven in its package.
	});

	it("exits with the child's code", async () => {
		const child = fakeChild();
		const startAttached = startThatExits(child, 3);
		const result = await runRuntimeForeground("/repo-without-start-script", "rust", {
			startAttached: startAttached as never,
			resolveHome: () => home,
			nodeEnv: async () => ({}),
		});
		expect(result.exitCode).toBe(3);
	});

	it("forwards the supervisor's stop signal to the child and waits for it", async () => {
		const child = fakeChild();
		const startAttached = vi.fn(
			(_spec: ProcessHandoffSpec, _options?: AttachedProcessHandoffOptions) => child as never,
		);
		let raise: ((signal: NodeJS.Signals) => void) | undefined;
		const pending = runRuntimeForeground("/repo-without-start-script", "rust", {
			startAttached: startAttached as never,
			resolveHome: () => home,
			nodeEnv: async () => ({}),
			onSignal: (handler) => {
				raise = handler;
			},
		});
		await vi.waitFor(() => expect(raise).toBeDefined());
		raise?.("SIGTERM");
		// THE SIGNAL REACHED THE CHILD. Asserting only that the wrapper exited would pass
		// against a wrapper that exits and abandons the daemon — which is the defect.
		expect(child.kill).toHaveBeenCalledWith("SIGTERM");
		child.settle(0);
		await expect(pending).resolves.toMatchObject({ exitCode: 0 });
	});
});
