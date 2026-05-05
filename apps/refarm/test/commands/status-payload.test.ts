import { describe, expect, it, vi } from "vitest";
import { withResolvedStatusPayload } from "../../src/commands/status-payload.js";

function makeStatus() {
	return {
		schemaVersion: 1 as const,
		host: {
			app: "apps/refarm",
			command: "refarm",
			profile: "dev",
			mode: "headless",
		},
		renderer: {
			id: "refarm-headless",
			kind: "headless",
			capabilities: ["diagnostics"],
		},
		runtime: {
			ready: true,
			namespace: "refarm-main",
			databaseName: "refarm-main",
		},
		plugins: {
			installed: 0,
			active: 0,
			rejectedSurfaces: 0,
			surfaceActions: 0,
		},
		trust: {
			profile: "dev",
			warnings: 0,
			critical: 0,
		},
		streams: { active: 0, terminal: 0 },
		diagnostics: [],
	};
}

describe("withResolvedStatusPayload", () => {
	it("runs callback and closes payload shutdown", async () => {
		const shutdown = vi.fn().mockResolvedValue(undefined);
		const resolveStatusPayload = vi.fn().mockResolvedValue({
			json: makeStatus(),
			shutdown,
		});

		const result = await withResolvedStatusPayload({
			resolveStatusPayload,
			resolveOptions: { renderer: "headless" },
			run: (json) => json.renderer.kind,
		});

		expect(result).toBe("headless");
		expect(shutdown).toHaveBeenCalled();
	});

	it("still closes shutdown when callback throws", async () => {
		const shutdown = vi.fn().mockResolvedValue(undefined);
		const resolveStatusPayload = vi.fn().mockResolvedValue({
			json: makeStatus(),
			shutdown,
		});

		await expect(
			withResolvedStatusPayload({
				resolveStatusPayload,
				resolveOptions: { renderer: "headless" },
				run: () => {
					throw new Error("boom");
				},
			}),
		).rejects.toThrow(/boom/);

		expect(shutdown).toHaveBeenCalled();
	});
});
