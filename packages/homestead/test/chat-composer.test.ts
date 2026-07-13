import { describe, expect, it } from "vitest";
import {
	buildRespondEffort,
	COMPOSER_CANCEL_ACTION_ID,
	COMPOSER_SUBMIT_ACTION_ID,
	promptRefForEffort,
	renderChatComposerHtml,
	streamRefForEffort,
	streamRefForPrompt,
	submitComposerTurn,
	WEB_CHAT_EFFORT_SOURCE,
	type ComposerTransport,
} from "../src/sdk/chat-composer";
import type { Effort } from "@refarm.dev/effort-contract-v1";

const fixedDeps = {
	randomUUID: (() => {
		const ids = ["effort-id", "task-id"];
		return () => ids.shift() ?? "extra";
	})(),
	now: () => new Date("2026-07-13T12:00:00.000Z"),
};

describe("buildRespondEffort — mirrors the CLI respond effort shape", () => {
	it("builds a respond effort with the web source label", () => {
		const effort = buildRespondEffort(
			{ prompt: "what is CRDT?", sessionId: "urn:session:web-1" },
			fixedDeps,
		);
		expect(effort).toEqual({
			id: "effort-id",
			direction: "ask",
			tasks: [
				{
					id: "task-id",
					pluginId: "@refarm/agent",
					fn: "respond",
					args: {
						prompt: "what is CRDT?",
						system: "",
						session_id: "urn:session:web-1",
						history_turns: 20,
					},
				},
			],
			source: WEB_CHAT_EFFORT_SOURCE,
			submittedAt: "2026-07-13T12:00:00.000Z",
		} satisfies Effort);
	});

	it("routes by profile and omits a pinned route (ADR-012)", () => {
		const effort = buildRespondEffort(
			{ prompt: "hi", sessionId: "s", profile: "cheap", provider: "openai", model: "gpt" },
			fixedDeps,
		);
		const args = effort.tasks[0].args as Record<string, unknown>;
		expect(args.profile).toBe("cheap");
		expect(args.provider).toBeUndefined();
		expect(args.model).toBeUndefined();
	});

	it("pins provider/model when no profile is given", () => {
		const effort = buildRespondEffort(
			{ prompt: "hi", sessionId: "s", provider: "anthropic", model: "claude-sonnet-4-6" },
			fixedDeps,
		);
		const args = effort.tasks[0].args as Record<string, unknown>;
		expect(args.provider).toBe("anthropic");
		expect(args.model).toBe("claude-sonnet-4-6");
		expect(args.profile).toBeUndefined();
	});
});

describe("correlation — matches the sidecar's prompt_ref / stream_ref derivation", () => {
	it("derives the promptRef by stripping dashes (mirror of prompt_ref_from_effort)", () => {
		expect(promptRefForEffort("a1b2-c3d4-e5")).toBe("urn:sovereign:prompt-a1b2c3d4e5");
	});

	it("derives the streamRef from the promptRef", () => {
		expect(streamRefForPrompt("urn:sovereign:prompt-x")).toBe(
			"urn:tractor:stream:response:urn:sovereign:prompt-x",
		);
	});

	it("chains effort → stream ref end to end", () => {
		expect(streamRefForEffort("ab-cd")).toBe(
			"urn:tractor:stream:response:urn:sovereign:prompt-abcd",
		);
	});
});

describe("submitComposerTurn — uses the runtime-assigned id for correlation", () => {
	it("returns a handle whose refs derive from the id the RUNTIME assigned, not the local id", async () => {
		// The transport returns a DIFFERENT id than the effort's local id; the handle's
		// refs must follow the runtime's id so they match the emitted stream.
		const transport: ComposerTransport = {
			submitEffort: async () => "runtime-42",
			cancelEffort: async () => {},
		};
		const handle = await submitComposerTurn(
			transport,
			{ prompt: "hi", sessionId: "s" },
			fixedDeps,
		);
		expect(handle.effortId).toBe("runtime-42");
		expect(handle.promptRef).toBe("urn:sovereign:prompt-runtime42");
		expect(handle.streamRef).toBe("urn:tractor:stream:response:urn:sovereign:prompt-runtime42");
	});

	it("forwards the built effort to the transport", async () => {
		let seen: Effort | undefined;
		const transport: ComposerTransport = {
			submitEffort: async (e) => {
				seen = e;
				return "id";
			},
			cancelEffort: async () => {},
		};
		await submitComposerTurn(transport, { prompt: "drive", sessionId: "s" }, fixedDeps);
		expect(seen?.source).toBe(WEB_CHAT_EFFORT_SOURCE);
		expect(seen?.tasks[0].fn).toBe("respond");
	});
});

describe("renderChatComposerHtml — the input + submit + cancel controls", () => {
	it("renders a textarea and a submit control carrying the submit action id", () => {
		const html = renderChatComposerHtml();
		expect(html).toContain("<textarea");
		expect(html).toContain(`data-refarm-surface-action-id="${COMPOSER_SUBMIT_ACTION_ID}"`);
		// Cancel is hidden until a turn is pending.
		expect(html).toContain("hidden");
	});

	it("shows the cancel control (with the effort id) while pending and disables submit", () => {
		const html = renderChatComposerHtml({ pending: true, effortId: "eff-9", draft: "wip" });
		expect(html).toContain(`data-refarm-surface-action-id="${COMPOSER_CANCEL_ACTION_ID}"`);
		expect(html).toContain('data-effort-id="eff-9"');
		expect(html).toContain("disabled");
		// The draft is preserved across re-render.
		expect(html).toContain("wip");
	});

	it("escapes the draft to prevent HTML injection", () => {
		const html = renderChatComposerHtml({ draft: "<script>alert(1)</script>" });
		expect(html).not.toContain("<script>alert(1)</script>");
		expect(html).toContain("&lt;script&gt;");
	});

	it("uses a translator when provided", () => {
		const html = renderChatComposerHtml(
			{},
			{ t: (key) => (key === "core/composer_send" ? "Enviar" : key) },
		);
		expect(html).toContain("Enviar");
	});
});
