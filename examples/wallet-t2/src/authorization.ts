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
	ServiceRequest,
} from "@refarm.dev/authorization-contract-v1";
import {
	computeRecordContentHash,
	type KnowledgeRecord,
	type RecordsManifest,
} from "@refarm.dev/records-contract-v1";

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

/** The citizen's held attributes — the source a presentation discloses FROM. Out of the box
 * a small synthetic set (the wallet is a demo); a deployment binds this to the citizen's
 * verified credentials. */
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

function mergeRecords(manifest: RecordsManifest, updates: KnowledgeRecord[]): RecordsManifest {
	const byId = new Map(manifest.records.map((r) => [r.id, r]));
	for (const record of updates) byId.set(record.id, record);
	return { ...manifest, records: [...byId.values()] };
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
			await recordsDeps.saveManifest(mergeRecords(recordsDeps.loadManifest(), [record]));
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

			if (!recordsDeps.saveManifest) {
				return buildJsonSuccessEnvelope({
					command: "revoke",
					operation: "revoke",
					extra: { id, event, persisted: false, dryRun: true },
				});
			}
			await recordsDeps.saveManifest(mergeRecords(manifest, [revokedRecord]));
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
