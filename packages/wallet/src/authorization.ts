import {
	buildJsonErrorEnvelope,
	buildJsonSuccessEnvelope,
	type CapabilityDescriptor,
	type CapabilityEnvelope,
	type CapabilityInput,
	type RecordsCommandDeps,
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
		let subject = "citizen-local";
		let issuer = "self-presented";
		let issuedAt = citizenAttributes().issuedAt;
		for (const record of verified) {
			const vc = recordToCredential(record);
			const subj = (vc?.credentialSubject ?? {}) as Record<string, unknown>;
			if (typeof subj.id === "string") subject = subj.id;
			if (typeof vc?.issuer === "string") issuer = vc.issuer;
			if (typeof vc?.issuanceDate === "string") issuedAt = vc.issuanceDate;
			for (const [key, value] of Object.entries(subj)) {
				if (key !== "id") attributes[key] = value;
			}
		}
		return { subject, issuer, issuedAt, attributes };
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
		args: [{ name: "requester", required: true }],
		options: [
			{ name: "purpose", kind: "string", summary: "Why the service needs the attributes" },
			{ name: "scope", kind: "string", summary: "Comma-separated attribute names to authorize" },
			{ name: "expires", kind: "string", summary: "When the authorization lapses (ISO 8601)" },
		],
		transports: { http: { path: "/wallet/authorize" } },
		renderers: { tui: { section: "wallet" } },
		async run(input: CapabilityInput): Promise<CapabilityEnvelope> {
			const requester = String(input.args.requester ?? "");
			const purpose = String(input.options?.purpose ?? "").trim();
			const scope = parseScope(input.options?.scope);
			const expiresAt = String(input.options?.expires ?? "").trim();
			if (!purpose || scope.length === 0 || !expiresAt) {
				return buildJsonErrorEnvelope({
					command: "authorize",
					operation: "authorize",
					error: "missing_consent_fields",
					message: "Authorization needs --purpose, --scope a,b and --expires <iso>.",
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
			await recordsDeps.saveManifest(mergeRecords(recordsDeps.loadManifest(), [record], now, "authorize"));
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
			const record = manifest.records.find((r) => r.id === id);
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
			return buildJsonSuccessEnvelope({
				command: "history",
				operation: "history",
				nextCommand: "wallet",
				nextCommands: ["wallet"],
				extra: {
					id,
					versions: revisions.length,
					// Each version's status (from the receipt snapshot), when, and which verb produced it.
					timeline: revisions.map((r) => ({
						seq: r.seq,
						at: r.recordedAt,
						origin: r.origin,
						status: String((r.snapshot.fields as Record<string, unknown> | undefined)?.status ?? ""),
					})),
				},
			});
		},
	};
}
