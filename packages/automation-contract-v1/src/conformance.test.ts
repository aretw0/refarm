import { describe, it, expect } from "vitest";
import { runAutomationV1Conformance } from "./conformance.js";
import { createInMemoryAutomationAdapter } from "./in-memory.js";

const STATIC_BODY = {
	type: "static" as const,
	effort: { direction: "test direction", tasks: [] },
};

const TEMPLATE_BODY = {
	type: "template" as const,
	effort: { direction: "hello {{name}}", tasks: [] },
	inputSchema: { type: "object", properties: { name: { type: "string" } } },
};

const PLUGIN_BODY = {
	type: "plugin" as const,
	pluginId: "test-plugin",
	fn: "buildEffort",
};

describe("AutomationAdapter conformance — in-memory (static body)", () => {
	it("passes all checks", async () => {
		const adapter = createInMemoryAutomationAdapter({ body: STATIC_BODY });
		const result = await runAutomationV1Conformance(adapter);
		expect(result.failures).toEqual([]);
		expect(result.pass).toBe(true);
	});
});

describe("AutomationAdapter conformance — in-memory (template body)", () => {
	it("passes all checks", async () => {
		const adapter = createInMemoryAutomationAdapter({ body: TEMPLATE_BODY });
		const result = await runAutomationV1Conformance(adapter);
		expect(result.failures).toEqual([]);
		expect(result.pass).toBe(true);
	});
});

describe("AutomationAdapter conformance — in-memory (plugin body)", () => {
	it("passes all checks", async () => {
		const adapter = createInMemoryAutomationAdapter({
			body: PLUGIN_BODY,
			pluginFn: (_input) => ({
				id: crypto.randomUUID(),
				direction: "plugin-generated",
				tasks: [],
				submittedAt: new Date().toISOString(),
			}),
		});
		const result = await runAutomationV1Conformance(adapter);
		expect(result.failures).toEqual([]);
		expect(result.pass).toBe(true);
	});
});

describe("createInMemoryAutomationAdapter — status transitions", () => {
	it("create() always starts as draft", async () => {
		const adapter = createInMemoryAutomationAdapter();
		const a = await adapter.create({ name: "test", body: STATIC_BODY, triggers: [{ type: "manual" }] });
		expect(a.status).toBe("draft");
	});

	it("full lifecycle: draft → ready → active → ready → draft → archived", async () => {
		const adapter = createInMemoryAutomationAdapter();
		const a = await adapter.create({ name: "test", body: STATIC_BODY, triggers: [{ type: "manual" }] });
		expect((await adapter.validate(a.id)).status).toBe("ready");
		expect((await adapter.activate(a.id)).status).toBe("active");
		expect((await adapter.deactivate(a.id)).status).toBe("ready");
		expect((await adapter.revert(a.id)).status).toBe("draft");
		expect((await adapter.archive(a.id)).status).toBe("archived");
	});

	it("invalid transitions throw", async () => {
		const adapter = createInMemoryAutomationAdapter();
		const a = await adapter.create({ name: "test", body: STATIC_BODY, triggers: [{ type: "manual" }] });
		// draft → active is invalid (must go through ready first)
		await expect(adapter.activate(a.id)).rejects.toThrow();
	});
});

describe("createInMemoryAutomationAdapter — trigger", () => {
	it("trigger(active) returns Effort with direction from static body", async () => {
		const adapter = createInMemoryAutomationAdapter({ body: STATIC_BODY });
		const a = await adapter.create({ name: "test", body: STATIC_BODY, triggers: [{ type: "manual" }] });
		await adapter.validate(a.id);
		await adapter.activate(a.id);
		const effort = await adapter.trigger(a.id);
		expect(effort).not.toBeNull();
		expect(effort!.direction).toBe("test direction");
	});

	it("trigger(active) interpolates template body", async () => {
		const adapter = createInMemoryAutomationAdapter({ body: TEMPLATE_BODY });
		const a = await adapter.create({ name: "test", body: TEMPLATE_BODY, triggers: [{ type: "manual" }] });
		await adapter.validate(a.id);
		await adapter.activate(a.id);
		const effort = await adapter.trigger(a.id, { name: "World" });
		expect(effort!.direction).toBe("hello World");
	});

	it("trigger(draft) returns null", async () => {
		const adapter = createInMemoryAutomationAdapter();
		const a = await adapter.create({ name: "test", body: STATIC_BODY, triggers: [{ type: "manual" }] });
		const effort = await adapter.trigger(a.id);
		expect(effort).toBeNull();
	});

	it("trigger(unknown) returns null", async () => {
		const adapter = createInMemoryAutomationAdapter();
		expect(await adapter.trigger("__nonexistent__")).toBeNull();
	});
});

describe("createInMemoryAutomationAdapter — summary + query", () => {
	it("summary counts correctly", async () => {
		const adapter = createInMemoryAutomationAdapter();
		await adapter.create({ name: "a", body: STATIC_BODY, triggers: [{ type: "manual" }] });
		const s = await adapter.summary!();
		expect(s.total).toBe(1);
		expect(s.draft).toBe(1);
		expect(s.ready).toBe(0);
		expect(s.active).toBe(0);
		expect(s.archived).toBe(0);
	});

	it("query filters by status", async () => {
		const adapter = createInMemoryAutomationAdapter();
		const a = await adapter.create({ name: "a", body: STATIC_BODY, triggers: [{ type: "manual" }] });
		await adapter.validate(a.id);
		const ready = await adapter.query!({ status: "ready" });
		expect(ready.some((x) => x.id === a.id)).toBe(true);
		const active = await adapter.query!({ status: "active" });
		expect(active.some((x) => x.id === a.id)).toBe(false);
	});
});
