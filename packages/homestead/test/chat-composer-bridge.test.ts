import { describe, expect, it, vi } from "vitest";
import {
	COMPOSER_CANCEL_ACTION_ID,
	COMPOSER_SUBMIT_ACTION_ID,
	type ComposerTransport,
} from "../src/sdk/chat-composer";
import {
	createBrowserComposerTransport,
	createChatComposerActionBridge,
	draftFromSubmitAction,
	effortIdFromCancelAction,
} from "../src/sdk/chat-composer-bridge";

describe("payload readers", () => {
	it("reads a non-blank prompt from a submit action", () => {
		expect(draftFromSubmitAction({ action: { id: "x", payload: { prompt: " hi " } } })).toBe("hi");
		expect(draftFromSubmitAction({ action: { id: "x", payload: { prompt: "  " } } })).toBeUndefined();
		expect(draftFromSubmitAction({ action: { id: "x" } })).toBeUndefined();
	});

	it("reads an effort id from a cancel action", () => {
		expect(effortIdFromCancelAction({ action: { id: "x", payload: { effortId: "e1" } } })).toBe("e1");
		expect(effortIdFromCancelAction({ action: { id: "x", payload: {} } })).toBeUndefined();
	});
});

function stubTransport(overrides: Partial<ComposerTransport> = {}): ComposerTransport {
	return {
		submitEffort: overrides.submitEffort ?? vi.fn(async () => "eff-1"),
		cancelEffort: overrides.cancelEffort ?? vi.fn(async () => {}),
	};
}

describe("createChatComposerActionBridge", () => {
	it("submits on the submit action and reports the correlation handle", async () => {
		const transport = stubTransport({ submitEffort: vi.fn(async () => "runtime-9") });
		const onSubmitted = vi.fn();
		const bridge = createChatComposerActionBridge(transport, {
			sessionId: () => "urn:session:web",
			onSubmitted,
		});
		const handled = await bridge({
			action: { id: COMPOSER_SUBMIT_ACTION_ID, payload: { prompt: "hello" } },
		});
		expect(handled).toBe(true);
		expect(transport.submitEffort).toHaveBeenCalledOnce();
		expect(onSubmitted).toHaveBeenCalledWith(
			expect.objectContaining({
				effortId: "runtime-9",
				promptRef: "urn:sovereign:prompt-runtime9",
			}),
		);
	});

	it("passes turnInput (profile) into the submitted turn", async () => {
		let submittedEffort: unknown;
		const transport = stubTransport({
			submitEffort: vi.fn(async (e) => {
				submittedEffort = e;
				return "e";
			}),
		});
		const bridge = createChatComposerActionBridge(transport, {
			sessionId: () => "s",
			turnInput: () => ({ profile: "cheap" }),
		});
		await bridge({ action: { id: COMPOSER_SUBMIT_ACTION_ID, payload: { prompt: "hi" } } });
		const args = (submittedEffort as { tasks: { args: Record<string, unknown> }[] }).tasks[0].args;
		expect(args.profile).toBe("cheap");
	});

	it("cancels on the cancel action and reports it", async () => {
		const transport = stubTransport();
		const onCancelled = vi.fn();
		const bridge = createChatComposerActionBridge(transport, {
			sessionId: () => "s",
			onCancelled,
		});
		const handled = await bridge({
			action: { id: COMPOSER_CANCEL_ACTION_ID, payload: { effortId: "eff-7" } },
		});
		expect(handled).toBe(true);
		expect(transport.cancelEffort).toHaveBeenCalledWith("eff-7");
		expect(onCancelled).toHaveBeenCalledWith("eff-7");
	});

	it("returns false for unrelated actions (host falls through)", async () => {
		const bridge = createChatComposerActionBridge(stubTransport(), { sessionId: () => "s" });
		expect(await bridge({ action: { id: "some-other-action" } })).toBe(false);
	});

	it("routes a submit failure to onError, still marking the action handled", async () => {
		const transport = stubTransport({
			submitEffort: vi.fn(async () => {
				throw new Error("boom");
			}),
		});
		const onError = vi.fn();
		const bridge = createChatComposerActionBridge(transport, { sessionId: () => "s", onError });
		const handled = await bridge({
			action: { id: COMPOSER_SUBMIT_ACTION_ID, payload: { prompt: "hi" } },
		});
		expect(handled).toBe(true);
		expect(onError).toHaveBeenCalled();
	});
});

describe("createBrowserComposerTransport", () => {
	it("POSTs the effort same-origin and returns the runtime effortId", async () => {
		const fetchImpl = vi.fn(async () =>
			new Response(JSON.stringify({ effortId: "eff-http" }), { status: 200 }),
		) as unknown as typeof fetch;
		const transport = createBrowserComposerTransport({ fetchImpl });
		const id = await transport.submitEffort({
			id: "x",
			direction: "ask",
			tasks: [],
			submittedAt: "t",
		});
		expect(id).toBe("eff-http");
		expect(fetchImpl).toHaveBeenCalledWith(
			"/efforts",
			expect.objectContaining({ method: "POST" }),
		);
	});

	it("throws when submit is not ok", async () => {
		const fetchImpl = vi.fn(async () => new Response("nope", { status: 500 })) as unknown as typeof fetch;
		const transport = createBrowserComposerTransport({ fetchImpl });
		await expect(
			transport.submitEffort({ id: "x", direction: "ask", tasks: [], submittedAt: "t" }),
		).rejects.toThrow("HTTP 500");
	});

	it("cancel accepts 202 and tolerates 409 (already terminal)", async () => {
		const ok = vi.fn(async () => new Response("", { status: 202 })) as unknown as typeof fetch;
		await createBrowserComposerTransport({ fetchImpl: ok }).cancelEffort("e1");
		expect(ok).toHaveBeenCalledWith("/efforts/e1/cancel", expect.objectContaining({ method: "POST" }));

		const terminal = vi.fn(async () => new Response("", { status: 409 })) as unknown as typeof fetch;
		await expect(
			createBrowserComposerTransport({ fetchImpl: terminal }).cancelEffort("e1"),
		).resolves.toBeUndefined();
	});
});
