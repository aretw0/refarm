/**
 * The web chat panel for refarm.me: mounts the ADR-088 composer (textarea + submit +
 * cancel), streams live activity pills from the daemon SSE, and shows the agent's reply.
 *
 * All the pieces are proven and transport-agnostic in the homestead SDK; this is the thin
 * browser shell that wires them into refarm.me's DOM against the same-origin effort proxy.
 */

import {
	COMPOSER_SUBMIT_ACTION_ID,
	conversationTranscriptRegionAttrs,
	conversationTranscriptStyles,
	createBrowserComposerTransport,
	createChatComposerActionBridge,
	mountLiveActivityStream,
	renderChatComposerHtml,
	renderConversationTranscript,
	type ComposerTurnHandle,
	type ConversationMessage,
	type ConversationSender,
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

/** The conversation participants: the operator (the viewer — their lines align right), the agent, and
 * a system voice for lifecycle notices. Identities (not just roles) so the same transcript renders a
 * person-to-person thread too. */
const ME: ConversationSender = { id: "me", name: "Você", kind: "operator" };
const AGENT: ConversationSender = { id: "agent", name: "Agente", kind: "agent" };
const SYSTEM: ConversationSender = { id: "system", name: "sistema", kind: "system" };

/** Inject the transcript's DS-token styles once per document. */
function ensureTranscriptStyles(doc: Document): void {
	if (doc.getElementById("refarm-me-chat-styles")) return;
	const style = doc.createElement("style");
	style.id = "refarm-me-chat-styles";
	style.textContent = conversationTranscriptStyles();
	doc.head.appendChild(style);
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
		`<div class="refarm-me-chat-transcript" data-refarm-transcript ${conversationTranscriptRegionAttrs()}></div>`,
		renderChatComposerHtml(),
	].join("\n");
	host.appendChild(root);
	ensureTranscriptStyles(doc);

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

	// The transcript is a RE-RENDER of the message list — day separators ("Hoje"/"Ontem"/date), the
	// per-message time, and sender identity all come from the shared conversation substrate, so this
	// is the same render a person-to-person thread would use.
	const messages: ConversationMessage[] = [];
	const pushMessage = (sender: ConversationSender, text: string) => {
		messages.push({ sender, at: Date.now(), text });
		transcript.innerHTML = renderConversationTranscript(messages, { now: Date.now(), selfId: ME.id });
		transcript.scrollTop = transcript.scrollHeight;
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
				pushMessage(AGENT, reply);
				pending = null;
				setPending(false);
			});
		},
		onCancelled: () => {
			pushMessage(SYSTEM, "turno cancelado");
			pending = null;
			setPending(false);
		},
		onError: (error) => {
			pushMessage(SYSTEM, `erro: ${String(error)}`);
			pending = null;
			setPending(false);
		},
	});

	form.addEventListener("submit", (event) => {
		event.preventDefault();
		const prompt = textarea.value.trim();
		if (!prompt || pending) return;
		pushMessage(ME, prompt);
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
