import { afterEach, describe, expect, it, vi } from "vitest";
import { loadRecentRuntimeSessions } from "../../src/commands/session-history.js";

describe("session history helpers", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("loads recent runtime sessions for operator resume", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				ok: true,
				json: vi.fn().mockResolvedValue({
					sessions: [
						{
							"@id": "urn:refarm:session:v1:olderaaaaaaaaaaaa",
							name: "older",
							created_at_ns: 10,
							leaf_entry_id: null,
						},
						{
							"@id": "urn:refarm:session:v1:newerbbbbbbbbbbbb",
							name: "newer",
							created_at_ns: 20,
							leaf_entry_id: "entry-1",
							participants: ["urn:refarm:agent:pi-agent"],
						},
					],
				}),
			}),
		);

		await expect(loadRecentRuntimeSessions()).resolves.toEqual([
			{
				sessionId: "urn:refarm:session:v1:newerbbbbbbbbbbbb",
				shortId: "bbbbbbbbbbbb",
				name: "newer",
				createdAtNs: 20,
				hasHistory: true,
				canonicalParticipants: ["urn:refarm:agent:runtime-agent"],
				participantAliases: [
					{
						participantId: "urn:refarm:agent:pi-agent",
						canonicalParticipantId: "urn:refarm:agent:runtime-agent",
					},
				],
				showCommand: "refarm sessions show bbbbbbbbbbbb --json",
				useCommand: "refarm sessions use bbbbbbbbbbbb --json",
			},
			{
				sessionId: "urn:refarm:session:v1:olderaaaaaaaaaaaa",
				shortId: "aaaaaaaaaaaa",
				name: "older",
				createdAtNs: 10,
				hasHistory: false,
				showCommand: "refarm sessions show aaaaaaaaaaaa --json",
				useCommand: "refarm sessions use aaaaaaaaaaaa --json",
			},
		]);
	});

	it("returns an empty list when runtime sessions are unavailable", async () => {
		vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));

		await expect(loadRecentRuntimeSessions()).resolves.toEqual([]);
	});
});
