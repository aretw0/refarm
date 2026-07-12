import {
	defineRecordsViewCapability,
	type CapabilityDescriptor,
	type RecordsAnalyzeEnvelope,
	type RecordsCommandDeps,
} from "@refarm.dev/capability-host";
import { createLocalRecordsCapabilityDeps } from "@refarm.dev/capability-host/node";
import { createCapabilityWebSurfacePlugin } from "@refarm.dev/capability-homestead-surface";
import {
	createInMemoryCredentialsProviderFixture,
	type CredentialsProvider,
} from "@refarm.dev/credentials-contract-v1";
import type { IdentityProvider } from "@refarm.dev/identity-contract-v1";

import {
	createWalletImportCapability,
	createWalletShareCapability,
	createWalletVerifyCapability,
} from "./credentials.js";
import { walletManifest } from "./fixture.js";

/**
 * The T2 persona (result mode). wallet presents the sovereign citizen's DIGITAL WALLET
 * as a finished product: the citizen sees their held items, grouped and curated — never
 * the neutral engine underneath. The focus is the benefit (my data, my wallet), not the
 * machine — the opposite of T1's process view.
 */

/** The citizen's records deps, backed by a mutable manifest and optional local state
 * file. Without a state path it stays in-memory for deterministic tests. */
export interface WalletStateOptions {
	statePath?: string;
}

export interface WalletBundleOptions extends WalletStateOptions {
	/** The credential provider — the substrate's W3C verifier + presenter (verify/present). An
	 * in-memory fixture is used out of the box; a real deployment injects one bound to the
	 * citizen's identity + storage (or a WASM verifier). */
	credentialsProvider?: CredentialsProvider;
	/** The citizen's identity provider — the holder's key(s) that sign a presentation. Paired
	 * with credentialsProvider from the same fixture out of the box. */
	identity?: IdentityProvider;
	/** Deterministic clock for `review.at` in tests. */
	now?: () => string;
}

export function walletCapabilityBundle(options: WalletBundleOptions = {}) {
	const deps = createLocalRecordsCapabilityDeps({
		seed: walletManifest,
		statePath: options.statePath,
	});
	// The credential provider + the citizen's identity: out of the box, one in-memory fixture
	// (so import → verify → share works offline and is testable); swap for real/WASM in production.
	// Paired so a presentation the citizen SIGNS (via identity) verifies against the same provider.
	const fixture =
		options.credentialsProvider && options.identity
			? { provider: options.credentialsProvider, identity: options.identity }
			: createInMemoryCredentialsProviderFixture();
	return {
		...deps,
		credentialsProvider: fixture.provider,
		identity: fixture.identity,
		now: options.now,
	};
}

const STATE_LABELS: Record<string, string> = {
	verified: "Verificados",
	draft: "A verificar",
	unreviewed: "Sem status",
};

/** Render the citizen's wallet — their held items, grouped by verification status. */
function renderWallet(env: RecordsAnalyzeEnvelope): string {
	const lines: string[] = [
		"👜 Minha Carteira Digital",
		"",
		`${env.summary.total} itens · você é dono dos seus dados`,
		"",
	];
	for (const group of env.groups) {
		lines.push(`${STATE_LABELS[group.key] ?? group.label} (${group.count})`);
		for (const record of group.records) {
			lines.push(`  • ${record.title}`);
		}
		lines.push("");
	}
	return lines.join("\n").trimEnd() + "\n";
}

/** Minimal HTML escape for user-derived text going into the wallet card. */
function esc(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

/** A short YYYY-MM-DD from an ISO date, or the raw value. */
function shortDate(value: unknown): string {
	const s = typeof value === "string" ? value : "";
	return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : s;
}

/** Is a credential past its expirationDate (relative to now)? */
function isExpired(expiration: unknown, nowMs: number): boolean {
	const s = typeof expiration === "string" ? expiration : "";
	const t = Date.parse(s);
	return Number.isFinite(t) && t < nowMs;
}

/** Render ONE wallet item as a rich credential CARD: title, kind, issuer, validity, and a
 * status badge (verified ✓ / a verificar / expirado). Reads the record's open fields (issuer,
 * kind, expirationDate) the analyze envelope now carries — this is the citizen SEEING their
 * credential, the peso of the wallet as a product. Pure HTML/CSS over the DS classes. */
function renderWalletCard(
	record: { title: string; reviewState?: string; fields?: Record<string, unknown> },
	nowMs: number,
): string {
	const fields = record.fields ?? {};
	const state = record.reviewState ?? "unreviewed";
	const expired = isExpired(fields.expirationDate, nowMs);
	const badge = expired
		? { cls: "refarm-badge-danger", text: "Expirado" }
		: state === "verified"
			? { cls: "refarm-badge-ok", text: "✓ Verificado" }
			: { cls: "refarm-badge-muted", text: STATE_LABELS[state] ?? "Sem status" };
	const meta: string[] = [];
	if (typeof fields.kind === "string") meta.push(esc(fields.kind));
	if (typeof fields.issuer === "string") meta.push(`emitido por ${esc(fields.issuer)}`);
	if (fields.expirationDate) meta.push(`válido até ${esc(shortDate(fields.expirationDate))}`);
	return `<article class="refarm-surface-card refarm-stack" data-wallet-item data-review-state="${esc(state)}">
		<div class="refarm-card-row">
			<strong class="refarm-card-title">${esc(record.title)}</strong>
			<span class="refarm-badge ${badge.cls}" data-wallet-badge>${esc(badge.text)}</span>
		</div>
		${meta.length ? `<p class="refarm-muted">${meta.join(" · ")}</p>` : ""}
	</article>`;
}

/** The wallet as a real WEB product: the citizen's items rendered as credential CARDS with
 * issuer/validity/status, grouped by verification status — so the citizen SEES their wallet,
 * not a list of launcher buttons. This is the `content` the web surface projects ABOVE the verb
 * cards (the generic content seam). `nowMs` is injected for a deterministic expiry check. */
export function renderWalletHtml(env: RecordsAnalyzeEnvelope, nowMs: number = Date.now()): string {
	const groups = env.groups
		.map((group) => {
			const items = group.records.map((record) => renderWalletCard(record, nowMs)).join("");
			return `<section class="refarm-stack" data-wallet-group="${esc(group.key)}">
				<p class="refarm-eyebrow">${esc(STATE_LABELS[group.key] ?? group.label)} · ${group.count}</p>
				${items}
			</section>`;
		})
		.join("");
	return `<section class="refarm-stack" data-wallet-html>
		<p class="refarm-eyebrow">Minha Carteira Digital</p>
		<h1>👜 ${env.summary.total} itens</h1>
		<p>Você é dono dos seus dados — soberano, local-first. Importe, verifique e compartilhe só o necessário.</p>
		${groups}
	</section>`;
}

/** The T2 persona verb: `wallet` - the citizen's wallet view over the neutral
 * `records analyze` envelope (grouped by review state). */
export function createWalletCapability(recordsDeps: RecordsCommandDeps): CapabilityDescriptor {
	return defineRecordsViewCapability({
		name: "wallet",
		summary: "Minha carteira digital — os itens que eu detenho (soberano, local-first)",
		records: recordsDeps,
		renderers: {
			tui: { section: "wallet" },
			web: { route: "/wallet", icon: "wallet" },
		},
		project: (analyzed) => ({
			total: analyzed.summary.total,
			wallet: renderWallet(analyzed),
			walletHtml: renderWalletHtml(analyzed),
			byState: analyzed.summary.byState,
		}),
	});
}

/** A wallet view filtered to one review state — a dashboard card. RICH via BREADTH
 * (ADR-085): each is a pure declaration (name + renderers.web + a project that filters),
 * and the bridge turns them into cards grouped under the "wallet" section. The dashboard
 * grows from declarations, not a hand-rolled UI — the T2 "declare once → web" richness. */
function createWalletStateView(
	recordsDeps: RecordsCommandDeps,
	state: string,
	label: string,
): CapabilityDescriptor {
	return defineRecordsViewCapability({
		name: `wallet-${state}`,
		summary: `${label} — os itens da carteira com status "${label.toLowerCase()}"`,
		records: recordsDeps,
		renderers: {
			tui: { section: "wallet" },
			web: { route: `/wallet/${state}`, icon: "wallet" },
		},
		project: (analyzed) => {
			const group = analyzed.groups.find((g) => g.key === state);
			return {
				state,
				label,
				count: group?.count ?? 0,
				items: (group?.records ?? []).map((r) => ({ title: r.title, link: r.link })),
			};
		},
	});
}

/** The citizen wallet dashboard: the main wallet view plus one card per review state.
 * All share `renderers.tui.section = "wallet"` so they group into a single web panel. */
export interface WalletCapabilitiesOptions {
	/** The credential provider for `verify` + `share` (from the bundle). */
	credentialsProvider?: CredentialsProvider;
	/** The citizen's identity provider for `share` (signs the presentation). */
	identity?: IdentityProvider;
	/** Deterministic clock for import/verify `review.at` in tests. */
	now?: () => string;
}

export function createWalletCapabilities(
	recordsDeps: RecordsCommandDeps,
	options: WalletCapabilitiesOptions = {},
): CapabilityDescriptor[] {
	const capabilities = [
		createWalletCapability(recordsDeps),
		createWalletStateView(recordsDeps, "verified", "Verificados"),
		createWalletStateView(recordsDeps, "draft", "A verificar"),
		// The real work: import a credential file (local-first) and verify it for real.
		createWalletImportCapability(recordsDeps, { now: options.now }),
	];
	if (options.credentialsProvider) {
		capabilities.push(
			createWalletVerifyCapability(recordsDeps, options.credentialsProvider, { now: options.now }),
		);
		// Sharing needs the citizen's identity to SIGN the presentation.
		if (options.identity) {
			capabilities.push(
				createWalletShareCapability(recordsDeps, options.credentialsProvider, options.identity),
			);
		}
	}
	return capabilities;
}

/** The wallet's web surface — the SAME registry projected into a Homestead panel of
 * cards (the dashboard). T2 is RESULT mode: this is the citizen's wallet as a real web
 * product, rich via the declared views above, mounted by a host that registers the handle. */
export function walletWebSurface(registry: Parameters<typeof createCapabilityWebSurfacePlugin>[0]) {
	return createCapabilityWebSurfacePlugin(registry, {
		pluginId: "wallet-t2/web",
		name: "Minha Carteira Digital",
		title: "Minha Carteira Digital",
		surfaceId: "wallet-panel",
		// The content seam: the boot runs the `wallet` verb and puts its rendered HTML on
		// host.data.walletHtml, so the citizen sees their actual wallet ABOVE the verb cards
		// — the generic content path (same shape reqbench uses for its MOC), no bespoke UI.
		content: (data) => (typeof data.walletHtml === "string" ? data.walletHtml : ""),
	});
}
