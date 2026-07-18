/**
 * The web chat panel for refarm.me: mounts the ADR-088 composer (textarea + submit +
 * cancel), streams live activity pills from the daemon SSE, and shows the agent's reply.
 *
 * All the pieces are proven and transport-agnostic in the homestead SDK; this is the thin
 * browser shell that wires them into refarm.me's DOM against the same-origin effort proxy.
 */

import {
	COMPOSER_SUBMIT_ACTION_ID,
	conversationDayKey,
	conversationDayLabel,
	conversationMessageTime,
	createBrowserComposerTransport,
	createChatComposerActionBridge,
	mountLiveActivityStream,
	renderChatComposerHtml,
	type ComposerTurnHandle,
} from "@refarm.dev/homestead/sdk";

/** Poll cadence + cap for reading back an effort result over the same-origin proxy. */
const RESULT_POLL_MS = 400;
const RESULT_POLL_MAX = 150; // ~60s

interface EffortResultResponse {
	status?: string;
	results?: { status?: string; result?: { content?: string }; error?: string }[];
}

/** Read an effort's terminal content by polling GET /efforts/:id (same-origin proxy).
 * Resolves with the reply text (or an error string) once terminal. */
async function pollEffortResult(effortId: string, fetchImpl: typeof fetch): Promise<string> {
	for (let i = 0; i < RESULT_POLL_MAX; i++) {
		const res = await fetchImpl(`/efforts/${encodeURIComponent(effortId)}`);
		if (res.ok) {
			const body = (await res.json()) as EffortResultResponse;
			const terminal =
				body.status && ["done", "delivered", "partial", "failed", "timed-out", "cancelled"].includes(body.status);
			if (terminal) {
				const first = body.results?.[0];
				if (first?.error) return `⚠ ${first.error}`;
				return first?.result?.content ?? "(no content)";
			}
		}
		await new Promise((r) => setTimeout(r, RESULT_POLL_MS));
	}
	return "(timed out waiting for reply)";
}

/** A newline-safe text escape for injecting reply/prompt text into the transcript. */
function escapeHtml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

export interface MountRefarmMeChatOptions {
	document?: Document;
	/** Injected fetch (defaults to global) — for tests. */
	fetchImpl?: typeof fetch;
	/** Where to mount (defaults to #refarm-main, then body). */
	mountId?: string;
	/** Session id for the turns (defaults to a fresh web session). */
	sessionId?: string;
	/** Injected EventSource factory for the activity SSE (defaults to the global EventSource) — the
	 * seam a jsdom test uses, since jsdom has no EventSource. */
	eventSourceFactory?: (url: string) => unknown;
}

export interface RefarmMeChatHandle {
	/** The container element the chat was mounted into. */
	root: HTMLElement;
	/** Tear down the SSE stream and detach. */
	stop(): void;
}

/** Mount the chat panel and wire submit/cancel/activity end to end. */
export function mountRefarmMeChat(options: MountRefarmMeChatOptions = {}): RefarmMeChatHandle {
	const doc = options.document ?? document;
	const fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
	const sessionId =
		options.sessionId ?? `urn:sovereign:session:v1:web${Math.random().toString(36).slice(2, 10)}`;

	const host = doc.getElementById(options.mountId ?? "refarm-main") ?? doc.body;

	const root = doc.createElement("section");
	root.className = "refarm-me-chat";
	root.setAttribute("aria-label", "Chat with the agent");
	root.innerHTML = [
		`<div class="refarm-me-chat-activity" data-refarm-activity></div>`,
		`<div class="refarm-me-chat-transcript" data-refarm-transcript aria-live="polite"></div>`,
		renderChatComposerHtml(),
	].join("\n");
	host.appendChild(root);

	const activityNode = root.querySelector<HTMLElement>("[data-refarm-activity]")!;
	const transcript = root.querySelector<HTMLElement>("[data-refarm-transcript]")!;
	const form = root.querySelector<HTMLFormElement>("[data-refarm-chat-composer]")!;
	const textarea = root.querySelector<HTMLTextAreaElement>("textarea")!;
	const cancelBtn = root.querySelector<HTMLButtonElement>(".refarm-chat-composer-cancel")!;

	// Live activity pills over the same-origin SSE stream.
	const eventSourceFactory = options.eventSourceFactory ?? ((url: string) => new EventSource(url));
	const activityStream = mountLiveActivityStream(activityNode, {
		eventSourceFactory: (url) => eventSourceFactory(url) as never,
	});

	const transport = createBrowserComposerTransport({ fetchImpl });
	let pending: ComposerTurnHandle | null = null;

	// Messenger basics: a "Hoje"/"Ontem"/date separator when the day changes, and a per-message time.
	let lastDayKey = "";
	const appendTranscript = (who: string, text: string, cls: string) => {
		const now = Date.now();
		const dayKey = conversationDayKey(now);
		if (dayKey !== lastDayKey) {
			lastDayKey = dayKey;
			const separator = doc.createElement("div");
			separator.className = "refarm-me-chat-day";
			separator.setAttribute("role", "separator");
			separator.textContent = conversationDayLabel(now, { now });
			transcript.appendChild(separator);
		}
		const line = doc.createElement("p");
		line.className = `refarm-me-chat-line ${cls}`;
		line.innerHTML = `<strong>${escapeHtml(who)}:</strong> ${escapeHtml(text)} <time class="refarm-me-chat-time">${escapeHtml(conversationMessageTime(now))}</time>`;
		transcript.appendChild(line);
	};

	const setPending = (on: boolean, effortId?: string) => {
		textarea.disabled = on;
		if (on && effortId) {
			cancelBtn.hidden = false;
			cancelBtn.setAttribute("data-effort-id", effortId);
		} else {
			cancelBtn.hidden = true;
			cancelBtn.removeAttribute("data-effort-id");
		}
	};

	const bridge = createChatComposerActionBridge(transport, {
		sessionId: () => sessionId,
		onSubmitted: (handle) => {
			pending = handle;
			setPending(true, handle.effortId);
			void pollEffortResult(handle.effortId, fetchImpl).then((reply) => {
				appendTranscript("agent", reply, "refarm-me-chat-agent");
				pending = null;
				setPending(false);
			});
		},
		onCancelled: () => {
			appendTranscript("system", "turn cancelled", "refarm-me-chat-system");
			pending = null;
			setPending(false);
		},
		onError: (error) => {
			appendTranscript("system", `error: ${String(error)}`, "refarm-me-chat-system");
			pending = null;
			setPending(false);
		},
	});

	form.addEventListener("submit", (event) => {
		event.preventDefault();
		const prompt = textarea.value.trim();
		if (!prompt || pending) return;
		appendTranscript("you", prompt, "refarm-me-chat-you");
		textarea.value = "";
		void bridge({ action: { id: COMPOSER_SUBMIT_ACTION_ID, payload: { prompt } } });
	});

	cancelBtn.addEventListener("click", () => {
		if (!pending) return;
		void bridge({ action: { id: "refarm-chat-cancel", payload: { effortId: pending.effortId } } });
	});

	return {
		root,
		stop() {
			activityStream.stop();
			root.remove();
		},
	};
}
