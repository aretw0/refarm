import {
	buildJsonErrorEnvelope,
	buildJsonSuccessEnvelope,
	type CapabilityDescriptor,
	type CapabilityEnvelope,
	type CapabilityInput,
	type RecordsCommandDeps,
} from "@refarm.dev/capability-host";
import {
	decodeCredentialQrPayload,
	type CredentialsProvider,
	type CredentialVerificationPolicy,
	type VerifiableCredential,
} from "@refarm.dev/credentials-contract-v1";
import type { IdentityProvider } from "@refarm.dev/identity-contract-v1";
import {
	computeRecordContentHash,
	type KnowledgeRecord,
	type RecordsManifest,
} from "@refarm.dev/records-contract-v1";
import { readFileSync } from "node:fs";

/**
 * The citizen's CREDENTIALS — the wallet's real work: IMPORT a Verifiable Credential (local-
 * first), VERIFY it for real, and SHARE only the ones they choose. refarm ships the credential
 * model + a real W3C verifier/presenter (@refarm.dev/credentials-contract-v1), the ingest/records
 * seam, and the review-state the UI renders; this only wires them for a wallet — the VC↔record
 * mapping and the three verbs.
 *
 * Import is local-first (read a file the citizen holds, no network). Verify is REAL — signature,
 * issuer trust, revocation, validity — not the review-state flip it replaces. Share is the
 * sovereignty move — a presentation the citizen signs, carrying only the credentials they pick.
 */

/** The record `@type` for an imported credential — a KnowledgeRecord that is also a wallet item
 * and a Verifiable Credential. */
const CREDENTIAL_TYPE = ["KnowledgeRecord", "WalletItem", "VerifiableCredential"];

/** Derive a stable record id from a credential. Prefer its own `id` (unique per VC); else key
 * by subject + specific type + issuanceDate, so two DIFFERENT credential types for the same
 * subject don't collide. Deterministic, so re-importing the same credential updates it. */
function credentialRecordId(vc: VerifiableCredential): string {
	const subject = typeof vc.credentialSubject?.id === "string" ? vc.credentialSubject.id : "";
	const specificType = vc.type.find((t) => t !== "VerifiableCredential") ?? "";
	const key = vc.id ?? `${subject}:${specificType}:${vc.issuer}:${vc.issuanceDate}`;
	return `record:cred-${String(key)
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")}`;
}

/** A short human title for a credential: its non-VerifiableCredential type, else the subject. */
function credentialTitle(vc: VerifiableCredential): string {
	const specificType = vc.type.find((t) => t !== "VerifiableCredential");
	if (specificType) return specificType;
	const subjectName = vc.credentialSubject?.name;
	return typeof subjectName === "string" ? subjectName : "Credencial";
}

/**
 * Map a Verifiable Credential to a wallet KnowledgeRecord. The raw VC is kept on
 * `fields.credential` so `verify` can re-read and re-check it exactly as issued. Imports land as
 * `draft` (unverified) — the citizen verifies to promote them.
 */
export function credentialToRecord(vc: VerifiableCredential, now: () => string): KnowledgeRecord {
	const record = {
		id: credentialRecordId(vc),
		schemaVersion: 1,
		"@type": CREDENTIAL_TYPE,
		"@context": "https://refarm.dev/contexts/records/v1",
		fields: {
			title: credentialTitle(vc),
			kind: "credencial",
			issuer: vc.issuer,
			...(vc.expirationDate ? { expirationDate: vc.expirationDate } : {}),
			// The raw VC, so verify re-checks the credential as issued (signature over the object).
			credential: vc as unknown as Record<string, unknown>,
		},
		sections: [{ key: "credential", content: JSON.stringify(vc, null, 2) }],
		review: { state: "draft", at: now() },
		contentHash: "",
	} as unknown as KnowledgeRecord;
	record.contentHash = computeRecordContentHash(record);
	return record;
}

/** Pull the raw Verifiable Credential back off an imported record (from `fields.credential`).
 * Returns null if the record has no credential (e.g. a plain document). */
export function recordToCredential(record: KnowledgeRecord): VerifiableCredential | null {
	const vc = (record.fields as { credential?: unknown }).credential;
	return vc && typeof vc === "object" ? (vc as VerifiableCredential) : null;
}

/** Merge records into a manifest by id (new added, existing replaced). */
export function mergeRecords(
	manifest: RecordsManifest,
	incoming: KnowledgeRecord[],
): RecordsManifest {
	const byId = new Map(manifest.records.map((r) => [r.id, r]));
	for (const record of incoming) byId.set(record.id, record);
	return { ...manifest, records: [...byId.values()] };
}

/** Parse a credential file's text into a VerifiableCredential. Throws on non-JSON or a shape
 * that isn't a VC (no issuer / credentialSubject). Local-first — the citizen holds the file. */
export function parseCredentialFile(text: string): VerifiableCredential {
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		throw new Error("INVALID_CREDENTIAL: not valid JSON");
	}
	if (!parsed || typeof parsed !== "object") {
		throw new Error("INVALID_CREDENTIAL: expected a JSON object");
	}
	const vc = parsed as Record<string, unknown>;
	if (typeof vc.issuer !== "string" || typeof vc.credentialSubject !== "object") {
		throw new Error(
			"INVALID_CREDENTIAL: not a Verifiable Credential (needs issuer + credentialSubject)",
		);
	}
	return vc as unknown as VerifiableCredential;
}

export interface WalletCredentialOptions {
	/** For a deterministic `review.at` in tests. Defaults to now. */
	now?: () => string;
}

/**
 * The wallet's DEFAULT verification policy — the honest floor for "verified".
 *
 * `validity: "required"` is universally safe: a credential with no expiry is never expired, so
 * this never rejects a legitimate credential, and it DOES catch an expired one (which a bare
 * signature check misses). Signature + issuer-signature-match are always enforced by the
 * provider regardless of policy.
 *
 * Revocation and issuer-trust are NOT in the default: they require the credential to carry a
 * resolvable status list and the deployment to pin trusted issuers — sensible for a real
 * civic wallet, but they would reject an arbitrary imported credential that lacks a status ref.
 * They are opt-in via `--strict` (see `strictWalletVerifyPolicy`).
 */
export const DEFAULT_WALLET_VERIFY_POLICY: CredentialVerificationPolicy = { validity: "required" };

/**
 * The STRICT policy a real civic wallet enforces: signature + validity + revocation + issuer
 * trust. `trustedIssuers` is the TRUST REGISTRY — the allow-list of civic issuers the deployment
 * accepts. When the deployment pins one (via the bundle's `verifyPolicy`), a validly-signed
 * credential from an issuer OUTSIDE it is REJECTED (the anti-fraud point of a registry). When NO
 * registry is configured, the wallet self-trusts the credential's own issuer — an OFFLINE default
 * that proves the wire without a registry, NOT a real trust decision; a deployment always pins a
 * real list. (So issuer-trust only ever REJECTS when a registry is configured — as it must.)
 */
export function strictWalletVerifyPolicy(
	base: CredentialVerificationPolicy,
	credentialIssuer: string,
): CredentialVerificationPolicy {
	return {
		...base,
		validity: "required",
		revocation: "required",
		trustedIssuers: base.trustedIssuers ?? [credentialIssuer],
	};
}

/**
 * `import <file>` — import a Verifiable Credential from a file into the wallet, local-first.
 * Reads the file, maps it to a wallet record (draft), merges into the manifest, and persists.
 */
export function createWalletImportCapability(
	recordsDeps: RecordsCommandDeps,
	options: WalletCredentialOptions = {},
): CapabilityDescriptor {
	const now = options.now ?? (() => new Date().toISOString());
	return {
		name: "import",
		summary: "Import a credential into your wallet (local-first) — a JSON file or a QR payload",
		args: [{ name: "file", required: true }],
		options: [
			{ name: "qr", kind: "boolean", summary: "Treat the file's content as a QR payload (raw/base64url/offer-url)" },
		],
		transports: { http: { path: "/wallet/import" } },
		renderers: { tui: { section: "wallet" } },
		async run(input: CapabilityInput): Promise<CapabilityEnvelope> {
			const file = String(input.args.file ?? "");
			const isQr = input.options?.qr === true;
			if (!file) {
				return buildJsonErrorEnvelope({
					command: "import",
					operation: "import",
					error: "no_file",
					message: "Pass a credential file to import.",
					nextAction: "import <file.json>",
				});
			}
			let vc: VerifiableCredential;
			try {
				const content = readFileSync(file, "utf-8");
				if (isQr) {
					// The file holds a QR's text payload (raw VC JSON, base64url, or an offer URL) —
					// the substrate decodes it. Scanning the IMAGE to text is the injected seam (a
					// browser BarcodeDetector); here the citizen already has the decoded payload.
					const decoded = decodeCredentialQrPayload(content.trim());
					if (!decoded.ok || !decoded.credential) {
						throw new Error(`INVALID_QR: ${decoded.error ?? "could not decode a credential"}`);
					}
					vc = decoded.credential;
				} else {
					vc = parseCredentialFile(content);
				}
			} catch (error) {
				return buildJsonErrorEnvelope({
					command: "import",
					operation: "import",
					error: "invalid_credential",
					message: error instanceof Error ? error.message : String(error),
					nextAction: isQr ? "Check the QR payload carries a Verifiable Credential." : "Check the file is a JSON Verifiable Credential.",
				});
			}

			const record = credentialToRecord(vc, now);
			if (!recordsDeps.saveManifest) {
				return buildJsonSuccessEnvelope({
					command: "import",
					operation: "import",
					nextCommand: `verify ${record.id}`,
					extra: { id: record.id, title: record.fields.title, persisted: false, dryRun: true },
				});
			}
			const merged = mergeRecords(recordsDeps.loadManifest(), [record]);
			await recordsDeps.saveManifest(merged);
			return buildJsonSuccessEnvelope({
				command: "import",
				operation: "import",
				nextCommand: `verify ${record.id}`,
				nextCommands: [`verify ${record.id}`, "wallet"],
				extra: {
					id: record.id,
					title: record.fields.title,
					issuer: vc.issuer,
					state: "draft",
					persisted: true,
					total: merged.records.length,
				},
			});
		},
	};
}

/**
 * `verify <id>` — VERIFY an imported credential for real (signature, issuer, revocation,
 * validity) via the substrate's W3C verifier, and — only if valid — promote it to `verified`
 * (the state the wallet shows). On failure it reports the checks that failed and does NOT
 * promote. This replaces the old fake "verify" (a bare review-state flip).
 */
export function createWalletVerifyCapability(
	recordsDeps: RecordsCommandDeps,
	provider: CredentialsProvider,
	options: WalletCredentialOptions & { policy?: CredentialVerificationPolicy } = {},
): CapabilityDescriptor {
	const now = options.now ?? (() => new Date().toISOString());
	// The policy the wallet actually enforces (was previously undefined → signature-only). The
	// default requires validity; `--strict` additionally requires revocation + issuer trust.
	const basePolicy = options.policy ?? DEFAULT_WALLET_VERIFY_POLICY;
	return {
		name: "verify",
		summary:
			"Verify a wallet credential for real (signature + validity; --strict adds revocation + issuer trust)",
		args: [{ name: "id", required: true }],
		options: [
			{
				name: "strict",
				kind: "boolean",
				summary: "Enforce revocation status + issuer trust, not just signature + validity",
			},
		],
		transports: { http: { path: "/wallet/verify" } },
		renderers: { tui: { section: "wallet" } },
		async run(input: CapabilityInput): Promise<CapabilityEnvelope> {
			const id = String(input.args.id ?? "");
			const manifest = recordsDeps.loadManifest();
			const record = manifest.records.find((r) => r.id === id);
			if (!record) {
				return buildJsonErrorEnvelope({
					command: "verify",
					operation: "verify",
					error: "not_found",
					message: `No wallet item "${id}".`,
					nextAction: "wallet",
				});
			}
			const vc = recordToCredential(record);
			if (!vc) {
				return buildJsonErrorEnvelope({
					command: "verify",
					operation: "verify",
					error: "not_a_credential",
					message: `"${id}" is not a Verifiable Credential (nothing to verify).`,
					nextAction: "Import a credential with `import <file>` first.",
				});
			}

			// Enforce the real policy — revocation/validity/issuer-trust are evaluated by the
			// substrate ONLY when the policy asks for them. `--strict` raises the bar for a real
			// civic wallet; the default already lifts verify above a bare signature check.
			const strict = input.options?.strict === true;
			const policy = strict ? strictWalletVerifyPolicy(basePolicy, vc.issuer) : basePolicy;
			const result = await provider.verify(vc, policy);
			if (!result.valid) {
				return buildJsonErrorEnvelope({
					command: "verify",
					operation: "verify",
					error: "verification_failed",
					message: `Credential "${id}" failed verification: ${result.failures.join("; ")}`,
					nextAction: "This credential is not trustworthy — do not rely on it.",
					extra: { id, valid: false, checks: result.checks, failures: result.failures },
				});
			}

			// The checks that actually ran (policy-gated), so the notes/envelope don't overclaim.
			const enforced = Object.keys(result.checks).filter(
				(k) => (result.checks as Record<string, { ok?: boolean }>)[k]?.ok === true,
			);
			// Verified for real → promote to the state the wallet shows, recording the checks.
			const verified: KnowledgeRecord = {
				...record,
				review: { state: "verified", at: now(), notes: `verified: ${enforced.join(", ")}` },
			} as KnowledgeRecord;
			verified.contentHash = computeRecordContentHash(verified);

			if (!recordsDeps.saveManifest) {
				return buildJsonSuccessEnvelope({
					command: "verify",
					operation: "verify",
					extra: { id, valid: true, checks: result.checks, enforced, strict, persisted: false, dryRun: true },
				});
			}
			await recordsDeps.saveManifest(mergeRecords(manifest, [verified]));
			return buildJsonSuccessEnvelope({
				command: "verify",
				operation: "verify",
				nextCommand: "wallet",
				nextCommands: ["wallet"],
				extra: { id, valid: true, state: "verified", checks: result.checks, enforced, strict, issuer: result.issuer },
			});
		},
	};
}

/** Parse `share`'s ids arg — one id, or several as `a,b,c` or repeated tokens. */
function parseShareIds(raw: unknown): string[] {
	if (Array.isArray(raw))
		return raw
			.flatMap((v) => String(v).split(","))
			.map((s) => s.trim())
			.filter(Boolean);
	return String(raw ?? "")
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean);
}

export interface WalletShareOptions {
	/** The holder identity the citizen presents AS — created on demand if absent. Injected so a
	 * real deployment binds it to the citizen's persistent key. */
	holderIdentityId?: string;
}

/**
 * `share <ids…>` — the sovereignty move: the citizen COMPARTILHA only the credentials they
 * choose, as a Verifiable Presentation SIGNED BY THEM. This is "compartilhe apenas o
 * estritamente necessário" at the credential level — the citizen picks which credentials go
 * into the presentation; nothing else is disclosed. The receiving party can then verify the
 * presentation (each credential is genuine AND the holder who presents is who signed it).
 *
 * Selective disclosure of individual FIELDS (SD-JWT/BBS+) is not in the substrate's VC model
 * yet, so selection is per-credential — honest, and already the private-by-default share.
 */
export function createWalletShareCapability(
	recordsDeps: RecordsCommandDeps,
	provider: CredentialsProvider,
	identity: IdentityProvider,
	options: WalletShareOptions = {},
): CapabilityDescriptor {
	return {
		name: "share",
		summary: "Share only the credentials you choose, as a presentation signed by you",
		args: [{ name: "ids", required: true }],
		transports: { http: { path: "/wallet/share" } },
		renderers: { tui: { section: "wallet" } },
		async run(input: CapabilityInput): Promise<CapabilityEnvelope> {
			const ids = parseShareIds(input.args.ids);
			if (ids.length === 0) {
				return buildJsonErrorEnvelope({
					command: "share",
					operation: "share",
					error: "no_ids",
					message: "Pass the credential id(s) to share (e.g. share record:cred-a,record:cred-b).",
					nextAction: "wallet",
				});
			}

			const manifest = recordsDeps.loadManifest();
			const credentials: VerifiableCredential[] = [];
			const missing: string[] = [];
			for (const id of ids) {
				const record = manifest.records.find((r) => r.id === id);
				const vc = record ? recordToCredential(record) : null;
				if (vc) credentials.push(vc);
				else missing.push(id);
			}
			if (missing.length > 0) {
				return buildJsonErrorEnvelope({
					command: "share",
					operation: "share",
					error: "not_a_credential",
					message: `Not shareable credentials: ${missing.join(", ")} (import a credential first).`,
					nextAction: "wallet",
				});
			}

			// The citizen is the HOLDER — presenting AS themselves. Create/reuse their identity so
			// the presentation is signed by them (holder-binding a verifier can check).
			const holderId = options.holderIdentityId ?? (await identity.create("Cidadão (holder)")).id;
			const presentation = await provider.present(credentials, holderId);

			return buildJsonSuccessEnvelope({
				command: "share",
				operation: "share",
				nextCommand: "wallet",
				extra: {
					shared: ids,
					holder: holderId,
					// The signed presentation — hand this to the receiving party; they verify it.
					presentation,
					count: credentials.length,
				},
			});
		},
	};
}
