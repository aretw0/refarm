import { describe, expect, it, vi } from "vitest";

import type { BaseSurfaceModelInput } from "@refarm.dev/operator-state";
import { resolveBaseSurfaceStatus } from "../../src/commands/base-surface-status.js";

describe("resolveBaseSurfaceStatus", () => {
	it("adapts runtime, model, and health payloads into the base model", async () => {
		const model = await resolveBaseSurfaceStatus({
			resolveOperationalReadiness: vi.fn().mockResolvedValue([]),
			resolveRuntime: vi.fn().mockResolvedValue({
				command: "runtime",
				operation: "status",
				ok: false,
				configuredEngine: "auto",
				activeEngine: "rust",
				ready: false,
				sidecarUrl: "http://127.0.0.1:42001",
				sidecarProbe: {
					url: "http://127.0.0.1:42001/efforts/summary",
					ready: false,
					error: "connect ECONNREFUSED 127.0.0.1:42001",
				},
				nextAction: "refarm runtime ensure --wait --next-command",
				nextActions: ["refarm runtime ensure --wait --next-command"],
				nextCommand: "refarm runtime ensure --wait --next-command",
				nextCommands: ["refarm runtime ensure --wait --next-command"],
			}),
			resolveModel: vi.fn().mockResolvedValue({
				command: "model",
				operation: "current",
				ok: true,
				current: {
					ref: "openai-codex/gpt-5.3-codex-spark",
					provider: "openai-codex",
					modelId: "gpt-5.3-codex-spark",
				},
				credential: {
					state: "silo-oauth",
					status: "Silo OAuth (openai-codex)",
					envKey: "OPENAI_CODEX_ACCESS_TOKEN",
				},
				routes: {},
				nextAction: null,
				nextActions: [],
				nextCommand: null,
				nextCommands: [],
			}),
			resolveHealth: vi.fn().mockResolvedValue({
				command: "health",
				operation: "audit",
				ok: true,
				issueCount: 0,
				recommendations: [],
				nextAction: null,
				nextActions: [],
				nextCommand: null,
				nextCommands: [],
			}),
		});

		expect(model.ok).toBe(false);
		expect(model.units.map((unit) => unit.id)).toEqual([
			"runtime",
			"model",
			"health",
		]);
		expect(model.nextCommand).toBe("refarm runtime ensure --wait --next-command");
	});

	it("samples runtime before slower base probes", async () => {
		const calls: string[] = [];
		let releaseRuntime: (() => void) | undefined;
		const runtime = vi.fn(
			() =>
				new Promise<BaseSurfaceModelInput["runtime"]>((resolve) => {
					calls.push("runtime:start");
					releaseRuntime = () => {
						calls.push("runtime:end");
						resolve({
							command: "runtime",
							operation: "status",
							ok: true,
							configuredEngine: "auto",
							activeEngine: "rust",
							ready: true,
							sidecarUrl: "http://127.0.0.1:42001",
							sidecarProbe: {
								url: "http://127.0.0.1:42001/efforts/summary",
								ready: true,
								status: 200,
							},
							nextAction: null,
							nextActions: [],
							nextCommand: null,
							nextCommands: [],
						});
					};
				}),
		);
		const model = vi.fn(async () => {
			calls.push("model");
			return {
				command: "model" as const,
				operation: "current" as const,
				ok: true,
				current: {
					ref: "openai-codex/gpt-5.3-codex-spark",
					provider: "openai-codex",
					modelId: "gpt-5.3-codex-spark",
				},
				credential: {
					state: "silo-oauth",
					status: "Silo OAuth (openai-codex)",
					envKey: "OPENAI_CODEX_ACCESS_TOKEN",
				},
				routes: {},
				nextAction: null,
				nextActions: [],
				nextCommand: null,
				nextCommands: [],
			};
		});
		const health = vi.fn(async () => {
			calls.push("health");
			return {
				command: "health" as const,
				operation: "audit" as const,
				ok: true,
				issueCount: 0,
				recommendations: [],
				nextAction: null,
				nextActions: [],
				nextCommand: null,
				nextCommands: [],
			};
		});

		const pending = resolveBaseSurfaceStatus({
			resolveOperationalReadiness: vi.fn().mockResolvedValue([]),
			resolveRuntime: runtime,
			resolveModel: model,
			resolveHealth: health,
		});
		await Promise.resolve();

		expect(calls).toEqual(["runtime:start"]);
		expect(model).not.toHaveBeenCalled();
		expect(health).not.toHaveBeenCalled();

		releaseRuntime?.();
		await pending;

		expect(calls).toEqual(["runtime:start", "runtime:end", "model", "health"]);
	});

	it("adiciona unit de atenção do operador quando resolver retorna escopo", async () => {
		const model = await resolveBaseSurfaceStatus({
			resolveOperationalReadiness: vi.fn().mockResolvedValue([]),
			resolveRuntime: vi.fn().mockResolvedValue({
				command: "runtime",
				operation: "status",
				ok: true,
				configuredEngine: "auto",
				activeEngine: "rust",
				ready: true,
				nextAction: null,
				nextActions: [],
				nextCommand: null,
				nextCommands: [],
			}),
			resolveModel: vi.fn().mockResolvedValue({
				command: "model",
				operation: "current",
				ok: true,
				current: { ref: "openai-codex/gpt-5.3-codex-spark" },
				credential: { state: "silo-oauth" },
				nextAction: null,
				nextActions: [],
				nextCommand: null,
				nextCommands: [],
			}),
			resolveHealth: vi.fn().mockResolvedValue({
				command: "health",
				operation: "audit",
				ok: true,
				issueCount: 0,
				recommendations: [],
				nextAction: null,
				nextActions: [],
				nextCommand: null,
				nextCommands: [],
			}),
			resolveOperatorAttention: vi.fn().mockResolvedValue({
				scope: "connection-up:ovpn-serpro",
				armed: false,
				windowMs: 60000,
				expiresAt: null,
			}),
		}, {});

		expect(model.units.map((unit) => unit.id)).toEqual([
			"runtime",
			"model",
			"health",
			"operator-attention",
		]);
		expect(model.units[3]).toMatchObject({
			id: "operator-attention",
			state: "blocked",
			severity: "warning",
			summary: "Canal de atenção ainda não armado para 'connection-up:ovpn-serpro'.",
		});
		expect(model.nextCommand).toBe(
			"node scripts/operator-attention-gate.mjs 'connection-up:ovpn-serpro' --prepare-only --window-ms 60000 --json",
		);
	});

	it("encaminha options explícitas de atenção para o resolver opcional", async () => {
		const resolveOperatorAttention = vi.fn().mockResolvedValue(null);

		await resolveBaseSurfaceStatus(
			{
				resolveOperationalReadiness: vi.fn().mockResolvedValue([]),
				resolveRuntime: vi.fn().mockResolvedValue({
					command: "runtime",
					operation: "status",
					ok: true,
					nextAction: null,
					nextActions: [],
					nextCommand: null,
					nextCommands: [],
				}),
				resolveModel: vi.fn().mockResolvedValue({
					command: "model",
					operation: "current",
					ok: true,
					nextAction: null,
					nextActions: [],
					nextCommand: null,
					nextCommands: [],
				}),
				resolveHealth: vi.fn().mockResolvedValue({
					command: "health",
					operation: "audit",
					ok: true,
					issueCount: 0,
					recommendations: [],
					nextAction: null,
					nextActions: [],
					nextCommand: null,
					nextCommands: [],
				}),
				resolveOperatorAttention,
			},
			{
				operatorAttentionScope: "connection-up:mobile",
				operatorAttentionWindowMs: 120000,
				operatorAttentionProfile: "mobile-ready",
			},
		);

		expect(resolveOperatorAttention).toHaveBeenCalledWith({
			operatorAttentionScope: "connection-up:mobile",
			operatorAttentionWindowMs: 120000,
			operatorAttentionProfile: "mobile-ready",
		});
	});

	it("aplica defaults do attention-profile no resolver interno", async () => {
		const model = await resolveBaseSurfaceStatus(
			{
				resolveOperationalReadiness: vi.fn().mockResolvedValue([]),
				resolveRuntime: vi.fn().mockResolvedValue({
					command: "runtime",
					operation: "status",
					ok: true,
					nextAction: null,
					nextActions: [],
					nextCommand: null,
					nextCommands: [],
				}),
				resolveModel: vi.fn().mockResolvedValue({
					command: "model",
					operation: "current",
					ok: true,
					nextAction: null,
					nextActions: [],
					nextCommand: null,
					nextCommands: [],
				}),
				resolveHealth: vi.fn().mockResolvedValue({
					command: "health",
					operation: "audit",
					ok: true,
					issueCount: 0,
					recommendations: [],
					nextAction: null,
					nextActions: [],
					nextCommand: null,
					nextCommands: [],
				}),
			},
			{ operatorAttentionProfile: "cross-device-handoff" },
		);

		expect(model.units.map((unit) => unit.id)).toContain("operator-attention");
		expect(model.units.find((unit) => unit.id === "operator-attention")).toMatchObject({
			state: "blocked",
			summary: "Canal de atenção ainda não armado para 'attention:cross-device-handoff'.",
		});
		expect(model.nextCommand).toBe(
			"node scripts/operator-attention-gate.mjs 'attention:cross-device-handoff' --prepare-only --window-ms 120000 --json",
		);
	});

	it("falha com profile desconhecido", async () => {
		await expect(
			resolveBaseSurfaceStatus(
				{
					resolveOperationalReadiness: vi.fn().mockResolvedValue([]),
					resolveRuntime: vi.fn().mockResolvedValue({
						command: "runtime",
						operation: "status",
						ok: true,
						nextAction: null,
						nextActions: [],
						nextCommand: null,
						nextCommands: [],
					}),
					resolveModel: vi.fn().mockResolvedValue({
						command: "model",
						operation: "current",
						ok: true,
						nextAction: null,
						nextActions: [],
						nextCommand: null,
						nextCommands: [],
					}),
					resolveHealth: vi.fn().mockResolvedValue({
						command: "health",
						operation: "audit",
						ok: true,
						issueCount: 0,
						recommendations: [],
						nextAction: null,
						nextActions: [],
						nextCommand: null,
						nextCommands: [],
					}),
				},
				{ operatorAttentionProfile: "unknown-profile" },
			),
		).rejects.toThrow(/Unknown --attention-profile/);
	});
});
