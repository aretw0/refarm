// A MULTI-PARTY conversation transcript — the reusable render every chat/messenger shares: messages
// grouped under day separators (conversation-time), each carrying a sender IDENTITY (not just a role),
// a compact timestamp, and body text. PURE (messages → HTML string) so it renders the same from a live
// stream or a loaded history, on any surface. The agent chat is one consumer (operator + agent as two
// participants); a person-to-person messenger is another — refarm's core is a place a messenger is a
// first-class app, so this substrate is not agent-specific.
//
// Design follows the house DS tokens (no invented palette) and stays restrained — no gradients,
// glassmorphism, or over-rounding; muted, dense, legible. Self vs. others is a subtle alignment + tone
// shift, not a loud color. Styles ship next to the markup (conversationTranscriptStyles) so a consumer
// injects them once, like the surveyor's interactiveStyles.

import { conversationDayKey, conversationDayLabel, conversationMessageTime, type ConversationTimeOptions } from "./conversation-time.js";

/** WHO a message is from — an identity, so a person-to-person chat is first-class (not just roles). */
export type ConversationSenderKind = "operator" | "agent" | "person" | "system";

export interface ConversationSender {
	/** Stable participant id (matched against `selfId` to align the viewer's own messages). */
	id: string;
	/** Display name. */
	name: string;
	kind: ConversationSenderKind;
}

export interface ConversationMessage {
	id?: string;
	sender: ConversationSender;
	/** When the message was sent, ms. */
	at: number;
	/** The message body text (always present — the accessible/fallback rendering, and what a plain
	 * message shows). */
	text: string;
	/** A TRUSTED, app-rendered HTML fragment shown as the body INSTEAD of `text` when present — the
	 * rich-content seam for an inline element the agent generates (e.g. a capability form). The caller
	 * owns its safety (it built it); `text` stays the escaped fallback. */
	html?: string;
}

export interface RenderConversationTranscriptOptions extends ConversationTimeOptions {
	/** The viewer's own participant id — their messages align right and read as "self". */
	selfId?: string;
}

const ESCAPE_MAP: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
function escapeHtml(value: string): string {
	return value.replace(/[&<>"']/g, (c) => ESCAPE_MAP[c]!);
}

/** One message row: a `system` message is a centered notice; everything else is a sender-attributed
 * line that aligns right for the viewer (`self`) and left for others, with the sender name shown for
 * others (so a multi-party thread is legible) and a muted timestamp. */
function renderMessage(message: ConversationMessage, options: RenderConversationTranscriptOptions): string {
	const time = escapeHtml(conversationMessageTime(message.at, { locale: options.locale }));
	if (message.sender.kind === "system") {
		return `<p class="refarm-convo-system" role="note">${escapeHtml(message.text)} <time class="refarm-convo-time">${time}</time></p>`;
	}
	const self = options.selfId !== undefined && message.sender.id === options.selfId;
	const name = escapeHtml(message.sender.name);
	// Others show a sender name; the viewer's own messages don't (they know who they are).
	const senderLine = self ? "" : `<span class="refarm-convo-sender">${name}</span>`;
	// A rich message renders the app's TRUSTED html (an inline form) as a block; a plain message
	// renders its escaped text inline with the time.
	const rich = message.html !== undefined;
	const body = rich
		? `<div class="refarm-convo-rich">${message.html}</div>`
		: `<span class="refarm-convo-body">${escapeHtml(message.text)}</span>`;
	return [
		`<div class="refarm-convo-msg" data-kind="${escapeHtml(message.sender.kind)}"${self ? " data-self" : ""}${rich ? " data-rich" : ""}>`,
		senderLine,
		`<div class="refarm-convo-bubble">`,
		body,
		`<time class="refarm-convo-time">${time}</time>`,
		`</div>`,
		`</div>`,
	].join("");
}

/**
 * Render a chronological message list to transcript HTML: a day separator ("Hoje"/"Ontem"/date) when
 * the local calendar day changes, then that day's messages. Messages MUST be sorted ascending by `at`.
 * Empty → an empty string (the caller shows its own empty state).
 */
export function renderConversationTranscript(
	messages: readonly ConversationMessage[],
	options: RenderConversationTranscriptOptions,
): string {
	const out: string[] = [];
	let lastDayKey = "";
	for (const message of messages) {
		const dayKey = conversationDayKey(message.at);
		if (dayKey !== lastDayKey) {
			lastDayKey = dayKey;
			out.push(`<div class="refarm-convo-day" role="separator"><span>${escapeHtml(conversationDayLabel(message.at, options))}</span></div>`);
		}
		out.push(renderMessage(message, options));
	}
	return out.join("");
}

/** The minimal DOM target `applyConversationTranscriptRegion` needs — kept structural so the substrate
 * carries no DOM-lib dependency (it renders to any surface, only the web one is a DOM). */
interface AttributeTarget {
	setAttribute(name: string, value: string): void;
}

/**
 * The a11y contract for the ELEMENT that holds a rendered transcript (the consumer owns the element it
 * re-renders into; the substrate owns its accessibility contract — the companion of
 * conversationTranscriptStyles). ONE source of truth, two projections below (a markup string and a
 * DOM applier) so every messenger consumer states the same contract.
 *
 * A chat/message history is the canonical `role="log"` container: W3C technique ARIA23 ("Using role=log
 * to identify sequential information updates") uses a chat log as its flagship example, and MDN names
 * "Chat logs, Messaging history" as the log role's canonical use. Over a bare live region, `log` adds
 * append-only sequential semantics — new items land at the end — that a transcript has and a generic
 * region cannot express. We KEEP an explicit `aria-live="polite"` alongside the role (belt-and-braces):
 * screen-reader support for a role's IMPLICIT live region is inconsistent, so stating the politeness is
 * the robust choice.
 */
export const CONVERSATION_TRANSCRIPT_REGION_ATTRS: Readonly<Record<string, string>> = {
	role: "log",
	"aria-live": "polite",
};

/** The transcript-container contract as an HTML attribute string, to interpolate into a container's
 * markup: `<div ${conversationTranscriptRegionAttrs()}>…`. For consumers that build markup as a string. */
export function conversationTranscriptRegionAttrs(): string {
	return Object.entries(CONVERSATION_TRANSCRIPT_REGION_ATTRS)
		.map(([name, value]) => `${name}="${value}"`)
		.join(" ");
}

/** Apply the transcript-container contract to a live DOM element — for consumers that own the element
 * itself (they re-render into `el.innerHTML`) rather than its markup. Idempotent. */
export function applyConversationTranscriptRegion(el: AttributeTarget): void {
	for (const [name, value] of Object.entries(CONVERSATION_TRANSCRIPT_REGION_ATTRS)) {
		el.setAttribute(name, value);
	}
}

/**
 * The transcript's companion CSS — DS-token only (no invented colors), restrained (no gradients or
 * glassmorphism), dense + legible. Inject ONCE (a consumer appends a <style> with this). Self messages
 * align right on a muted accent tint; others align left on an elevated surface; a day separator is a
 * centered muted label between hairlines; the timestamp is small and secondary.
 */
export function conversationTranscriptStyles(): string {
	return `
		.refarm-convo-day { display: flex; align-items: center; gap: 0.75rem; margin: 0.75rem 0 0.25rem; color: var(--refarm-text-muted); font-size: 0.75rem; }
		.refarm-convo-day::before, .refarm-convo-day::after { content: ""; flex: 1; height: 1px; background: var(--refarm-border-muted); }
		.refarm-convo-msg { display: flex; flex-direction: column; gap: 0.125rem; margin: 0.25rem 0; max-width: 82%; }
		.refarm-convo-msg[data-self] { align-self: flex-end; align-items: flex-end; }
		.refarm-convo-sender { font-size: 0.75rem; color: var(--refarm-text-secondary); padding: 0 0.25rem; }
		.refarm-convo-bubble { display: inline-flex; align-items: baseline; gap: 0.5rem; padding: 0.375rem 0.625rem; border-radius: var(--refarm-radius-md); background: var(--refarm-bg-secondary); color: var(--refarm-text-primary); line-height: 1.45; }
		.refarm-convo-msg[data-self] .refarm-convo-bubble { background: var(--refarm-accent-muted); }
		.refarm-convo-body { white-space: pre-wrap; word-break: break-word; }
		.refarm-convo-msg[data-rich] { max-width: 100%; align-self: stretch; }
		.refarm-convo-msg[data-rich] .refarm-convo-bubble { flex-direction: column; align-items: stretch; }
		.refarm-convo-rich { display: flex; flex-direction: column; gap: 0.5rem; }
		.refarm-convo-time { flex: 0 0 auto; font-size: 0.6875rem; color: var(--refarm-text-muted); font-variant-numeric: tabular-nums; }
		.refarm-convo-system { margin: 0.375rem auto; text-align: center; font-size: 0.75rem; color: var(--refarm-text-muted); }
	`;
}
