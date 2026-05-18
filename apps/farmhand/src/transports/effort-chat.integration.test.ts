import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createInMemoryAutomationAdapter } from "@refarm.dev/automation-contract-v1";
import type { Task } from "@refarm.dev/effort-contract-v1";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FileTransportAdapter, type TaskExecutorFn } from "./file.js";

const TEST_BASE = path.join(os.tmpdir(), `refarm-effort-chat-${Date.now()}`);

describe("Effort chat integration", () => {
	afterEach(() => {
		fs.rmSync(TEST_BASE, { recursive: true, force: true });
	});

	it("turns a chat-shaped Automation trigger into a processed Effort", async () => {
		const executor = vi.fn(
			async (task: Task, effortId: string) => ({
				status: "ok" as const,
				result: {
					effortId,
					pluginId: task.pluginId,
					fn: task.fn,
					args: task.args,
				},
			}),
		);
		const effortTransport = new FileTransportAdapter(
			TEST_BASE,
			executor as TaskExecutorFn,
		);
		const automations = createInMemoryAutomationAdapter();

		const automation = await automations.create({
			name: "Submit REPL chat effort",
			description: "Maps a REPL chat command into an executable Effort.",
			triggers: [{ type: "manual" }],
			body: {
				type: "template",
				effort: {
					direction: "{{message}}",
					source: "farmhand:repl",
					tags: ["chat", "repl"],
					context: {
						channel: "effort-chat",
						replyTo: "terminal",
					},
					tasks: [
						{
							id: "chat-turn",
							pluginId: "@refarm.dev/model-mock",
							fn: "complete",
							args: {
								message: "{{message}}",
								sessionId: "{{sessionId}}",
							},
						},
					],
				},
			},
		});

		await automations.validate(automation.id);
		await automations.activate(automation.id);

		const effort = await automations.trigger(automation.id, {
			message: "Summarize the harvest plan",
			sessionId: "session-123",
		});

		expect(effort).not.toBeNull();
		expect(effort?.direction).toBe("Summarize the harvest plan");
		expect(effort?.source).toBe("farmhand:repl");

		const effortId = await effortTransport.submit(effort!);
		await effortTransport.process(effort!);

		const result = await effortTransport.query(effortId);
		expect(result?.status).toBe("done");
		expect(result?.results).toHaveLength(1);
		expect(result?.results[0]?.status).toBe("ok");
		expect(executor).toHaveBeenCalledWith(
			expect.objectContaining({
				id: "chat-turn",
				pluginId: "@refarm.dev/model-mock",
				fn: "complete",
			}),
			effortId,
		);

		const logs = await effortTransport.logs(effortId);
		expect(logs?.map((entry) => entry.event)).toContain("processing_finished");
	});
});
