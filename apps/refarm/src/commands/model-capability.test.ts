import {
	isCapabilityGroup,
	resolveGroupAction,
} from "@refarm.dev/cli/capabilities";
import { describe, expect, it, vi } from "vitest";

import { createModelCapabilityGroup } from "./model-capability.js";
import type { ModelCommandDeps, ModelTokens } from "./model.js";

function deps(tokens: Partial<ModelTokens> = {}): ModelCommandDeps {
	return {
		loadTokens: async () => tokens as ModelTokens,
		saveTokens: async () => ({}),
		fetch: vi.fn(async () => ({ ok: false }) as unknown as Response),
		isContainer: () => false,
	};
}

describe("model CapabilityGroup (read-only slice)", () => {
	it("is a group with the read-only sub-actions and a read-only default", () => {
		const group = createModelCapabilityGroup(deps());
		expect(isCapabilityGroup(group)).toBe(true);
		expect(Object.keys(group.actions).sort()).toEqual([
			"current",
			"doctor",
			"providers",
		]);
		expect(group.defaultAction).toBe("current");
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
});
