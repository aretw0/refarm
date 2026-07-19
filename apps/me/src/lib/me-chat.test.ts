/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { mountRefarmMeChat } from "./me-chat";

/** A minimal ok JSON Response for the mocked effort proxy. */
function jsonResponse(body: unknown): Response {
	return { ok: true, status: 200, json: async () => body } as unknown as Response;
}

/** A no-op EventSource stand-in (jsdom has none) — the activity SSE is not under test here. */
function stubEventSource(): unknown {
	return { addEventListener() {}, removeEventListener() {}, close() {} };
}

describe("mountRefarmMeChat — the apps/me agent chat wiring (ADR-088)", () => {
	beforeEach(() => {
		document.body.innerHTML = `<main id="refarm-main"></main>`;
	});
	afterEach(() => {
		document.body.innerHTML = "";
		vi.restoreAllMocks();
	});

	it("submits a prompt, shows the you-line, then appends the agent's polled reply to the transcript", async () => {
		// The same-origin effort proxy: POST /efforts mints an id; GET /efforts/:id is terminal at once.
		const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = String(input);
			if (url === "/efforts" && init?.method === "POST") return jsonResponse({ effortId: "eff-1" });
			if (url === "/efforts/eff-1") {
				return jsonResponse({ status: "done", results: [{ status: "done", result: { content: "hi from agent" } }] });
			}
			return { ok: false, status: 404 } as unknown as Response;
		}) as unknown as typeof fetch;

		const handle = mountRefarmMeChat({ document, fetchImpl, eventSourceFactory: stubEventSource });
		const transcript = handle.root.querySelector<HTMLElement>("[data-refarm-transcript]")!;
		const textarea = handle.root.querySelector<HTMLTextAreaElement>("textarea")!;
		const form = handle.root.querySelector<HTMLFormElement>("[data-refarm-chat-composer]")!;

		textarea.value = "hello agent";
		form.dispatchEvent(new Event("submit", { cancelable: true }));

		// The user's line lands immediately (self-aligned, no sender name); the textarea clears.
		expect(transcript.textContent).toContain("hello agent");
		expect(textarea.value).toBe("");
		// The transcript is the canonical role="log" container (keeps an explicit aria-live too).
		expect(transcript.getAttribute("role")).toBe("log");
		expect(transcript.getAttribute("aria-live")).toBe("polite");
		// Messenger basics: a day separator ("Hoje" today), a per-message time, and the operator's own
		// message marked self.
		expect(handle.root.querySelector(".refarm-convo-day")?.textContent).toBe("Hoje");
		expect(handle.root.querySelector(".refarm-convo-time")).not.toBeNull();
		expect(handle.root.querySelector(".refarm-convo-msg[data-self]")).not.toBeNull();

		// The effort was submitted over the proxy...
		expect(fetchImpl).toHaveBeenCalledWith("/efforts", expect.objectContaining({ method: "POST" }));

		// ...and the polled reply is appended.
		const deadline = Date.now() + 2000;
		while (Date.now() < deadline && !transcript.textContent?.includes("hi from agent")) {
			await new Promise((r) => setTimeout(r, 10));
		}
		expect(transcript.textContent).toContain("hi from agent");
		handle.stop();
		// stop() detaches the panel.
		expect(document.querySelector(".refarm-me-chat")).toBeNull();
	});

	it("ignores an empty prompt (no effort submitted)", async () => {
		const fetchImpl = vi.fn(async () => jsonResponse({ effortId: "x" })) as unknown as typeof fetch;
		const handle = mountRefarmMeChat({ document, fetchImpl, eventSourceFactory: stubEventSource });
		const form = handle.root.querySelector<HTMLFormElement>("[data-refarm-chat-composer]")!;
		form.dispatchEvent(new Event("submit", { cancelable: true }));
		expect(fetchImpl).not.toHaveBeenCalled();
		handle.stop();
	});
});
