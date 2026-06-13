import { describe, expect, it, vi } from "vitest";
import { submitEffortWithRuntimeRecovery } from "../../src/commands/chat-runtime-recovery.js";

const effort = {};

describe("chat runtime recovery", () => {
	it("restarts the runtime and retries once when effort submission loses the sidecar", async () => {
		const onRecoveringRuntime = vi.fn();
		const submitted: unknown[] = [];
		let recoverCalls = 0;

		const effortId = await submitEffortWithRuntimeRecovery(effort, {
			async submitEffort(value) {
				submitted.push(value);
				if (submitted.length === 1) throw new Error("ECONNREFUSED");
				return "effort-1";
			},
			async recoverRuntime() {
				recoverCalls++;
				return true;
			},
			onRecoveringRuntime,
		});

		expect(effortId).toBe("effort-1");
		expect(onRecoveringRuntime).toHaveBeenCalledOnce();
		expect(recoverCalls).toBe(1);
		expect(submitted).toEqual([effort, effort]);
	});

	it("keeps the original error when runtime recovery is declined or fails", async () => {
		const error = new Error("fetch failed");
		let submitCalls = 0;
		let recoverCalls = 0;

		await expect(
			submitEffortWithRuntimeRecovery(effort, {
				async submitEffort() {
					submitCalls++;
					throw error;
				},
				async recoverRuntime() {
					recoverCalls++;
					return false;
				},
			}),
		).rejects.toThrow(error);

		expect(recoverCalls).toBe(1);
		expect(submitCalls).toBe(1);
	});

	it("does not restart the runtime for non-connection submission errors", async () => {
		let submitCalls = 0;
		let recoverCalls = 0;

		await expect(
			submitEffortWithRuntimeRecovery(effort, {
				async submitEffort() {
					submitCalls++;
					throw new Error("Runtime HTTP 500");
				},
				async recoverRuntime() {
					recoverCalls++;
					return true;
				},
			}),
		).rejects.toThrow("Runtime HTTP 500");

		expect(recoverCalls).toBe(0);
		expect(submitCalls).toBe(1);
	});
});
