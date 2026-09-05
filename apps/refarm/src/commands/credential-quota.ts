/**
 * WHAT EACH ACCOUNT HAS LEFT — asked of the providers, reported per account.
 *
 * ISS-064's ruling in one command: the denominator is an EXTRACTION. This asks every account this
 * node holds, using the credential it already has, and reports what came back — including, for
 * every provider it has no reader for, that it did not ask. A node that quietly listed only the
 * providers it could read would let "we never asked" pass for "there is nothing to report".
 */
import {
	GITHUB_COPILOT_STATUS_COMPONENT,
	GITHUB_STATUS_SUMMARY_URL,
} from "@refarm.dev/github-copilot-wire";
import {
	explainRefusal,
	isMeterExhausted,
	latestIncidentNote,
	readProviderStatus,
	type AccountQuota,
	type ModelAccountDescriptor,
	type ProviderStatus,
	type QuotaMeter,
} from "@refarm.dev/model-account-contract-v1";

import { readCopilotQuota, type CopilotQuotaDeps, type QuotaOutcome } from "../credentials/copilot-quota.js";

/** Providers this node can ask. Anything absent is reported as unasked, never as empty. */
const READERS: Readonly<
	Record<string, (credential: unknown, deps: CopilotQuotaDeps) => Promise<QuotaOutcome>>
> = {
	"github-copilot": readCopilotQuota,
};

/** Which providers declare their own health, and where. Statuspage is the format GitHub, OpenAI
 *  and Anthropic all publish, so adding one is a URL and a component name. */
const STATUS_SOURCES: Readonly<Record<string, { url: string; component: string }>> = {
	"github-copilot": {
		url: GITHUB_STATUS_SUMMARY_URL,
		component: GITHUB_COPILOT_STATUS_COMPONENT,
	},
};

export interface AccountQuotaRow {
	readonly credentialId: string;
	readonly provider: string;
	readonly alias: string;
	readonly outcome: QuotaOutcome["kind"];
	readonly detail?: string;
	/** What the provider declares about itself, attached only when this row failed. */
	readonly providerHealth?: ProviderStatus["health"];
	readonly quota?: AccountQuota;
}

/** PURE. One account's row from its descriptor and the outcome of asking. */
export function quotaRow(
	descriptor: ModelAccountDescriptor,
	outcome: QuotaOutcome,
): AccountQuotaRow {
	const base = {
		credentialId: descriptor.credentialId,
		provider: descriptor.provider,
		alias: descriptor.alias,
	};
	switch (outcome.kind) {
		case "read":
			return { ...base, outcome: "read", quota: outcome.quota };
		case "cannot-ask":
			return { ...base, outcome: "cannot-ask", detail: outcome.reason };
		case "unreachable":
			return { ...base, outcome: "unreachable", detail: outcome.reason };
		case "rejected":
			return {
				...base,
				outcome: "rejected",
				detail: `the provider rejected this credential (HTTP ${outcome.status}). This is a credential to repair, not a quota that ran out.`,
			};
		case "unavailable":
			return {
				...base,
				outcome: "unavailable",
				detail: `the provider did not answer (HTTP ${outcome.status}), which says nothing about quota.`,
			};
	}
}

/**
 * WHAT THE PROVIDER SAYS ABOUT ITSELF, asked ONCE per provider and only when something failed.
 *
 * Not on the happy path: a reading that succeeded needs no alibi, and asking anyway would spend a
 * request per run to learn nothing. Asked once rather than per account because two accounts of one
 * provider share its weather — and because the answer to "should I try again later" is a property
 * of the provider, not of the seat.
 */
async function providerStatusFor(
	provider: string,
	deps: CopilotQuotaDeps,
): Promise<{ status: ProviderStatus; note?: string } | undefined> {
	const source = STATUS_SOURCES[provider];
	if (!source) return undefined;
	try {
		const response = await deps.fetch(source.url, { signal: AbortSignal.timeout(5_000) });
		if (!response.ok) return { status: { health: "unknown" } };
		const document: unknown = await response.json();
		const note = latestIncidentNote(document, source.component);
		return {
			status: readProviderStatus(document, source.component),
			...(note ? { note } : {}),
		};
	} catch {
		return { status: { health: "unknown" } };
	}
}

export async function readQuotaRows(
	accounts: readonly ModelAccountDescriptor[],
	credentials: ReadonlyMap<string, unknown>,
	deps: CopilotQuotaDeps,
): Promise<AccountQuotaRow[]> {
	const rows: AccountQuotaRow[] = [];
	for (const descriptor of accounts) {
		const reader = READERS[descriptor.provider];
		if (!reader) {
			rows.push({
				credentialId: descriptor.credentialId,
				provider: descriptor.provider,
				alias: descriptor.alias,
				outcome: "cannot-ask",
				detail: `this node has no quota reader for ${descriptor.provider}, so it did not ask.`,
			});
			continue;
		}
		const credential = credentials.get(descriptor.credentialId);
		if (credential === undefined) {
			rows.push({
				credentialId: descriptor.credentialId,
				provider: descriptor.provider,
				alias: descriptor.alias,
				outcome: "cannot-ask",
				detail: "this node holds no readable secret for this account.",
			});
			continue;
		}
		rows.push(quotaRow(descriptor, await reader(credential, deps)));
	}
	// THE PROVIDER'S OWN WEATHER, attached to the rows that failed. Without it an operator reads a
	// refusal as being about his node — measured 2026-08-17, where a declared Copilot MAJOR OUTAGE
	// was read as GitHub refusing this client, and the repair attempted was an identity nobody
	// needed to change.
	const troubled = [
		...new Set(rows.filter((r) => r.outcome !== "read" && STATUS_SOURCES[r.provider]).map((r) => r.provider)),
	];
	if (troubled.length === 0) return rows;
	const weather = new Map<string, { status: ProviderStatus; note?: string }>();
	for (const provider of troubled) {
		const status = await providerStatusFor(provider, deps);
		if (status) weather.set(provider, status);
	}
	return rows.map((row) => {
		const seen = row.outcome === "read" ? undefined : weather.get(row.provider);
		if (!seen) return row;
		return {
			...row,
			providerHealth: seen.status.health,
			detail: `${row.detail ?? ""} ${explainRefusal(seen.status, 0, seen.note)}`
				.replace("HTTP 0, and ", "")
				.replace("this HTTP 0", "this refusal")
				.trim(),
		};
	});
}

function meterLine(id: string, meter: QuotaMeter): string {
	if (meter.kind === "unlimited") return `${id.padEnd(22)}unlimited`;
	if (meter.kind === "cannot-say") return `${id.padEnd(22)}cannot say — ${meter.reason}`;
	const used = `${meter.remaining} / ${meter.entitlement}`;
	// OVERAGE IS CARRIED because exhausted and BLOCKED are different facts: a seat that permits
	// overage keeps working past zero and bills. Reporting only "depleted" sends the operator
	// looking for a failure that will not happen.
	const overage = meter.overagePermitted ? "  overage permitted" : "";
	const spent = meter.overageCount > 0 ? `  overage used: ${meter.overageCount}` : "";
	return `${id.padEnd(22)}${used.padEnd(18)}${Math.round(meter.percentRemaining)}%${overage}${spent}`;
}

/** PURE. The whole report as the operator reads it. */
export function formatQuotaRows(rows: readonly AccountQuotaRow[]): string {
	if (rows.length === 0) return "no model account is registered on this node\n  refarm sow\n";
	const lines: string[] = [];
	for (const row of rows) {
		lines.push(`  ${row.provider}  ${row.alias}`);
		if (row.outcome !== "read" || !row.quota) {
			lines.push(`    ${row.outcome} — ${row.detail ?? ""}`.trimEnd());
			lines.push("");
			continue;
		}
		const meters = Object.entries(row.quota.meters);
		if (meters.length === 0) {
			lines.push("    the provider answered and stated no meters");
		}
		for (const [id, meter] of meters) lines.push(`    ${meterLine(id, meter)}`);
		if (row.quota.resetsAt) lines.push(`    resets ${row.quota.resetsAt}`);
		lines.push("");
	}
	return `${lines.join("\n").trimEnd()}\n`;
}

/**
 * PURE. The meters that are OUT, across every account — and only the ones actually measured.
 *
 * `isMeterExhausted` is three-valued for a reason and this preserves it: an account nobody could
 * ask contributes nothing here rather than contributing a false negative.
 */
export function exhaustedMeters(
	rows: readonly AccountQuotaRow[],
): readonly { readonly alias: string; readonly meter: string }[] {
	return rows.flatMap((row) =>
		Object.entries(row.quota?.meters ?? {}).flatMap(([id, meter]) =>
			isMeterExhausted(meter) === true ? [{ alias: row.alias, meter: id }] : [],
		),
	);
}
