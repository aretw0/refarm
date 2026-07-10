/**
 * The ONE place per-provider "doctor knowledge" lives — recovery advice, whether
 * the provider is the keyless local floor, and whether localhost/docker base-URL
 * rewrite advice applies. Before this, that knowledge was inlined in three
 * ollama-hardcoded functions in model.ts (handoffs, recovery commands,
 * recommendations); centralizing it here means widening `model doctor` to more
 * providers edits ONE table, not three call sites.
 *
 * BOUNDARY: this table holds only TS-legitimate knowledge. Per-provider BASE URLs
 * are deliberately absent — the canonical provider→baseURL map lives ONLY in the
 * Rust host (known_provider_base_url), and duplicating it here would reintroduce
 * the divergent-config drift the config-node work exists to kill. Base URLs reach
 * a probe via the runtime, never via this table.
 */

/** The outcome vocabulary of a provider reachability probe. `ready` alone is too
 * coarse: a keyed provider with a missing key is not "down", and a provider whose
 * endpoint TS cannot resolve is not "unreachable" — each deserves its own honest
 * signal so the warning is accurate, not noise. */
export type ProviderProbeReason =
	/** HTTP reachable (2xx, or any response that proves the endpoint is up). */
	| "reachable"
	/** Endpoint known but the ping failed (network error / timeout). */
	| "unreachable"
	/** Endpoint up but rejected the request (401/403) — auth, not a network fault. */
	| "auth-failed"
	/** Keyed provider whose credential is absent — NOT pinged; warn the key is missing. */
	| "credential-missing"
	/** Non-ollama provider with no TS-resolvable base URL — the runtime probe fills this. */
	| "no-endpoint-source"
	/** Not applicable / not probed. */
	| "skipped";

export interface ProviderDoctorProfile {
	/** Keyless local floor (ollama): probe with no auth, and "down" is a real
	 * warning rather than a missing-credential signal. */
	keyless: boolean;
	/** Localhost-style provider → the docker base-URL rewrite advice applies. */
	localRuntime: boolean;
	/** Recovery command to start the provider locally, if any (ollama: "ollama serve"). */
	startCommand?: string;
	/** Human recovery sentence for a `recommendations[].action`. */
	recoveryAction: string;
}

/** Only providers with SPECIAL doctor knowledge need an entry; every other
 * provider uses {@link DEFAULT_REMOTE_PROFILE}. */
export const PROVIDER_DOCTOR_PROFILES: Record<string, ProviderDoctorProfile> = {
	ollama: {
		keyless: true,
		localRuntime: true,
		startCommand: "ollama serve",
		recoveryAction:
			"Start Ollama where Refarm can reach it, or set a base URL that matches the runtime network.",
	},
};

/** A remote, keyed provider with no local runtime to start — the default when a
 * provider has no special profile. */
export const DEFAULT_REMOTE_PROFILE: ProviderDoctorProfile = {
	keyless: false,
	localRuntime: false,
	recoveryAction:
		"Confirm the provider credential is set and the endpoint is reachable from the runtime.",
};

/** The doctor profile for a provider (case-insensitive), or the remote default. */
export function providerDoctorProfile(provider: string | undefined): ProviderDoctorProfile {
	const key = provider?.trim().toLowerCase();
	return (key && PROVIDER_DOCTOR_PROFILES[key]) || DEFAULT_REMOTE_PROFILE;
}
