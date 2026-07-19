// Envelope builders from their browser-safe origin — NOT the capability-host barrel, which pulls
// Commander via defineCapabilityApp and crashes a browser bundle (see consent.ts). Types are erased.
import { buildJsonErrorEnvelope, buildJsonSuccessEnvelope } from "@refarm.dev/capabilities/envelope";
import type {
	CapabilityDescriptor,
	CapabilityEnvelope,
	CapabilityInput,
	RecordsCommandDeps,
} from "@refarm.dev/capability-host";
import type {
	AttributeSet,
	AuthorizationProvider,
	AuthorizationReceipt,
	RevocationEvent,
	ServiceRequest,
} from "@refarm.dev/authorization-contract-v1";
import {
	computeRecordContentHash,
	type KnowledgeRecord,
	type RecordsManifest,
} from "@refarm.dev/records-contract-v1";
import { manifestRevisions, mergeAndRecord, timeline } from "@refarm.dev/history-contract-v1";

import { renderTableHtml } from "@refarm.dev/capability-homestead-surface";

import { recordToCredential } from "./credentials.js";

/**
 * The citizen's AUTHORIZATION journey — the sovereign move the wallet was missing: a
 * service asks for attributes FOR a purpose, the citizen AUTHORIZES a named subset (a
 * signed receipt), PRESENTS only those attributes, and can REVOKE the decision with an
 * auditable trail. refarm ships the journey as a capability (@refarm.dev/authorization-
 * contract-v1); this wires it for the wallet — the receipt↔record mapping and three verbs.
 *
 * This is consent as a first-class wallet object: every authorization records purpose,
 * scope, expiry and status, so the citizen SEES and CONTROLS what they shared and can undo it.
 */

/** The record `@type` for a stored authorization receipt — a wallet item the citizen holds. */
const AUTHORIZATION_TYPE = ["KnowledgeRecord", "WalletItem", "AuthorizationReceipt"];

/** The record `@type` for a persisted revocation event — the durable audit trail entry. */
const REVOCATION_EVENT_TYPE = ["KnowledgeRecord", "RevocationEvent"];

/** A stable record id for a revocation event (one per authorization revoked). */
function revocationEventRecordId(event: RevocationEvent): string {
	return `record:revocation-${event.authorizationId.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")}`;
}

/**
 * Persist a RevocationEvent as a durable audit record — the "auditable trail" the module
 * promises, made real. The revoked receipt only records the CURRENT status (revoked); this
 * captures WHEN and WHY (revokedAt, statusBefore/After, reason), so the citizen's sovereign
 * history survives the command. Mirrors receiptToRecord's shape. PURE.
 */
export function revocationEventToRecord(event: RevocationEvent, now: () => string): KnowledgeRecord {
	const record = {
		id: revocationEventRecordId(event),
		schemaVersion: 1,
		"@type": REVOCATION_EVENT_TYPE,
		"@context": "https://refarm.dev/contexts/records/v1",
		fields: {
			title: `Revogação → ${event.authorizationId}`,
			kind: "revogação",
			authorizationId: event.authorizationId,
			holder: event.holder,
			revokedAt: event.revokedAt,
			statusBefore: event.statusBefore,
			statusAfter: event.statusAfter,
			...(event.reason ? { reason: event.reason } : {}),
			// The full event, so a history view re-reads it exactly.
			event: event as unknown as Record<string, unknown>,
		},
		review: { state: "verified", at: now(), notes: event.reason ?? "revogado pelo cidadão" },
		contentHash: "",
	} as unknown as KnowledgeRecord;
	record.contentHash = computeRecordContentHash(record);
	return record;
}

/** The citizen's held attributes — the source a presentation discloses FROM. A small synthetic
 * baseline (the wallet is a demo) used ONLY until the citizen has verified a real credential; see
 * `verifiedAttributes`, which binds disclosure to the citizen's actually-verified data. */
export function citizenAttributes(): AttributeSet {
	return {
		subject: "citizen-local",
		issuer: "issuer-synthetic",
		issuedAt: "2026-01-01T00:00:00.000Z",
		attributes: {
			nome_social: "Cidadão Exemplo",
			faixa_etaria: "30-39",
			municipio: "Cidade Fictícia",
			vinculo: "servidor-fictício",
		},
	};
}

/**
 * The source a presentation discloses FROM, bound to the citizen's VERIFIED credentials — the join
 * that closes the sovereign loop. Loads the manifest, takes every credential the citizen has
 * VERIFIED (`review.state === "verified"`), and projects its `credentialSubject` fields (except the
 * subject id) into disclosable attributes. Falls back to the synthetic baseline ONLY when nothing is
 * verified yet — so `present` discloses the citizen's REAL data the moment import→verify produces it,
 * never more than the receipt's scope. The substrate still filters to scope; this only decides FROM
 * WHAT the disclosure draws.
 */
export function verifiedAttributes(recordsDeps: RecordsCommandDeps): () => AttributeSet {
	return () => {
		const verified = recordsDeps
			.loadManifest()
			.records.filter(
				(r) => (r.review as { state?: string } | undefined)?.state === "verified" && recordToCredential(r) !== null,
			);
		if (verified.length === 0) return citizenAttributes();
		const attributes: Record<string, unknown> = {};
		let subject: string | undefined;
		let issuer = "self-presented";
		let issuedAt = citizenAttributes().issuedAt;
		for (const record of verified) {
			const vc = recordToCredential(record);
			const subj = (vc?.credentialSubject ?? {}) as Record<string, unknown>;
			const subjectId = typeof subj.id === "string" ? subj.id : undefined;
			// Only the CITIZEN's OWN verified attributes are disclosable. The first verified subject
			// fixes the holder; a credential for a DIFFERENT subject id is SKIPPED — never silently
			// adopt another holder's identity into the citizen's presentation.
			if (subject === undefined) subject = subjectId;
			else if (subjectId !== undefined && subjectId !== subject) continue;
			if (typeof vc?.issuer === "string") issuer = vc.issuer;
			if (typeof vc?.issuanceDate === "string") issuedAt = vc.issuanceDate;
			for (const [key, value] of Object.entries(subj)) {
				if (key !== "id") attributes[key] = value;
			}
		}
		return { subject: subject ?? "citizen-local", issuer, issuedAt, attributes };
	};
}

/** A stable record id for an authorization receipt. */
function authorizationRecordId(receipt: AuthorizationReceipt): string {
	return `record:authz-${receipt.id.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")}`;
}

/** Map an AuthorizationReceipt to a wallet KnowledgeRecord. The full receipt is kept on
 * `fields.authorization` so present/revoke re-read it exactly as signed. */
export function receiptToRecord(receipt: AuthorizationReceipt, now: () => string): KnowledgeRecord {
	const record = {
		id: authorizationRecordId(receipt),
		schemaVersion: 1,
		"@type": AUTHORIZATION_TYPE,
		"@context": "https://refarm.dev/contexts/records/v1",
		fields: {
			title: `Autorização → ${receipt.requester}`,
			kind: "autorização",
			requester: receipt.requester,
			purpose: receipt.purpose,
			scope: receipt.scope,
			status: receipt.status,
			expiresAt: receipt.expiresAt,
			// The full receipt, so present/revoke re-read it exactly as signed.
			authorization: receipt as unknown as Record<string, unknown>,
		},
		sections: [{ key: "authorization", content: JSON.stringify(receipt, null, 2) }],
		review: {
			state: receipt.status === "revoked" ? "unreviewed" : "verified",
			at: now(),
			notes: `${receipt.purpose} · escopo: ${receipt.scope.join(", ")}`,
		},
		contentHash: "",
	} as unknown as KnowledgeRecord;
	record.contentHash = computeRecordContentHash(record);
	return record;
}

/** Read an AuthorizationReceipt back from a wallet record, or null if it isn't one. */
export function recordToReceipt(record: KnowledgeRecord): AuthorizationReceipt | null {
	const authz = (record.fields as Record<string, unknown> | undefined)?.authorization;
	if (!authz || typeof authz !== "object") return null;
	return authz as unknown as AuthorizationReceipt;
}

/** Merge updated receipt/event records into the manifest by id AND append an append-only REVISION
 * for each changed record (history:v1). So an authorization the citizen authorizes then revokes
 * becomes TWO revisions of the SAME record (active → revoked) — the sovereign history of a
 * consent, not just its current status. `now` injected; `origin` labels the verb. */
function mergeRecords(
	manifest: RecordsManifest,
	updates: KnowledgeRecord[],
	now: () => string = () => new Date().toISOString(),
	origin?: string,
): RecordsManifest {
	return mergeAndRecord(manifest, updates, now, origin);
}

/** Parse the `--scope` arg (comma-separated attribute names). */
function parseScope(raw: unknown): string[] {
	return String(raw ?? "")
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean);
}

/**
 * `authorize <requester> --purpose <p> --scope a,b --expires <iso>` — the citizen grants a
 * service a signed, purpose-bound, scoped, expiring authorization. Persists it as a wallet
 * item so the citizen can see and revoke it.
 */
export function createWalletAuthorizeCapability(
	recordsDeps: RecordsCommandDeps,
	provider: AuthorizationProvider,
	options: { now?: () => string } = {},
): CapabilityDescriptor {
	const now = options.now ?? (() => new Date().toISOString());
	return {
		name: "authorize",
		summary: "Authorize a service to see a named subset of my attributes, for a stated purpose",
		// `requester` is required for a fresh grant; omit it and pass `--request <id>` to
		// authorize a PENDING request straight from the consent screen (the T2-F7 "yes").
		args: [{ name: "requester", required: false }],
		options: [
			{ name: "purpose", kind: "string", summary: "Why the service needs the attributes" },
			{ name: "scope", kind: "string", summary: "Comma-separated attribute names to authorize" },
			{ name: "expires", kind: "string", summary: "When the authorization lapses (ISO 8601)" },
			{ name: "request", kind: "string", summary: "Grant a PENDING request by id (from `consent`) — the sovereign yes" },
		],
		transports: { http: { path: "/wallet/authorize" } },
		renderers: { tui: { section: "wallet" } },
		async run(input: CapabilityInput): Promise<CapabilityEnvelope> {
			// The sovereign "yes" to a pending request: load it, grant exactly what it asked,
			// and clear the pending item (the decision is spent). This is the authorize half of
			// the consent journey `decline` already had — Authorize on the T2-F7 screen.
			const pendingId = String(input.options?.request ?? "").trim();
			let requester: string;
			let purpose: string;
			let scope: string[];
			let expiresAt: string;
			let pendingToClear: string | null = null;
			if (pendingId) {
				// Match the pending item by its record id (the `consent` list) OR by the embedded
				// request id (what renderConsentPrompt's Authorize button carries) — so the same
				// verb serves the CLI and the web screen. Clear by the record's actual id.
				const record = recordsDeps
					.loadManifest()
					.records.find(
						(r) =>
							r.id === pendingId ||
							(r.fields as { pendingRequest?: ServiceRequest } | undefined)?.pendingRequest?.id === pendingId,
					);
				const pending = (record?.fields as { pendingRequest?: ServiceRequest } | undefined)?.pendingRequest;
				if (!record || !pending) {
					return buildJsonErrorEnvelope({
						command: "authorize",
						operation: "authorize",
						error: "no_pending_request",
						message: `No pending request "${pendingId}" to authorize.`,
						nextAction: "consent",
					});
				}
				requester = pending.requester;
				purpose = pending.purpose;
				scope = pending.requestedAttributes;
				expiresAt = pending.expiresAt;
				pendingToClear = record.id;
			} else {
				requester = String(input.args.requester ?? "").trim();
				purpose = String(input.options?.purpose ?? "").trim();
				scope = parseScope(input.options?.scope);
				expiresAt = String(input.options?.expires ?? "").trim();
			}
			if (!requester || !purpose || scope.length === 0 || !expiresAt) {
				return buildJsonErrorEnvelope({
					command: "authorize",
					operation: "authorize",
					error: "missing_consent_fields",
					message: "Authorization needs a requester, --purpose, --scope a,b and --expires <iso> (or --request <id>).",
					nextAction: "Consent must state purpose, scope and expiry — it is never open-ended.",
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
			const receipt = await provider.authorize(request);
			const record = receiptToRecord(receipt, now);

			if (!recordsDeps.saveManifest) {
				return buildJsonSuccessEnvelope({
					command: "authorize",
					operation: "authorize",
					extra: { id: record.id, receipt, persisted: false, dryRun: true },
				});
			}
			// Clear the spent pending request (if this was the sovereign yes) in the SAME write.
			const base = recordsDeps.loadManifest();
			const manifest = pendingToClear
				? { ...base, records: base.records.filter((r) => r.id !== pendingToClear) }
				: base;
			await recordsDeps.saveManifest(mergeRecords(manifest, [record], now, "authorize"));
			return buildJsonSuccessEnvelope({
				command: "authorize",
				operation: "authorize",
				nextCommand: "wallet",
				nextCommands: ["wallet"],
				extra: {
					id: record.id,
					requester,
					purpose,
					scope,
					status: receipt.status,
					receipt,
					...(pendingToClear ? { authorizedPending: pendingToClear } : {}),
				},
			});
		},
	};
}

/**
 * `present <authz-id>` — disclose ONLY the authorized attributes for an active
 * authorization. Rejects a revoked/expired one (the substrate enforces it).
 */
export function createWalletPresentCapability(
	recordsDeps: RecordsCommandDeps,
	provider: AuthorizationProvider,
	options: { attributes?: () => AttributeSet } = {},
): CapabilityDescriptor {
	const attributes = options.attributes ?? citizenAttributes;
	return {
		name: "present",
		summary: "Present only the attributes an authorization permits — nothing more",
		args: [{ name: "id", required: true }],
		transports: { http: { path: "/wallet/present" } },
		renderers: { tui: { section: "wallet" } },
		async run(input: CapabilityInput): Promise<CapabilityEnvelope> {
			const id = String(input.args.id ?? "");
			const record = recordsDeps.loadManifest().records.find((r) => r.id === id);
			const receipt = record ? recordToReceipt(record) : null;
			if (!receipt) {
				return buildJsonErrorEnvelope({
					command: "present",
					operation: "present",
					error: "not_found",
					message: `No authorization "${id}".`,
					nextAction: "wallet",
				});
			}
			try {
				const presentation = await provider.present(receipt, attributes());
				return buildJsonSuccessEnvelope({
					command: "present",
					operation: "present",
					extra: {
						id,
						authorizationId: receipt.id,
						disclosed: Object.keys(presentation.attributes),
						presentation,
					},
				});
			} catch (error) {
				return buildJsonErrorEnvelope({
					command: "present",
					operation: "present",
					error: "not_usable",
					message: `Authorization "${id}" is not usable: ${String(error instanceof Error ? error.message : error)}`,
					nextAction: "A revoked or expired authorization cannot present. Authorize again if needed.",
				});
			}
		},
	};
}

/**
 * `revoke <authz-id>` — the citizen withdraws a prior authorization. Records the status
 * transition (an auditable revocation event) and marks the wallet item revoked, so it can
 * no longer present.
 */
export function createWalletRevokeCapability(
	recordsDeps: RecordsCommandDeps,
	provider: AuthorizationProvider,
	options: { now?: () => string } = {},
): CapabilityDescriptor {
	const now = options.now ?? (() => new Date().toISOString());
	return {
		name: "revoke",
		summary: "Revoke an authorization I granted — it can no longer be used",
		args: [{ name: "id", required: true }],
		options: [{ name: "reason", kind: "string", summary: "Why the citizen is revoking" }],
		transports: { http: { path: "/wallet/revoke" } },
		renderers: { tui: { section: "wallet" } },
		async run(input: CapabilityInput): Promise<CapabilityEnvelope> {
			const id = String(input.args.id ?? "");
			const manifest = recordsDeps.loadManifest();
			// Match by record id (the wallet list) OR by the receipt id (what renderAuthorizationList's
			// Revoke control carries) — the same verb serves the CLI and the web screen.
			const record = manifest.records.find((r) => r.id === id || recordToReceipt(r)?.id === id);
			const receipt = record ? recordToReceipt(record) : null;
			if (!record || !receipt) {
				return buildJsonErrorEnvelope({
					command: "revoke",
					operation: "revoke",
					error: "not_found",
					message: `No authorization "${id}".`,
					nextAction: "wallet",
				});
			}
			const reason = input.options?.reason ? String(input.options.reason) : undefined;
			const { event, receipt: revoked } = await provider.revoke(receipt, reason);
			const revokedRecord = receiptToRecord(revoked, now);
			// Persist the event as a durable audit record (not just the status flip) — the
			// revocation's when/why survives the command, so the history is real.
			const eventRecord = revocationEventToRecord(event, now);

			if (!recordsDeps.saveManifest) {
				return buildJsonSuccessEnvelope({
					command: "revoke",
					operation: "revoke",
					extra: { id, event, persisted: false, dryRun: true },
				});
			}
			await recordsDeps.saveManifest(mergeRecords(manifest, [revokedRecord, eventRecord], now, "revoke"));
			return buildJsonSuccessEnvelope({
				command: "revoke",
				operation: "revoke",
				nextCommand: "wallet",
				nextCommands: ["wallet"],
				extra: {
					id,
					statusBefore: event.statusBefore,
					statusAfter: event.statusAfter,
					event,
				},
			});
		},
	};
}

/**
 * `history <id>` — the citizen's sovereign HISTORY of an authorization: every version it went
 * through (active → revoked) as durable revisions, with WHEN and by which verb. The audit trail
 * the trabalho names, made legible per-authorization. Thin: one timeline() over the manifest's
 * revisions.
 */
export function createWalletHistoryCapability(recordsDeps: RecordsCommandDeps): CapabilityDescriptor {
	return {
		name: "history",
		summary: "Show an authorization's revision timeline — every version it went through (active → revoked)",
		args: [{ name: "id", required: true }],
		transports: { http: { path: "/wallet/history" } },
		renderers: { tui: { section: "wallet" }, web: { route: "/history", icon: "history" } },
		async run(input: CapabilityInput): Promise<CapabilityEnvelope> {
			const id = String(input.args.id ?? "");
			if (!id) {
				return buildJsonErrorEnvelope({
					command: "history",
					operation: "history",
					error: "no_id",
					message: "Pass an authorization id.",
					nextAction: "wallet",
				});
			}
			const revisions = timeline(manifestRevisions(recordsDeps.loadManifest()), id);
			// Each version's status (from the receipt snapshot), when, and which verb produced it.
			const rows = revisions.map((r) => ({
				seq: r.seq,
				at: r.recordedAt,
				origin: r.origin,
				status: String((r.snapshot.fields as Record<string, unknown> | undefined)?.status ?? ""),
			}));
			return buildJsonSuccessEnvelope({
				command: "history",
				operation: "history",
				nextCommand: "wallet",
				nextCommands: ["wallet"],
				extra: {
					id,
					versions: revisions.length,
					timeline: rows,
					// The timeline as an accessible web <table> (renderTableHtml — the web twin of the TUI renderTable).
					html: renderTableHtml(
						[
							{ key: "seq", header: "Rev" },
							{ key: "at", header: "When" },
							{ key: "origin", header: "Verb" },
							{ key: "status", header: "Status" },
						],
						rows,
						{ caption: `Authorization ${id} — ${revisions.length} revision(s)` },
					),
				},
			});
		},
	};
}
