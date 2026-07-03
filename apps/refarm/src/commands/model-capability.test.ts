import type { CapabilityInput } from "@refarm.dev/cli/capabilities";
import {
	isCapabilityGroup,
	resolveGroupAction,
} from "@refarm.dev/cli/capabilities";
import { describe, expect, it, vi } from "vitest";

import {
	createModelCapabilityGroup,
	modelCapabilityHooks,
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
