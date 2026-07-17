import { CONSENT_AUTHORIZE_ACTION_ID } from "@refarm.dev/authorization-contract-v1";
import type { CapabilityRegistry } from "@refarm.dev/capabilities";

/**
 * Wire the T2-F7 consent screen into a LIVE decision loop. The `consent` verb renders each
 * pending request as a prompt (renderConsentPrompt, from the shared authorization contract);
 * its Authorize / Decline controls carry the ids a host routes — this attaches that routing:
 * a click runs `authorize --request <id>` (the sovereign yes) or `decline <id>` (the no), then
 * re-renders so the decided request disappears. The example writes no consent markup and no
 * bespoke dispatch — the prompt is the contract's, the verbs are the wallet's.
 *
 * CONVERGENCE NOTE: this pairs 1:1 with the shared renderers (authorization-contract-v1 exports
 * CONSENT_AUTHORIZE_ACTION_ID / data-consent-* precisely so a host can wire it). Today wallet-t2
 * is the only consumer; when a second authorization host needs the same loop, promote this into a
 * browser entry of @refarm.dev/wallet (or an authorization-contract-v1 browser subpath) unchanged.
 */
export interface ConsentJourneyHandle {
	/** Re-run `consent` and repaint the mount (call after external state changes). */
	refresh(): Promise<void>;
	/** Detach the click listener. */
	dispose(): void;
}

async function runVerb(
	registry: CapabilityRegistry,
	name: string,
	input: { args: Record<string, string>; options: Record<string, string> },
): Promise<Record<string, unknown> | null> {
	const entry = registry.get(name);
	if (!entry || !("run" in entry) || typeof entry.run !== "function") return null;
	return (await entry.run({ ...input, json: true })) as unknown as Record<string, unknown>;
}

export async function mountConsentJourney(
	registry: CapabilityRegistry,
	mount: HTMLElement,
	options: { caption?: HTMLElement | null } = {},
): Promise<ConsentJourneyHandle> {
	const emptyHtml = `<p class="refarm-muted">Nenhum pedido pendente — você está em dia.</p>`;

	async function render(): Promise<void> {
		const consent = await runVerb(registry, "consent", { args: {}, options: {} });
		const pendingCount = Number(consent?.pendingCount ?? 0);
		mount.innerHTML = (consent?.consentHtml as string) || emptyHtml;
		if (options.caption) {
			options.caption.textContent = pendingCount
				? `${pendingCount} pedido(s) aguardando sua decisão`
				: "Nenhum pedido pendente — você está em dia.";
		}
	}

	async function onClick(event: Event): Promise<void> {
		const el = (event.target as HTMLElement | null)?.closest<HTMLElement>(
			"[data-refarm-surface-action-id], [data-consent-decline]",
		);
		if (!el || !mount.contains(el)) return;
		const authorizeId =
			el.getAttribute("data-refarm-surface-action-id") === CONSENT_AUTHORIZE_ACTION_ID
				? el.getAttribute("data-consent-request")
				: null;
		const declineId = el.getAttribute("data-consent-decline");
		if (!authorizeId && !declineId) return;
		event.preventDefault();
		el.setAttribute("disabled", "true"); // no double-submit while the verb runs
		try {
			if (authorizeId) await runVerb(registry, "authorize", { args: {}, options: { request: authorizeId } });
			else if (declineId) await runVerb(registry, "decline", { args: { id: declineId }, options: {} });
		} finally {
			await render();
		}
	}

	const listener = (event: Event): void => {
		void onClick(event);
	};
	mount.addEventListener("click", listener);
	await render();

	return {
		refresh: render,
		dispose: () => mount.removeEventListener("click", listener),
	};
}
