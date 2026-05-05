import { describe, expect, it, vi } from "vitest";
import { ContextRegistry, buildSystemPrompt } from "./registry.js";
import { CONTEXT_CAPABILITY, type ContextEntry, type ContextProvider } from "./types.js";

function makeProvider(
	name: string,
	entries: ContextEntry[],
	priority = 100,
): ContextProvider {
	return {
		name,
		capability: CONTEXT_CAPABILITY,
		provide: vi.fn().mockResolvedValue(
			entries.map((entry) => ({ ...entry, priority: entry.priority ?? priority })),
		),
	};
}

function makeThrowingProvider(name: string): ContextProvider {
	return {
		name,
		capability: CONTEXT_CAPABILITY,
		provide: vi.fn().mockRejectedValue(new Error("provider exploded")),
	};
}

describe("ContextRegistry", () => {
	it("collects entries from all providers", async () => {
		const providerA = makeProvider("a", [{ label: "a", content: "alpha" }]);
		const providerB = makeProvider("b", [{ label: "b", content: "beta" }]);
		const registry = new ContextRegistry([providerA, providerB]);
		const entries = await registry.collect({ cwd: "/project" });
		expect(entries).toHaveLength(2);
		expect(entries.map((entry) => entry.label)).toContain("a");
		expect(entries.map((entry) => entry.label)).toContain("b");
	});

	it("isolates a throwing provider while keeping others", async () => {
		const good = makeProvider("good", [{ label: "ok", content: "data" }]);
		const bad = makeThrowingProvider("bad");
		const registry = new ContextRegistry([good, bad]);
		const entries = await registry.collect({ cwd: "/" });
		expect(entries).toHaveLength(1);
		expect(entries[0].label).toBe("ok");
	});

	it("collects providers in parallel via allSettled", async () => {
		const order: string[] = [];
		const slow: ContextProvider = {
			name: "slow",
			capability: CONTEXT_CAPABILITY,
			provide: async () => {
				await new Promise((resolve) => setTimeout(resolve, 15));
				order.push("slow");
				return [{ label: "slow", content: "x" }];
			},
		};
		const fast: ContextProvider = {
			name: "fast",
			capability: CONTEXT_CAPABILITY,
			provide: async () => {
				order.push("fast");
				return [{ label: "fast", content: "y" }];
			},
		};
		const registry = new ContextRegistry([slow, fast]);
		const entries = await registry.collect({ cwd: "/" });
		expect(entries).toHaveLength(2);
		expect(order).toEqual(["fast", "slow"]);
	});
});

describe("buildSystemPrompt", () => {
	it("sorts entries by priority and wraps with context blocks", () => {
		const prompt = buildSystemPrompt([
			{ label: "last", content: "Z", priority: 90 },
			{ label: "first", content: "A", priority: 10 },
		]);
		expect(prompt).toContain("You are pi-agent");
		expect(prompt).toContain("<contexts>");
		expect(prompt).toContain('<context label="first">');
		expect(prompt.indexOf("first")).toBeLessThan(prompt.indexOf("last"));
	});
});
