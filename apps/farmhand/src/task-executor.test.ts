import type { RuntimeTaskTarget } from "@refarm.dev/runtime";
import { describe, expect, it, vi } from "vitest";
import { executeTask } from "./task-executor.js";

const makeInstance = (callResult: unknown = { ok: true }) => ({
	call: vi.fn().mockResolvedValue(callResult),
});

const makeTractor = (instance?: ReturnType<typeof makeInstance>) => ({
	plugins: { get: vi.fn().mockReturnValue(instance) },
	storeNode: vi.fn().mockResolvedValue(undefined),
});

describe("executeTask", () => {
	it("calls instance.call with fn and args, writes ok result", async () => {
		const instance = makeInstance({ value: 42 });
		const tractor = makeTractor(instance);

		await executeTask(tractor as RuntimeTaskTarget, {
			taskId: "t1",
			effortId: "e1",
			pluginId: "my-plugin",
			fn: "process",
			args: { x: 1 },
		});

		expect(instance.call).toHaveBeenCalledWith("process", { x: 1 });
		expect(tractor.storeNode).toHaveBeenCalledWith(
			expect.objectContaining({
				"@type": "FarmhandTaskResult",
				"task:status": "ok",
				"task:result": JSON.stringify({ value: 42 }),
			}),
		);
	});

	it("writes error result when plugin is not loaded", async () => {
		const tractor = makeTractor(undefined);

		await executeTask(tractor as RuntimeTaskTarget, {
			taskId: "t2",
			effortId: "e2",
			pluginId: "missing-plugin",
			fn: "run",
			args: undefined,
		});

		expect(tractor.storeNode).toHaveBeenCalledWith(
			expect.objectContaining({
				"task:status": "error",
				"task:error": expect.stringContaining("missing-plugin"),
			}),
		);
	});

	it("writes error result when instance.call throws", async () => {
		const instance = { call: vi.fn().mockRejectedValue(new Error("boom")) };
		const tractor = makeTractor(instance);

		await executeTask(tractor as RuntimeTaskTarget, {
			taskId: "t3",
			effortId: "e3",
			pluginId: "p",
			fn: "f",
			args: null,
		});

		expect(tractor.storeNode).toHaveBeenCalledWith(
			expect.objectContaining({
				"task:status": "error",
				"task:error": "boom",
			}),
		);
	});

	it("writes error result when the runtime agent returns an error content payload", async () => {
		const instance = makeInstance({
			content: "[runtime-agent error] quota exceeded",
			model: "gpt-5.5",
		});
		const tractor = makeTractor(instance);

		await executeTask(tractor as RuntimeTaskTarget, {
			taskId: "t-error-content",
			effortId: "e-error-content",
			pluginId: "pi-agent",
			fn: "respond",
			args: "hello",
		});

		expect(tractor.storeNode).toHaveBeenCalledWith(
			expect.objectContaining({
				"task:status": "error",
				"task:error": "[runtime-agent error] quota exceeded",
				"task:result": JSON.stringify({
					content: "[runtime-agent error] quota exceeded",
					model: "gpt-5.5",
				}),
			}),
		);
	});

	it("writes error result when the runtime agent returns an error tuple payload", async () => {
		const instance = makeInstance([
			"[budget] MODEL_BUDGET_OPENAI_USD exceeded",
			[],
			0,
			0,
			0,
			0,
			"gpt-5.5",
			"{}",
		]);
		const tractor = makeTractor(instance);

		await executeTask(tractor as RuntimeTaskTarget, {
			taskId: "t-error-tuple",
			effortId: "e-error-tuple",
			pluginId: "pi-agent",
			fn: "respond",
			args: "hello",
		});

		expect(tractor.storeNode).toHaveBeenCalledWith(
			expect.objectContaining({
				"task:status": "error",
				"task:error": "[budget] MODEL_BUDGET_OPENAI_USD exceeded",
				"task:result": JSON.stringify([
					"[budget] MODEL_BUDGET_OPENAI_USD exceeded",
					[],
					0,
					0,
					0,
					0,
					"gpt-5.5",
					"{}",
				]),
			}),
		);
	});

	it("stringifies object args for respond", async () => {
		const instance = makeInstance({ content: "ok" });
		const tractor = makeTractor(instance);

		await executeTask(tractor as RuntimeTaskTarget, {
			taskId: "t4",
			effortId: "e4",
			pluginId: "pi-agent",
			fn: "respond",
			args: { prompt: "hello" },
		});

		expect(instance.call).toHaveBeenCalledWith(
			"respond",
			JSON.stringify({ prompt: "hello" }),
		);
	});

	it("resolves runtime-agent task aliases to the canonical plugin id", async () => {
		const instance = makeInstance({ content: "ok" });
		const tractor = makeTractor(instance);

		await executeTask(tractor as RuntimeTaskTarget, {
			taskId: "t5",
			effortId: "e5",
			pluginId: "@refarm.dev/pi-agent",
			fn: "respond",
			args: { prompt: "hello" },
		});

		expect(tractor.plugins.get).toHaveBeenCalledWith("@refarm/pi-agent");
		expect(instance.call).toHaveBeenCalledWith(
			"respond",
			JSON.stringify({ prompt: "hello" }),
		);
	});
});
