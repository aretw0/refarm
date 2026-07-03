import type { CapabilityInput } from "@refarm.dev/cli/capabilities";
import {
	isCapabilityGroup,
	resolveGroupAction,
} from "@refarm.dev/cli/capabilities";
import { describe, expect, it, vi } from "vitest";

import {
	createModelCapabilityGroup,
	modelCapabilityHooks,
	resolveModelGrammar,
} from "./model-capability.js";
import type { ModelCommandDeps, ModelTokens } from "./model.js";

function deps(tokens: Partial<ModelTokens> = {}): ModelCommandDeps & {
	saveTokens: ReturnType<typeof vi.fn>;
} {
	return {
		loadTokens: async () => tokens as ModelTokens,
		saveTokens: vi.fn(async () => ({})),
		fetch: vi.fn(async () => ({ ok: false }) as unknown as Response),
		isContainer: () => false,
	};
}

describe("model CapabilityGroup (read-only slice)", () => {
	it("is a group with all 8 model actions and a read-only default", () => {
		const group = createModelCapabilityGroup(deps());
		expect(isCapabilityGroup(group)).toBe(true);
		expect(Object.keys(group.actions).sort()).toEqual([
			"base-url",
			"current",
			"doctor",
			"env",
			"fallback",
			"providers",
			"reset",
			"set",
		]);
		expect(group.defaultAction).toBe("current");
	});

	it("dispatches a mutator (`set`) through the group to its builder", async () => {
		const d = deps({ modelProvider: "ollama" });
		const group = createModelCapabilityGroup(d);
		const resolved = resolveGroupAction(group, ["set", "ollama/llama3.2"]);
		expect(resolved?.key).toBe("set");
		const envelope = await resolved!.action.run(resolved!.input);
		expect(envelope.ok).toBe(true);
		expect(d.saveTokens).toHaveBeenCalledTimes(1);
	});

	it("dispatches `reset --scope worker` through the group", async () => {
		const d = deps({ modelRoutes: { worker: "ollama/llama3.2" } });
		const group = createModelCapabilityGroup(d);
		const resolved = resolveGroupAction(group, ["reset", "--scope", "worker"]);
		expect(resolved?.key).toBe("reset");
		const envelope = await resolved!.action.run(resolved!.input);
		expect(envelope.ok).toBe(true);
		expect(d.saveTokens).toHaveBeenCalledTimes(1);
	});

	it("carries multi-surface hints from one declaration (cli + http + tui)", () => {
		const group = createModelCapabilityGroup(deps());
		expect(group.transports?.cli).toBeDefined();
		expect(group.transports?.http).toEqual({ method: "POST", path: "/model" });
		expect(group.renderers?.tui?.shortcut).toBe("ctrl+m");
	});

	it("bare invocation resolves to the read-only current default", async () => {
		const group = createModelCapabilityGroup(deps({ modelProvider: "ollama" }));
		const resolved = resolveGroupAction(group, []);
		expect(resolved?.key).toBe("current");
		const envelope = await resolved!.action.run(resolved!.input);
		expect(envelope.ok).toBe(true);
		expect((envelope as { operation?: string }).operation).toBe("current");
	});

	it("`providers` returns the known-providers envelope", async () => {
		const group = createModelCapabilityGroup(deps());
		const resolved = resolveGroupAction(group, ["providers"]);
		const envelope = await resolved!.action.run(resolved!.input);
		expect(envelope.ok).toBe(true);
		expect((envelope as { operation?: string }).operation).toBe("providers");
		expect(
			(envelope as { providers?: unknown[] }).providers?.length ?? 0,
		).toBeGreaterThan(0);
	});

	it("`doctor` probes via the injected fetch and returns an envelope", async () => {
		const d = deps({ modelProvider: "ollama" });
		const group = createModelCapabilityGroup(d);
		const resolved = resolveGroupAction(group, ["doctor"]);
		const envelope = await resolved!.action.run(resolved!.input);
		expect(envelope.ok).toBe(true);
		expect((envelope as { operation?: string }).operation).toBe("doctor");
	});

	// The rich model grammar moved from parseChatLine (packages/cli) to the
	// group's surface-neutral `resolve` here. Pin the token→resolution mapping
	// (what the legacy parseModelCommand accepted) so the slash form's ergonomics
	// survive the migration on every surface that hands over raw tokens.
	describe("resolveModelGrammar (the group's token grammar)", () => {
		it("bare tokens read current", () => {
			expect(resolveModelGrammar([])).toEqual({ key: "current", tokens: [] });
			expect(resolveModelGrammar(["current"])).toEqual({
				key: "current",
				tokens: [],
			});
		});

		it("providers passes through", () => {
			expect(resolveModelGrammar(["providers"])).toEqual({
				key: "providers",
				tokens: [],
			});
		});

		it("bare-ref sugar → set default <ref>", () => {
			expect(resolveModelGrammar(["openai/gpt-5.5"])).toEqual({
				key: "set",
				tokens: ["openai/gpt-5.5"],
			});
		});

		it("scope-first sugar → set --scope <scope> <ref>", () => {
			expect(
				resolveModelGrammar(["worker", "openai/gpt-5.3-codex-spark"]),
			).toEqual({
				key: "set",
				tokens: ["--scope", "worker", "openai/gpt-5.3-codex-spark"],
			});
			// Case-insensitive scope, matching the legacy parser.
			expect(resolveModelGrammar(["Worker", "x/y"])).toEqual({
				key: "set",
				tokens: ["--scope", "worker", "x/y"],
			});
		});

		it("explicit set --scope passes through unchanged", () => {
			expect(
				resolveModelGrammar(["set", "--scope", "monitor", "openai/gpt-5.5"]),
			).toEqual({
				key: "set",
				tokens: ["--scope", "monitor", "openai/gpt-5.5"],
			});
		});

		it("reset accepts a bare scope positional (normalized to --scope)", () => {
			expect(resolveModelGrammar(["reset", "worker"])).toEqual({
				key: "reset",
				tokens: ["--scope", "worker"],
			});
			expect(resolveModelGrammar(["reset", "--scope", "monitor"])).toEqual({
				key: "reset",
				tokens: ["--scope", "monitor"],
			});
		});

		it("fallback and base-url pass through their value", () => {
			expect(resolveModelGrammar(["fallback", "off"])).toEqual({
				key: "fallback",
				tokens: ["off"],
			});
			expect(
				resolveModelGrammar(["base-url", "http://127.0.0.1:8000"]),
			).toEqual({ key: "base-url", tokens: ["http://127.0.0.1:8000"] });
		});

		it("a lone scope with no ref defers to the generic default (null)", () => {
			expect(resolveModelGrammar(["worker"])).toBeNull();
		});
	});

	// End-to-end: the grammar wins inside resolveGroupAction, so `/model
	// worker <ref>` resolves the `set` child with scope=worker parsed into input.
	it("resolveGroupAction applies the grammar: `worker <ref>` → set scope=worker", async () => {
		const d = deps({ modelProvider: "ollama" });
		const group = createModelCapabilityGroup(d);
		const resolved = resolveGroupAction(group, [
			"worker",
			"openai/gpt-5.3-codex-spark",
		]);
		expect(resolved?.key).toBe("set");
		expect(resolved?.input.options.scope).toBe("worker");
		expect(resolved?.input.args.ref).toBe("openai/gpt-5.3-codex-spark");
		const envelope = await resolved!.action.run(resolved!.input);
		expect(envelope.ok).toBe(true);
		expect(d.saveTokens).toHaveBeenCalledTimes(1);
	});

	it("resolveGroupAction applies the grammar: bare ref → set scope=default", () => {
		const group = createModelCapabilityGroup(deps({ modelProvider: "ollama" }));
		const resolved = resolveGroupAction(group, ["openai/gpt-5.5"]);
		expect(resolved?.key).toBe("set");
		expect(resolved?.input.options.scope).toBe("default");
		expect(resolved?.input.args.ref).toBe("openai/gpt-5.5");
	});

	// `model env` legacy: hint line unless --shell; the hook reconstructs the
	// exact shell exports from the envelope's ordered managedKeys + env map.
	it("`env` renders the hint line without --shell and shell exports with it", async () => {
		const d = deps({ modelProvider: "ollama", modelId: "llama3.2" });
		const group = createModelCapabilityGroup(d);
		const resolved = resolveGroupAction(group, ["env"]);
		const envelope = await resolved!.action.run(resolved!.input);
		const hooks = modelCapabilityHooks("env");

		const hint = hooks.renderText!(envelope, {
			...resolved!.input,
			options: {},
		} as CapabilityInput);
		expect(hint).toBe("Use --shell to print model runtime exports.");

		const shell = hooks.renderText!(envelope, {
			...resolved!.input,
			options: { shell: true },
		} as CapabilityInput);
		expect(shell).toContain("export MODEL_PROVIDER='ollama'");
		expect(shell).toContain("export REFARM_MANAGED_MODEL_ENV_KEYS=");
	});
});
