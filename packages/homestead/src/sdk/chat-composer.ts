/**
 * The web chat COMPOSER — turns the observe-only Homestead face into a chat: submit a
 * prompt to the runtime and cancel a turn in flight. It is the write half of what
 * `stream-observer.ts` renders read-only.
 *
 * Design mirrors the rest of the SDK: PURE builders/renderers (native-testable, no DOM,
 * no network) plus a TRANSPORT SEAM (`ComposerTransport`) the host injects — so this
 * module never hard-codes `fetch` or a URL, exactly as `stream-observer` takes a
 * translator rather than a DOM. The host (an Astro app) wires the transport to the
 * sidecar (same-origin proxy by default; see `refarm serve`).
 *
 * Correlation: the effort's `id` deterministically yields the `promptRef` and
 * `streamRef` the runtime will emit for the response (mirrors the sidecar's
 * `prompt_ref_from_effort` / `stream_ref_for_prompt` in mod.rs), so the composer can
 * match a submitted turn to the observed stream BEFORE the response arrives — the one
 * missing link between submit and the existing observation layer.
 */

import { RUNTIME_AGENT_PLUGIN_ID } from "@refarm.dev/config";
import type { Effort } from "@refarm.dev/effort-contract-v1";

/** The source label a web-face turn carries, distinct from the CLI's `refarm-chat`. */
export const WEB_CHAT_EFFORT_SOURCE = "refarm-web-chat";

/** The surface-action ids the composer's submit/cancel controls carry, so a host that
 * routes through the surface-action seam (Shell.ts) can dispatch them by id. */
export const COMPOSER_SUBMIT_ACTION_ID = "refarm-chat-submit";
export const COMPOSER_CANCEL_ACTION_ID = "refarm-chat-cancel";

/** Inputs for one web-chat turn. Mirrors the CLI's `createRuntimeAgentRespondEffort`
 * options, minus the CLI-only knobs; a web turn is deliberately light on context. */
export interface ComposerEffortInput {
	prompt: string;
	sessionId: string;
	/** Optional system prompt; the web face defaults to none. */
	system?: string;
	historyTurns?: number;
	/** ADR-012: route by profile (cheap|balanced|reliable) instead of a pinned route. */
	profile?: string;
	/** Explicit pin (mutually exclusive with `profile`, same as the CLI). */
	provider?: string;
	model?: string;
}

/** Injectable id/clock so `buildRespondEffort` stays pure and deterministic in tests. */
export interface ComposerEffortDeps {
	randomUUID?: () => string;
	now?: () => Date;
}

const DEFAULT_HISTORY_TURNS = 20;

/**
 * Build the `respond` Effort the web face POSTs to `/efforts`. Byte-for-byte the same
 * shape the CLI submits (`createRuntimeAgentRespondEffort`) so both surfaces drive the
 * one runtime contract — only the `source` differs. PURE.
 */
export function buildRespondEffort(input: ComposerEffortInput, deps: ComposerEffortDeps = {}): Effort {
	const randomUUID = deps.randomUUID ?? (() => crypto.randomUUID());
	const now = deps.now ?? (() => new Date());

	const args: Record<string, unknown> = {
		prompt: input.prompt,
		system: input.system ?? "",
		session_id: input.sessionId,
		history_turns: input.historyTurns ?? DEFAULT_HISTORY_TURNS,
	};
	// A profile routes by intent and replaces a pinned route (ADR-012); otherwise pin.
	if (input.profile) {
		args.profile = input.profile;
	} else {
		if (input.provider) args.provider = input.provider;
		if (input.model) args.model = input.model;
	}

	return {
		id: randomUUID(),
		direction: "ask",
		tasks: [
			{
				id: randomUUID(),
				pluginId: RUNTIME_AGENT_PLUGIN_ID,
				fn: "respond",
				args,
			},
		],
		source: WEB_CHAT_EFFORT_SOURCE,
		submittedAt: now().toISOString(),
	};
}

/**
 * The `promptRef` the runtime derives from an effort id. Mirrors the sidecar's
 * `prompt_ref_from_effort` EXACTLY so the web can correlate a submitted turn to the
 * observed response stream before it arrives. PURE.
 */
export function promptRefForEffort(effortId: string): string {
	return `urn:sovereign:prompt-${effortId.replace(/-/g, "")}`;
}

/**
 * The `streamRef` for a `promptRef`. Mirrors the sidecar's `stream_ref_for_prompt`,
 * so the composer can pre-compute which observed StreamSession/StreamChunk belongs to
 * the turn it just submitted. PURE.
 */
export function streamRefForPrompt(promptRef: string): string {
	return `urn:tractor:stream:response:${promptRef}`;
}

/** Convenience: the observed stream ref for a submitted effort, in one call. PURE. */
export function streamRefForEffort(effortId: string): string {
	return streamRefForPrompt(promptRefForEffort(effortId));
}

// ── transport seam ──────────────────────────────────────────────────────────────
//
// The composer never touches `fetch`/URLs directly. The host supplies a transport that
// POSTs an effort and cancels one; this keeps the module testable and lets the host
// choose same-origin proxy vs direct sidecar without the composer knowing.

export interface ComposerTransport {
	/** POST the effort; resolve with the runtime's assigned effort id. */
	submitEffort(effort: Effort): Promise<string>;
	/** POST cancel for an effort in flight. */
	cancelEffort(effortId: string): Promise<void>;
}

/** The live handle a submitted turn returns: the runtime effort id plus the pre-computed
 * refs the observation layer keys on, so the caller can immediately correlate. */
export interface ComposerTurnHandle {
	effortId: string;
	promptRef: string;
	streamRef: string;
}

/**
 * Submit a turn: build the effort, POST it via the injected transport, and return the
 * correlation handle. The `effortId` is what the RUNTIME assigned (from the POST
 * response) — the refs are derived from it, so they always match what the runtime emits.
 */
export async function submitComposerTurn(
	transport: ComposerTransport,
	input: ComposerEffortInput,
	deps: ComposerEffortDeps = {},
): Promise<ComposerTurnHandle> {
	const effort = buildRespondEffort(input, deps);
	const effortId = await transport.submitEffort(effort);
	const promptRef = promptRefForEffort(effortId);
	return { effortId, promptRef, streamRef: streamRefForPrompt(promptRef) };
}

// ── rendering ─────────────────────────────────────────────────────────────────────

export interface ComposerTranslator {
	t(key: string, params?: Record<string, string>): string;
}

/** The composer's render state: whether a turn is in flight (show cancel, disable submit)
 * and the current draft text (so a re-render preserves it). */
export interface ComposerViewState {
	draft?: string;
	pending?: boolean;
	/** The in-flight effort id, when pending — carried on the cancel control. */
	effortId?: string;
}

/**
 * Render the composer as PURE HTML (a `<form>` with a textarea + submit + cancel), in
 * the same string-HTML style as `stream-observer`. The controls carry
 * `data-refarm-surface-action-id` so a host routing through the surface-action seam can
 * dispatch them; a host attaching its own listeners can key off the same ids. PURE.
 */
export function renderChatComposerHtml(
	state: ComposerViewState = {},
	translator?: ComposerTranslator,
): string {
	const pending = state.pending === true;
	const draft = state.draft ?? "";
	const submitLabel = pending
		? composerText(translator, "composer_sending")
		: composerText(translator, "composer_send");
	const cancelAttrs = pending
		? `data-refarm-surface-action-id="${COMPOSER_CANCEL_ACTION_ID}"${
				state.effortId ? ` data-effort-id="${escapeHtml(state.effortId)}"` : ""
			}`
		: "hidden";

	return `
    <form class="refarm-chat-composer" data-refarm-chat-composer aria-label="${escapeHtml(
			composerText(translator, "composer_label"),
		)}">
      <textarea
        class="refarm-chat-composer-input"
        name="prompt"
        rows="2"
        ${pending ? "disabled" : ""}
        placeholder="${escapeHtml(composerText(translator, "composer_placeholder"))}"
        aria-label="${escapeHtml(composerText(translator, "composer_input_label"))}"
      >${escapeHtml(draft)}</textarea>
      <div class="refarm-chat-composer-actions">
        <button
          type="submit"
          class="refarm-chat-composer-submit"
          data-refarm-surface-action-id="${COMPOSER_SUBMIT_ACTION_ID}"
          ${pending ? "disabled" : ""}
        >${escapeHtml(submitLabel)}</button>
        <button
          type="button"
          class="refarm-chat-composer-cancel"
          ${cancelAttrs}
        >${escapeHtml(composerText(translator, "composer_cancel"))}</button>
      </div>
    </form>
  `;
}

function escapeHtml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

function composerText(
	translator: ComposerTranslator | undefined,
	key: string,
	params?: Record<string, string>,
): string {
	if (translator) return translator.t(`core/${key}`, params);
	return fallbackComposerText(key, params);
}

function fallbackComposerText(key: string, _params?: Record<string, string>): string {
	switch (key) {
		case "composer_label":
			return "Chat composer";
		case "composer_input_label":
			return "Message";
		case "composer_placeholder":
			return "Ask the agent…";
		case "composer_send":
			return "Send";
		case "composer_sending":
			return "Sending…";
		case "composer_cancel":
			return "Cancel";
		default:
			return key;
	}
}
