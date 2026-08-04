/**
 * PURE HTML renderers for the authorization journey — the "consent view" a citizen reads
 * to SEE and CONTROL what they shared: purpose, scope, expiry, status, and the
 * active→revoked history. Any authorization:v1 consumer (a wallet, a portal) renders
 * consent the same way, so this lives in the contract, not in an example — a consumer
 * feeds its receipts and gets the screen.
 *
 * No DOM, no fetch: given the domain shapes, produce HTML strings (mirrors the homestead
 * stream-observer/activity-web renderers). The controls carry `data-refarm-surface-action-id`
 * so a host routes Authorize/Revoke through the existing surface-action seam; a plain host
 * reads the same ids. Framework-neutral `refarm-*` CSS classes.
 */

import type { AuthorizationReceipt, AuthorizationStatus, ServiceRequest } from "./types.js";

/** Surface-action ids the consent controls carry, so a host dispatches them by id. */
export const CONSENT_AUTHORIZE_ACTION_ID = "authorization-authorize";
export const CONSENT_REVOKE_ACTION_ID = "authorization-revoke";

export interface AuthorizationRenderTranslator {
	t(key: string, params?: Record<string, string>): string;
}

function escapeHtml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

function text(
	translator: AuthorizationRenderTranslator | undefined,
	key: string,
	fallback: string,
	params?: Record<string, string>,
): string {
	return translator ? translator.t(`authorization/${key}`, params) : fallback;
}

/** The tone/label for a status badge. */
function statusBadge(
	status: AuthorizationStatus,
	translator?: AuthorizationRenderTranslator,
): { cls: string; label: string } {
	switch (status) {
		case "active":
			return { cls: "refarm-badge-ok", label: text(translator, "status_active", "Ativa") };
		case "revoked":
			return { cls: "refarm-badge-muted", label: text(translator, "status_revoked", "Revogada") };
		case "expired":
			return { cls: "refarm-badge-danger", label: text(translator, "status_expired", "Expirada") };
	}
}

/**
 * Render ONE authorization as a consent card: the requester, the purpose, the authorized
 * scope, expiry, status, and a Revoke control while active. This is the reviewable unit
 * the citizen reads — "who can see what, why, until when, and can I stop it". PURE.
 */
export function renderAuthorizationConsentCard(
	receipt: AuthorizationReceipt,
	translator?: AuthorizationRenderTranslator,
): string {
	const badge = statusBadge(receipt.status, translator);
	const scopeList = receipt.scope
		.map((name) => `<li class="refarm-chip">${escapeHtml(name)}</li>`)
		.join("");
	const revoke =
		receipt.status === "active"
			? `<button type="button" class="refarm-btn refarm-btn-danger"
					data-refarm-surface-action-id="${CONSENT_REVOKE_ACTION_ID}"
					data-authorization-id="${escapeHtml(receipt.id)}">${escapeHtml(
					text(translator, "revoke", "Revogar"),
				)}</button>`
			: "";
	return `<article class="refarm-surface-card refarm-stack refarm-consent-card"
		data-authorization-id="${escapeHtml(receipt.id)}"
		data-authorization-status="${escapeHtml(receipt.status)}">
		<div class="refarm-card-row">
			<strong class="refarm-card-title">${escapeHtml(receipt.requester)}</strong>
			<span class="refarm-badge ${badge.cls}">${escapeHtml(badge.label)}</span>
		</div>
		<p class="refarm-consent-purpose"><span class="refarm-muted">${escapeHtml(
			text(translator, "purpose", "Finalidade"),
		)}:</span> ${escapeHtml(receipt.purpose)}</p>
		<div class="refarm-consent-scope">
			<span class="refarm-muted">${escapeHtml(text(translator, "scope", "Atributos autorizados"))}:</span>
			<ul class="refarm-chip-row">${scopeList}</ul>
		</div>
		<p class="refarm-muted refarm-consent-expiry">${escapeHtml(
			text(translator, "expires", "Válida até"),
		)}: ${escapeHtml(receipt.expiresAt)}</p>
		${revoke}
	</article>`;
}

/**
 * Render a PENDING service request as a consent prompt: what the service wants, why, and
 * Authorize / Decline controls. This is the T2-F7 "consent screen" moment — the citizen
 * decides before anything is shared. `request` is optional; omit to render just the list.
 * PURE.
 */
export function renderConsentPrompt(
	request: ServiceRequest,
	translator?: AuthorizationRenderTranslator,
): string {
	const scopeList = request.requestedAttributes
		.map((name) => `<li class="refarm-chip">${escapeHtml(name)}</li>`)
		.join("");
	return `<section class="refarm-surface refarm-surface-tinted refarm-consent-prompt"
		data-consent-request="${escapeHtml(request.id)}"
		aria-label="${escapeHtml(text(translator, "prompt_label", "Pedido de consentimento"))}">
		<header class="refarm-panel-header">
			<p class="refarm-eyebrow">${escapeHtml(text(translator, "prompt_eyebrow", "Um serviço solicita seus dados"))}</p>
			<h2 style="font-size:1rem;margin:0;">${escapeHtml(request.requester)}</h2>
		</header>
		<p><span class="refarm-muted">${escapeHtml(text(translator, "purpose", "Finalidade"))}:</span> ${escapeHtml(
			request.purpose,
		)}</p>
		${
			request.justification
				? `<p class="refarm-consent-justification">${escapeHtml(request.justification)}</p>`
				: ""
		}
		<div class="refarm-consent-scope">
			<span class="refarm-muted">${escapeHtml(text(translator, "requested", "Atributos solicitados"))}:</span>
			<ul class="refarm-chip-row">${scopeList}</ul>
		</div>
		<p class="refarm-muted">${escapeHtml(text(translator, "expires", "Válida até"))}: ${escapeHtml(
			request.expiresAt,
		)}</p>
		<div class="refarm-consent-actions">
			<button type="button" class="refarm-btn refarm-btn-primary"
				data-refarm-surface-action-id="${CONSENT_AUTHORIZE_ACTION_ID}"
				data-consent-request="${escapeHtml(request.id)}">${escapeHtml(
					text(translator, "authorize", "Autorizar"),
				)}</button>
			<button type="button" class="refarm-btn"
				data-consent-decline="${escapeHtml(request.id)}">${escapeHtml(
					text(translator, "decline", "Recusar"),
				)}</button>
		</div>
	</section>`;
}

/**
 * Render the citizen's authorization list — their consent history, active ones first,
 * then revoked/expired (the "before/after" the trabalho asks for). Empty string when the
 * citizen has authorized nothing. PURE.
 */
export function renderAuthorizationList(
	receipts: readonly AuthorizationReceipt[],
	translator?: AuthorizationRenderTranslator,
): string {
	if (receipts.length === 0) return "";
	const rank = (status: AuthorizationStatus): number =>
		status === "active" ? 0 : status === "expired" ? 1 : 2;
	const ordered = [...receipts].sort((a, b) => rank(a.status) - rank(b.status));
	const cards = ordered.map((r) => renderAuthorizationConsentCard(r, translator)).join("\n");
	return `<section class="refarm-surface refarm-consent-list" aria-label="${escapeHtml(
		text(translator, "list_label", "Minhas autorizações"),
	)}">
		<header class="refarm-panel-header">
			<h2 style="font-size:1rem;margin:0;">${escapeHtml(text(translator, "list_title", "Minhas autorizações"))}</h2>
			<span class="refarm-pill-meta">${escapeHtml(
				text(translator, "list_count", "{count} autorizações", { count: String(receipts.length) }),
			)}</span>
		</header>
		<div class="refarm-stack">${cards}</div>
	</section>`;
}
