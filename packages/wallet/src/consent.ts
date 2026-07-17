import {
	buildJsonErrorEnvelope,
	buildJsonSuccessEnvelope,
	type CapabilityDescriptor,
	type CapabilityEnvelope,
	type CapabilityInput,
	type RecordsCommandDeps,
} from "@refarm.dev/capability-host";
import type { AuthorizationReceipt, ServiceRequest } from "@refarm.dev/authorization-contract-v1";
import { renderAuthorizationList, renderConsentPrompt } from "@refarm.dev/authorization-contract-v1";
import {
	computeRecordContentHash,
	type KnowledgeRecord,
	type RecordsManifest,
} from "@refarm.dev/records-contract-v1";
import { mergeAndRecord } from "@refarm.dev/history-contract-v1";

import { receiptToRecord, recordToReceipt } from "./authorization.js";

/**
 * The CONSENT-PROMPT journey — the moment the wallet was missing (T2-F7): a service SUBMITS a
 * request FOR the citizen's attributes, and the citizen SEES the pending prompt and DECIDES —
 * Authorize (→ a signed receipt) or Decline — BEFORE anything is disclosed. Today `authorize`
 * both makes and grants a request in one step, skipping the decision; this adds the pending queue
 * so the sovereign choice is a real, first-class step.
 *
 * refarm ships the render (renderConsentPrompt = the T2-F7 screen) and the receipt journey in
 * @refarm.dev/authorization-contract-v1; this wires the pending queue over the wallet's records
 * (a pending request is a wallet record, so it survives, lists, and can be declined/authorized).
 */

/** The record `@type` for a PENDING service request — a wallet item awaiting the citizen's
 * decision (distinct from a granted AuthorizationReceipt). */
const PENDING_REQUEST_TYPE = ["KnowledgeRecord", "WalletItem", "PendingServiceRequest"];

function pendingRecordId(request: ServiceRequest): string {
	return `record:pending-${request.id.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")}`;
}

/** Map a pending ServiceRequest to a wallet record, keeping the full request on
 * `fields.pendingRequest` so the consent screen re-reads it exactly as submitted. */
export function pendingRequestToRecord(request: ServiceRequest, now: () => string): KnowledgeRecord {
	const record = {
		id: pendingRecordId(request),
		schemaVersion: 1,
		"@type": PENDING_REQUEST_TYPE,
		"@context": "https://refarm.dev/contexts/records/v1",
		fields: {
			title: `Pedido pendente ← ${request.requester}`,
			kind: "pedido-de-consentimento",
			requester: request.requester,
			purpose: request.purpose,
			scope: request.requestedAttributes,
			status: "pending",
			expiresAt: request.expiresAt,
			pendingRequest: request as unknown as Record<string, unknown>,
		},
		sections: [{ key: "request", content: JSON.stringify(request, null, 2) }],
		review: { state: "unreviewed", at: now(), notes: request.purpose },
		contentHash: "",
	} as unknown as KnowledgeRecord;
	record.contentHash = computeRecordContentHash(record);
	return record;
}

/** Read a pending ServiceRequest back from a wallet record, or null if it isn't one. */
export function recordToPendingRequest(record: KnowledgeRecord): ServiceRequest | null {
	const pending = (record.fields as Record<string, unknown> | undefined)?.pendingRequest;
	return pending ? (pending as unknown as ServiceRequest) : null;
}

/** Is this record a pending consent request? */
export function isPendingRequest(record: { fields?: Record<string, unknown> }): boolean {
	return Boolean(record.fields?.pendingRequest);
}

/** Merge by id AND append a revision for each changed record (history:v1) — so a pending consent
 * request that is later re-requested/updated leaves a durable trail, like every other merge. */
function mergeRecords(
	manifest: RecordsManifest,
	incoming: KnowledgeRecord[],
	now: () => string = () => new Date().toISOString(),
	origin?: string,
): RecordsManifest {
	return mergeAndRecord(manifest, incoming, now, origin);
}

function removeRecord(manifest: RecordsManifest, id: string): RecordsManifest {
	return { ...manifest, records: manifest.records.filter((r) => r.id !== id) };
}

function parseScope(value: unknown): string[] {
	return String(value ?? "")
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean);
}

/**
 * `request <requester> --purpose <p> --scope a,b --expires <iso>` — a SERVICE submits a request
 * for the citizen's attributes. It lands as a PENDING wallet item (not yet granted), so the
 * citizen sees the consent prompt and decides. This stands in for an external verifier's request
 * (local-first, testable offline) — the producer of the T2-F7 decision moment.
 */
export function createWalletRequestCapability(
	recordsDeps: RecordsCommandDeps,
	options: { now?: () => string } = {},
): CapabilityDescriptor {
	const now = options.now ?? ((): string => new Date().toISOString());
	return {
		name: "request",
		summary: "A service submits a request for my attributes — it lands pending for me to decide",
		args: [{ name: "requester", required: true }],
		options: [
			{ name: "purpose", kind: "string", summary: "Why the service needs the attributes" },
			{ name: "scope", kind: "string", summary: "Comma-separated attribute names requested" },
			{ name: "expires", kind: "string", summary: "When the request lapses (ISO 8601)" },
		],
		transports: { http: { path: "/wallet/request" } },
		renderers: { tui: { section: "wallet" } },
		async run(input: CapabilityInput): Promise<CapabilityEnvelope> {
			const requester = String(input.args.requester ?? "");
			const purpose = String(input.options?.purpose ?? "").trim();
			const scope = parseScope(input.options?.scope);
			const expiresAt = String(input.options?.expires ?? "").trim();
			if (!requester || !purpose || scope.length === 0 || !expiresAt) {
				return buildJsonErrorEnvelope({
					command: "request",
					operation: "request",
					error: "missing_request_fields",
					message: "A request needs a requester, --purpose, --scope a,b and --expires <iso>.",
					nextAction: "A request must state purpose, scope and expiry — never open-ended.",
				});
			}
			const request: ServiceRequest = {
				id: `request-${requester}-${now()}`,
				requester,
				subject: "citizen-local",
				purpose,
				requestedAttributes: scope,
				expiresAt,
			};
			const record = pendingRequestToRecord(request, now);
			if (!recordsDeps.saveManifest) {
				return buildJsonSuccessEnvelope({
					command: "request",
					operation: "request",
					extra: { id: record.id, request, persisted: false, dryRun: true },
				});
			}
			await recordsDeps.saveManifest(mergeRecords(recordsDeps.loadManifest(), [record], now, "request"));
			return buildJsonSuccessEnvelope({
				command: "request",
				operation: "request",
				nextCommand: "dgk consent",
				nextCommands: ["dgk consent"],
				extra: { id: record.id, requester, pending: true, persisted: true },
			});
		},
	};
}

/**
 * `consent` — the T2-F7 SCREEN: render every pending request as a consent prompt (what the
 * service wants, why, which attributes, Authorize / Decline). This is the decision moment the
 * citizen sees before anything is shared. Projects `consentHtml` (via renderConsentPrompt) for the
 * web face + a count of pending requests.
 */
export function createWalletConsentCapability(recordsDeps: RecordsCommandDeps): CapabilityDescriptor {
	return {
		name: "consent",
		summary: "Show pending requests as consent prompts — decide before anything is shared (T2-F7)",
		transports: { http: { path: "/wallet/consent" } },
		renderers: { tui: { section: "wallet" }, web: { route: "/wallet/consent", icon: "wallet" } },
		async run(): Promise<CapabilityEnvelope> {
			const manifest = recordsDeps.loadManifest();
			const pending = manifest.records
				.map((r) => recordToPendingRequest(r))
				.filter((r): r is ServiceRequest => r !== null);
			const consentHtml = pending.length
				? pending.map((request) => renderConsentPrompt(request)).join("\n")
				: `<p class="refarm-muted">Nenhum pedido pendente. Você está em dia.</p>`;
			// The DECIDED side of the screen: authorizations the citizen has already granted, active
			// first, each with a Revoke control (renderAuthorizationList). So the consent screen shows
			// the whole picture — what awaits a decision, and what is already shared and can be pulled.
			const authorizations = manifest.records
				.map((r) => recordToReceipt(r))
				.filter((r): r is AuthorizationReceipt => r !== null);
			const authorizationsHtml = renderAuthorizationList(authorizations);
			return buildJsonSuccessEnvelope({
				command: "consent",
				operation: "consent",
				nextCommand: "dgk wallet",
				nextCommands: ["dgk wallet"],
				extra: {
					pendingCount: pending.length,
					consentHtml,
					authorizationCount: authorizations.length,
					authorizationsHtml,
					pending: pending.map((r) => ({ id: pendingRecordId(r), requester: r.requester, purpose: r.purpose })),
				},
			});
		},
	};
}

/**
 * `decline <id>` — the citizen REFUSES a pending request. It is removed (no receipt, nothing
 * shared) — the sovereign "no". The `authorize` verb is the sovereign "yes" (it grants a receipt).
 */
export function createWalletDeclineCapability(recordsDeps: RecordsCommandDeps): CapabilityDescriptor {
	return {
		name: "decline",
		summary: "Decline a pending request — refuse to share (the sovereign no)",
		args: [{ name: "id", required: true }],
		transports: { http: { path: "/wallet/decline" } },
		renderers: { tui: { section: "wallet" } },
		async run(input: CapabilityInput): Promise<CapabilityEnvelope> {
			const id = String(input.args.id ?? "");
			const manifest = recordsDeps.loadManifest();
			// Match by record id (the `consent` list) OR by the embedded request id (what
			// renderConsentPrompt's Decline control carries) — same verb for CLI and web.
			const record = manifest.records.find(
				(r) =>
					(r.id === id ||
						(r.fields as { pendingRequest?: { id?: string } } | undefined)?.pendingRequest?.id === id) &&
					isPendingRequest(r),
			);
			if (!record) {
				return buildJsonErrorEnvelope({
					command: "decline",
					operation: "decline",
					error: "no_pending_request",
					message: `No pending request "${id}" to decline.`,
					nextAction: "dgk consent",
				});
			}
			if (!recordsDeps.saveManifest) {
				return buildJsonSuccessEnvelope({
					command: "decline",
					operation: "decline",
					extra: { id, declined: true, persisted: false, dryRun: true },
				});
			}
			await recordsDeps.saveManifest(removeRecord(manifest, record.id));
			return buildJsonSuccessEnvelope({
				command: "decline",
				operation: "decline",
				nextCommand: "dgk consent",
				nextCommands: ["dgk consent"],
				extra: { id, declined: true, persisted: true },
			});
		},
	};
}

/** Re-export so the authorize verb can consume a pending request (the "yes" that grants it). */
export { receiptToRecord };
