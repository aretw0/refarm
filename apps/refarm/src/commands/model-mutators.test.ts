import { describe, expect, it, vi } from "vitest";

import {
	buildResetScopedModelEnvelope,
	buildSetFallbackEnvelope,
	buildSetModelBaseUrlEnvelope,
	buildSetModelEnvelope,
	type ModelCommandDeps,
	type ModelTokens,
} from "./model.js";

/**
 * Lock the mutator builders' behavior. They validate + persist and RETURN an
 * envelope (no console/exitCode) — the seam the model capability plugs into.
 * These tests pin success (saveTokens called + ok envelope) and error (ok:false
 * envelope, no save) so the pure refactor cannot silently drift.
 */
function deps(tokens: Partial<ModelTokens> = {}): ModelCommandDeps & {
	saveTokens: ReturnType<typeof vi.fn>;
} {
	const saveTokens = vi.fn(async () => ({}));
	return {
		loadTokens: async () => tokens as ModelTokens,
		saveTokens,
		fetch: vi.fn(),
		isContainer: () => false,
	};
}

describe("model mutator builders (pure, envelope-returning)", () => {
	it("buildSetModelEnvelope persists a valid ref and returns ok", async () => {
		const d = deps({ modelProvider: "ollama" });
		const envelope = await buildSetModelEnvelope("ollama/llama3.2", "default", d);
		expect(envelope.ok).toBe(true);
		expect(d.saveTokens).toHaveBeenCalledTimes(1);
		expect((envelope as { action?: string }).action).toBe("set-route");
	});

	it("buildSetModelEnvelope returns an error envelope (no save) on empty ref", async () => {
		const d = deps({ modelProvider: "ollama" });
		const envelope = await buildSetModelEnvelope("", "default", d);
		expect(envelope.ok).toBe(false);
		expect((envelope as { error?: string }).error).toBe("empty-model-ref");
		expect(d.saveTokens).not.toHaveBeenCalled();
	});

	it("buildSetFallbackEnvelope: valid ref persists + set-fallback; empty errors without save", async () => {
		const ok = deps({ modelProvider: "ollama" });
		const okEnv = await buildSetFallbackEnvelope("ollama/llama3.2", ok);
		expect(okEnv.ok).toBe(true);
		expect(ok.saveTokens).toHaveBeenCalledTimes(1);
		expect((okEnv as { action?: string }).action).toBe("set-fallback");

		const bad = deps({ modelProvider: "ollama" });
		const badEnv = await buildSetFallbackEnvelope("", bad);
		expect(badEnv.ok).toBe(false);
		expect(bad.saveTokens).not.toHaveBeenCalled();
	});

	it("buildSetFallbackEnvelope: 'off' disables the fallback (persists disable)", async () => {
		const d = deps({
			modelProvider: "ollama",
			modelFallbackProvider: "openai",
			modelFallbackModelId: "gpt-4",
		});
		const envelope = await buildSetFallbackEnvelope("off", d);
		expect(envelope.ok).toBe(true);
		expect((envelope as { action?: string }).action).toBe("disable-fallback");
		expect(d.saveTokens).toHaveBeenCalledTimes(1);
	});

	it("buildResetScopedModelEnvelope: worker scope resets; default scope is rejected", async () => {
		const worker = deps({ modelRoutes: { worker: "ollama/llama3.2" } });
		const workerEnv = await buildResetScopedModelEnvelope("worker", worker);
		expect(workerEnv.ok).toBe(true);
		expect(worker.saveTokens).toHaveBeenCalledTimes(1);

		const def = deps();
		const defEnv = await buildResetScopedModelEnvelope("default", def);
		expect(defEnv.ok).toBe(false);
		expect(def.saveTokens).not.toHaveBeenCalled();
	});

	it("buildSetModelBaseUrlEnvelope: sets a url; 'off' disables it", async () => {
		const set = deps();
		const setEnv = await buildSetModelBaseUrlEnvelope("http://localhost:11434", set);
		expect(setEnv.ok).toBe(true);
		expect((setEnv as { action?: string }).action).toBe("set-base-url");
		expect(set.saveTokens).toHaveBeenCalledTimes(1);

		const off = deps({ modelBaseUrl: "http://localhost:11434" });
		const offEnv = await buildSetModelBaseUrlEnvelope("off", off);
		expect(offEnv.ok).toBe(true);
		expect((offEnv as { action?: string }).action).toBe("disable-base-url");
	});
});
