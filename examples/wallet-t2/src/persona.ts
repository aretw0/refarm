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

import { createWalletImportCapability, createWalletVerifyCapability } from "./credentials.js";
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
	/** The credential verifier — the substrate's W3C verifier (signature/issuer/validity). An
	 * in-memory fixture is used out of the box; a real deployment injects one bound to the
	 * citizen's identity + storage (or a WASM verifier). Only used by the `verify` verb. */
	credentialsProvider?: CredentialsProvider;
	/** Deterministic clock for `review.at` in tests. */
	now?: () => string;
}

export function walletCapabilityBundle(options: WalletBundleOptions = {}) {
	const deps = createLocalRecordsCapabilityDeps({
		seed: walletManifest,
		statePath: options.statePath,
	});
	// The credential verifier: out of the box, the substrate's in-memory W3C verifier fixture
	// (so import → verify works offline and is testable); swap for a real/WASM one in production.
	const credentialsProvider =
		options.credentialsProvider ?? createInMemoryCredentialsProviderFixture().provider;
	return { ...deps, credentialsProvider, now: options.now };
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

/** The wallet as a real WEB product: the same grouped items rendered as design-system
 * cards, so the citizen SEES their wallet — not a list of launcher buttons. This is the
 * `content` the web surface projects ABOVE the verb cards (the generic content seam). */
export function renderWalletHtml(env: RecordsAnalyzeEnvelope): string {
	const groups = env.groups
		.map((group) => {
			const items = group.records
				.map(
					(record) =>
						`<li class="refarm-stack" data-wallet-item><strong>${esc(record.title)}</strong></li>`,
				)
				.join("");
			return `<section class="refarm-surface-card refarm-stack" data-wallet-group="${esc(group.key)}">
				<p class="refarm-eyebrow">${esc(STATE_LABELS[group.key] ?? group.label)} · ${group.count}</p>
				<ul class="refarm-stack">${items}</ul>
			</section>`;
		})
		.join("");
	return `<section class="refarm-stack" data-wallet-html>
		<p class="refarm-eyebrow">Minha Carteira Digital</p>
		<h1>👜 ${env.summary.total} itens</h1>
		<p>Você é dono dos seus dados — soberano, local-first.</p>
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
	/** The credential verifier for the `verify` verb (from the bundle). */
	credentialsProvider?: CredentialsProvider;
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
