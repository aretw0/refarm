/**
 * WHAT THE PROVIDER SAYS ABOUT ITSELF, before this node blames its own credential.
 *
 * ## The cycle this exists to stop, measured 2026-08-17
 *
 * A Copilot token exchange answered 403 four times out of four, on two different accounts, under
 * two different declared identities, with a `x-github-request-id` proving the request reached
 * GitHub. Every one of those observations was true, and the conclusion drawn from them — "GitHub
 * refuses this client" — was wrong. GitHub's own status page said, at that moment:
 *
 *     Copilot ......... major_outage
 *     19:13  "We have partially disabled authentication token retries"
 *
 * The failing endpoint IS an authentication token exchange. The provider had declared, publicly and
 * in writing, that it had turned off the thing we were calling.
 *
 * The operator meanwhile was sent by refarm's own error message — "may only honour known
 * integration ids" — to re-register an identity, re-run the device flow three times, and change a
 * config key. None of it could have worked, and none of it was his mistake or ours.
 *
 * ## Three states, and the middle one is the whole point
 *
 *  - `operational`  the provider says it is fine, so a refusal is about US or our credential
 *  - `impaired`     the provider has DECLARED trouble; a refusal now says nothing about us
 *  - `unknown`      nobody could be asked. NOT operational, and the distinction matters most
 *                   exactly when the network is the thing that is broken
 *
 * Collapsing `unknown` into `operational` would reintroduce the same defect one level up: a status
 * check that could not run would license the same wrong conclusion it exists to prevent.
 *
 * PURE. Takes a fetched status document and returns a reading. The fetch belongs to the caller.
 */

export type ProviderHealth = "operational" | "impaired" | "unknown";

export interface ProviderStatus {
	readonly health: ProviderHealth;
	/** The provider's own words, when it gave any. Display only — never parsed for meaning. */
	readonly summary?: string;
	/** When the provider says the trouble started, in its own format. */
	readonly since?: string;
}

/** Statuspage component states that mean "this is not working normally". */
const IMPAIRED = new Set([
	"degraded_performance",
	"partial_outage",
	"major_outage",
	"under_maintenance",
]);

const str = (value: unknown): string | undefined =>
	typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;

/**
 * PURE. One component's health from a Statuspage `summary.json`.
 *
 * Statuspage is the format GitHub, OpenAI and Anthropic all publish, so one reader serves every
 * provider this node might ask about — `componentName` is the only thing that differs.
 *
 * MATCHED CASE-INSENSITIVELY AND EXACTLY, never by substring: "Copilot" must not match a component
 * called "Copilot Workspace" that happens to be fine while Copilot itself is not.
 */
export function readProviderStatus(document: unknown, componentName: string): ProviderStatus {
	if (!document || typeof document !== "object" || Array.isArray(document)) {
		return { health: "unknown" };
	}
	const components = (document as { components?: unknown }).components;
	if (!Array.isArray(components)) return { health: "unknown" };
	const wanted = componentName.trim().toLowerCase();
	for (const entry of components) {
		if (!entry || typeof entry !== "object") continue;
		const name = str((entry as { name?: unknown }).name);
		if (!name || name.toLowerCase() !== wanted) continue;
		const status = str((entry as { status?: unknown }).status);
		if (!status) return { health: "unknown" };
		if (!IMPAIRED.has(status)) return { health: "operational" };
		return {
			health: "impaired",
			summary: `${name} is ${status.replace(/_/gu, " ")}`,
			...(str((entry as { updated_at?: unknown }).updated_at)
				? { since: str((entry as { updated_at?: unknown }).updated_at)! }
				: {}),
		};
	}
	// A component this document does not carry is not a healthy one — it is one nobody asked about.
	return { health: "unknown" };
}

/**
 * PURE. The most recent declared incident touching a component, for the operator to read.
 *
 * Carried SEPARATELY from the health verdict: the verdict decides what a refusal means, and this
 * only decides what to print. A caller that acted on prose would be parsing an outage report for
 * meaning, which is the same mistake as trusting a justification field.
 */
export function latestIncidentNote(document: unknown, componentName: string): string | undefined {
	if (!document || typeof document !== "object") return undefined;
	const incidents = (document as { incidents?: unknown }).incidents;
	if (!Array.isArray(incidents)) return undefined;
	const wanted = componentName.trim().toLowerCase();
	for (const incident of incidents) {
		if (!incident || typeof incident !== "object") continue;
		const components = (incident as { components?: unknown }).components;
		const touches =
			Array.isArray(components) &&
			components.some(
				(c) => c && typeof c === "object" && str((c as { name?: unknown }).name)?.toLowerCase() === wanted,
			);
		if (!touches) continue;
		const updates = (incident as { incident_updates?: unknown }).incident_updates;
		const body = Array.isArray(updates)
			? str((updates[0] as { body?: unknown } | undefined)?.body)
			: undefined;
		const name = str((incident as { name?: unknown }).name);
		return body ? `${name ?? "incident"}: ${body}` : name;
	}
	return undefined;
}

/**
 * PURE. How a refusal should be read, given what the provider says about itself.
 *
 * The SENTENCE is the deliverable. An operator who is told "GitHub did not accept this identity"
 * changes his identity; one told "Copilot is in a declared major outage" waits. Both sentences
 * follow the same HTTP status, and only one of them is actionable.
 */
export function explainRefusal(
	status: ProviderStatus,
	httpStatus: number,
	incidentNote?: string,
): string {
	if (status.health === "impaired") {
		return (
			`the provider has DECLARED trouble (${status.summary ?? "impaired"}), so this HTTP ` +
			`${httpStatus} says nothing about this node or its credential. Wait for the incident to ` +
			`clear and try again.` +
			(incidentNote ? ` Provider's own note — ${incidentNote}` : "")
		);
	}
	if (status.health === "unknown") {
		return (
			`HTTP ${httpStatus}, and the provider's status could not be consulted — so whether this is ` +
			"about this node or about the provider is UNMEASURED. Check the provider's status page " +
			"before changing anything here."
		);
	}
	return `HTTP ${httpStatus}, and the provider reports itself operational — so this is about this node or its credential.`;
}
