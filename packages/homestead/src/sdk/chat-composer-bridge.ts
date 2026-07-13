/**
 * The bridge from the chat composer's surface-action controls (submit / cancel) to the
 * runtime, plus the browser transport that talks to the same-origin effort proxy.
 *
 * Kept separate from `chat-composer.ts` (the pure builders/renderers) so the pure core
 * stays free of any host/DOM assumptions. This module is still transport-agnostic where
 * it matters — the action handler takes a `ComposerTransport` — but also ships the one
 * concrete browser transport (`createBrowserComposerTransport`) an Astro host wires in.
 */

import {
	COMPOSER_CANCEL_ACTION_ID,
	COMPOSER_SUBMIT_ACTION_ID,
	submitComposerTurn,
	type ComposerEffortInput,
	type ComposerTransport,
	type ComposerTurnHandle,
} from "./chat-composer.js";

/** A minimal view of a surface-action request — the fields the bridge reads. Structural
 * so it matches the homestead `HomesteadSurfaceRenderActionHandler` request without
 * importing its full type (which drags host context the bridge does not need). */
export interface ComposerActionRequest {
	action: { id: string; payload?: unknown };
}

/** Callbacks the host provides so it can reflect turn state in its own UI. */
export interface ComposerActionCallbacks {
	/** Resolve the current session id for a new turn (host owns session lifecycle). */
	sessionId(): string;
	/** Called with the correlation handle once a turn is submitted (host renders it). */
	onSubmitted?(handle: ComposerTurnHandle): void;
	/** Called when a cancel was accepted for `effortId`. */
	onCancelled?(effortId: string): void;
	/** Called on a submit/cancel failure so the host can surface it. */
	onError?(error: unknown): void;
	/** Optional per-turn routing input (profile / pinned route / system). */
	turnInput?(): Partial<Omit<ComposerEffortInput, "prompt" | "sessionId">>;
}

/** Read the draft prompt from a submit action's payload. The composer's host attaches
 * the textarea value as `payload.prompt`; blank/absent ⇒ no submit. PURE. */
export function draftFromSubmitAction(request: ComposerActionRequest): string | undefined {
	const payload = request.action.payload;
	if (payload && typeof payload === "object" && "prompt" in payload) {
		const prompt = (payload as { prompt?: unknown }).prompt;
		if (typeof prompt === "string" && prompt.trim().length > 0) return prompt.trim();
	}
	return undefined;
}

/** Read the in-flight effort id from a cancel action's payload. PURE. */
export function effortIdFromCancelAction(request: ComposerActionRequest): string | undefined {
	const payload = request.action.payload;
	if (payload && typeof payload === "object" && "effortId" in payload) {
		const id = (payload as { effortId?: unknown }).effortId;
		if (typeof id === "string" && id.length > 0) return id;
	}
	return undefined;
}

/**
 * Build a surface-action handler for the composer's submit/cancel controls. Returns
 * `true` when it handled the action (a matching id with a usable payload), `false`
 * otherwise so the host can fall through to other handlers. The actual HTTP is the
 * injected `transport`; correlation + session come from `callbacks`.
 */
export function createChatComposerActionBridge(
	transport: ComposerTransport,
	callbacks: ComposerActionCallbacks,
): (request: ComposerActionRequest) => Promise<boolean> {
	return async (request) => {
		if (request.action.id === COMPOSER_SUBMIT_ACTION_ID) {
			const prompt = draftFromSubmitAction(request);
			if (!prompt) return false;
			try {
				const handle = await submitComposerTurn(transport, {
					prompt,
					sessionId: callbacks.sessionId(),
					...(callbacks.turnInput?.() ?? {}),
				});
				callbacks.onSubmitted?.(handle);
			} catch (error) {
				callbacks.onError?.(error);
			}
			return true;
		}
		if (request.action.id === COMPOSER_CANCEL_ACTION_ID) {
			const effortId = effortIdFromCancelAction(request);
			if (!effortId) return false;
			try {
				await transport.cancelEffort(effortId);
				callbacks.onCancelled?.(effortId);
			} catch (error) {
				callbacks.onError?.(error);
			}
			return true;
		}
		return false;
	};
}

// ── browser transport ──────────────────────────────────────────────────────────────

/** Options for the browser transport — mainly the base path for the effort endpoints.
 * Defaults to same-origin `/efforts` (the `refarm serve` proxy), so a browser page needs
 * no configuration. */
export interface BrowserComposerTransportOptions {
	/** Base path for the effort endpoints (default `/efforts`, same-origin). */
	basePath?: string;
	/** Injected fetch (defaults to global). */
	fetchImpl?: typeof fetch;
}

/**
 * The concrete browser transport: POSTs efforts and cancels to the same-origin effort
 * proxy. Mirrors the CLI's raw POST (the sidecar-client has no effort helper). Submit
 * returns the runtime-assigned `effortId` from the `{ effortId }` response body.
 */
export function createBrowserComposerTransport(
	options: BrowserComposerTransportOptions = {},
): ComposerTransport {
	const basePath = (options.basePath ?? "/efforts").replace(/\/$/, "");
	const doFetch = options.fetchImpl ?? ((input, init) => fetch(input, init));

	return {
		async submitEffort(effort) {
			const response = await doFetch(basePath, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(effort),
			});
			if (!response.ok) {
				throw new Error(`effort submit failed: HTTP ${response.status}`);
			}
			const payload = (await response.json()) as { effortId?: string };
			if (!payload.effortId) {
				throw new Error("effort submit returned no effortId");
			}
			return payload.effortId;
		},
		async cancelEffort(effortId) {
			const response = await doFetch(`${basePath}/${encodeURIComponent(effortId)}/cancel`, {
				method: "POST",
			});
			// 202 accepted or 409 already-terminal are both fine ends for a cancel intent.
			if (!response.ok && response.status !== 409) {
				throw new Error(`effort cancel failed: HTTP ${response.status}`);
			}
		},
	};
}
