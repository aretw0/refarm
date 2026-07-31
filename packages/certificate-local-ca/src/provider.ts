import { randomBytes, X509Certificate } from "node:crypto";
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
	assertShortLeafLifetime,
	CertificateRefusal,
	DEFAULT_CA_LIFETIME_DAYS,
	type CertificateIssueRequest,
	type CertificateMaterial,
	type CertificateProvider,
	type CertificateProviderReadiness,
} from "@refarm.dev/certificate-contract-v1";

import {
	assertNamesUnderSuffixes,
	caConfigFile,
	certificateFileStem,
	leafConfigFile,
	normalizeNameSuffixes,
} from "./extensions.js";
import {
	createNodeOpensslRunner,
	detectOpenssl,
	OPENSSL_MISSING_FIX,
	redactPrivateKeys,
	type OpensslResult,
	type OpensslRunner,
} from "./openssl.js";

/**
 * `local-ca` — the CANONICAL certificate provider (T1).
 *
 * It depends on nothing outside the machine, works on any network, and is available to an operator
 * who has never heard of Tailscale. It also happens to be the path that needs no privilege: it asks
 * for no root and no standing `tailscale set --operator=$USER` grant, so its renewal can be
 * supervised by an ordinary process (T3).
 *
 * ── THE FOUR BOUNDS, AND WHERE EACH ONE LIVES ────────────────────────────────────
 *
 *  1. `nameConstraints` on the CA — `extensions.ts`, plus refarm's own refusal at issuance, which
 *     holds even where a device's trust store ignores the extension.
 *  2. short-lived leaves — `assertShortLeafLifetime`, in the contract, so no provider re-decides it.
 *  3. **the CA private key never leaves this node**, mode 0600 — here. It is produced by openssl,
 *     written to a path we chose, and never read back into a value. There is no variable in this
 *     package that holds it, which is why "never logged" is a property of the shape rather than of
 *     anyone's discipline. Everything crossing the boundary out of here also passes through
 *     {@link redactPrivateKeys}.
 *  4. rotation as an operation — `needsRotation` in the contract, and `issue` is idempotent, so
 *     renewing is running the same command again.
 *
 * ── THE ONE LOOSE END NO DESIGN REMOVES ──────────────────────────────────────────
 *
 * **CA trust is device-local and cannot be revoked remotely.** Once a device trusts this CA,
 * removing that trust means going into THAT device's settings. Nothing here — not rotation, not a
 * shorter leaf, not deleting the key — reaches into a phone and takes it back. That is precisely
 * why the name constraint matters, and it is stated in the consent request the operator reads
 * before any device is changed (`trust.ts`).
 */

export const LOCAL_CA_PROVIDER_ID = "local-ca";

export interface LocalCaOptions {
	/**
	 * Where the CA and its leaves live. The CA private key never leaves this directory — no copy,
	 * no export, no second node. A new node gets a CERTIFICATE from here, never the key.
	 */
	dir: string;
	/** The operator's own DNS suffixes — the ceiling on everything this CA may ever vouch for. */
	nameSuffixes: readonly string[];
	/** A human label for the CA, carried into its subject CN. */
	caName?: string;
	/** Injected so the whole provider is testable without a real openssl. */
	openssl?: OpensslRunner;
	/** Injected clock — no ambient `new Date()`. */
	now?: () => Date;
	/** How long the CA itself lives. Long on purpose: an expiring CA is an N×M re-install. */
	caLifetimeDays?: number;
	/**
	 * Where diagnostics go. Everything written here has already passed through
	 * {@link redactPrivateKeys}; nothing in this package ever holds key material to begin with.
	 */
	log?: (line: string) => void;
}

/** What `ensureCa` produced or found — public facts only. */
export interface LocalCaHandle {
	certFile: string;
	/** The PATH of the private key. Safe to print; never read into a value. */
	keyFile: string;
	/** SHA-256 fingerprint of the CA certificate — what an operator compares on a device. */
	fingerprint: string;
	nameSuffixes: string[];
	subject: string;
	notAfter: string;
	/** `true` when this call created it, `false` when it was already there. */
	created: boolean;
}

interface CaMetadata {
	caName: string;
	nameSuffixes: string[];
	createdAt: string;
}

const CA_CERT = "ca.crt";
const CA_KEY = "ca.key";
const CA_META = "ca.json";

function failed(step: string, result: OpensslResult): CertificateRefusal {
	const detail = redactPrivateKeys((result.stderr || result.stdout).trim()).slice(0, 800);
	return new CertificateRefusal(
		"issuance-failed",
		`local-ca: openssl failed while ${step} (exit ${result.code})${detail ? `\n${detail}` : ""}`,
		"Run the same step by hand to see the whole error, or declare a certificate you already " +
			"have (`certFile`/`keyFile`) and skip issuance entirely.",
	);
}

/** A CN openssl will accept in a `-subj` argument. PURE. */
export function subjectCommonName(label: string): string {
	const cleaned = label.replace(/[/=\n\r]+/g, " ").trim();
	return (cleaned || "refarm").slice(0, 64);
}

export interface LocalCaProvider extends CertificateProvider {
	/** Create the CA if it is not there; return it either way. Idempotent. */
	ensureCa(): Promise<LocalCaHandle>;
	/** The CA certificate's path — the file an operator installs on a device. */
	readonly caCertFile: string;
	/** The CA private key's path. It never leaves this node. */
	readonly caKeyFile: string;
	readonly nameSuffixes: string[];
}

export function createLocalCaProvider(options: LocalCaOptions): LocalCaProvider {
	const run = options.openssl ?? createNodeOpensslRunner();
	const now = options.now ?? (() => new Date());
	const nameSuffixes = normalizeNameSuffixes(options.nameSuffixes);
	const caName = options.caName ?? "refarm";
	const caLifetimeDays = options.caLifetimeDays ?? DEFAULT_CA_LIFETIME_DAYS;
	const log = options.log ?? (() => {});
	const caCertFile = join(options.dir, CA_CERT);
	const caKeyFile = join(options.dir, CA_KEY);
	const caMetaFile = join(options.dir, CA_META);

	function say(line: string): void {
		// Redacted on the way out, unconditionally. Nothing here should ever contain a key; the
		// filter is what makes that a guarantee rather than a belief about openssl's output.
		log(redactPrivateKeys(line));
	}

	async function exists(path: string): Promise<boolean> {
		try {
			await readFile(path);
			return true;
		} catch {
			return false;
		}
	}

	async function readCa(): Promise<X509Certificate> {
		return new X509Certificate(await readFile(caCertFile));
	}

	async function ensureCa(): Promise<LocalCaHandle> {
		if (nameSuffixes.length === 0) {
			throw new CertificateRefusal(
				"name-refused",
				"local-ca: a CA with no name constraint would be a CA that can vouch for anything",
				'Give at least one suffix — the node\'s own hostname is enough (e.g. ["my-node"]).',
			);
		}
		await mkdir(options.dir, { recursive: true, mode: 0o700 });
		await chmod(options.dir, 0o700).catch(() => {});

		if ((await exists(caCertFile)) && (await exists(caKeyFile))) {
			const meta = await readMetadata();
			if (meta && meta.nameSuffixes.join(",") !== nameSuffixes.join(",")) {
				throw new CertificateRefusal(
					"name-refused",
					`local-ca: the CA in ${options.dir} is constrained to ${meta.nameSuffixes.join(", ")}, ` +
						`but ${nameSuffixes.join(", ")} was asked for — widening a CA's constraint in place ` +
						"would silently change what every device that already trusts it will accept",
					"Point at a different directory for the new suffix, or rotate deliberately: remove " +
						`${options.dir}, re-issue, and re-trust the new CA on each device (the old one ` +
						"stays trusted on those devices until you remove it there — CA trust is device-local).",
				);
			}
			const cert = await readCa();
			return {
				certFile: caCertFile,
				keyFile: caKeyFile,
				fingerprint: cert.fingerprint256,
				nameSuffixes,
				subject: cert.subject,
				notAfter: new Date(cert.validTo).toISOString(),
				created: false,
			};
		}

		const configFile = join(options.dir, "ca.cnf");
		await writeFile(configFile, caConfigFile(nameSuffixes), { mode: 0o600 });
		say(`local-ca: creating the operator CA in ${options.dir}`);

		const key = await run(["genrsa", "-out", caKeyFile, "2048"]);
		if (key.code !== 0) throw failed("generating the CA key", key);
		// Before the certificate, so the key is never readable by anyone else even for the moment
		// it takes to sign with it.
		await chmod(caKeyFile, 0o600);

		const cert = await run([
			"req",
			"-x509",
			"-new",
			"-key",
			caKeyFile,
			"-sha256",
			"-days",
			String(caLifetimeDays),
			"-out",
			caCertFile,
			"-subj",
			`/CN=${subjectCommonName(`${caName} local CA`)}`,
			"-config",
			configFile,
			"-extensions",
			"v3_ca",
		]);
		if (cert.code !== 0) {
			// Do not leave a key behind for a CA that does not exist.
			await rm(caKeyFile, { force: true });
			throw failed("creating the CA certificate", cert);
		}
		await chmod(caCertFile, 0o644).catch(() => {});
		const metadata: CaMetadata = {
			caName,
			nameSuffixes,
			createdAt: now().toISOString(),
		};
		await writeFile(caMetaFile, `${JSON.stringify(metadata, null, 2)}\n`);

		const parsed = await readCa();
		say(`local-ca: CA ready — sha256 ${parsed.fingerprint256}`);
		return {
			certFile: caCertFile,
			keyFile: caKeyFile,
			fingerprint: parsed.fingerprint256,
			nameSuffixes,
			subject: parsed.subject,
			notAfter: new Date(parsed.validTo).toISOString(),
			created: true,
		};
	}

	async function readMetadata(): Promise<CaMetadata | null> {
		try {
			const parsed = JSON.parse(await readFile(caMetaFile, "utf8")) as Partial<CaMetadata>;
			return Array.isArray(parsed.nameSuffixes)
				? {
						caName: typeof parsed.caName === "string" ? parsed.caName : caName,
						nameSuffixes: parsed.nameSuffixes,
						createdAt: typeof parsed.createdAt === "string" ? parsed.createdAt : "",
					}
				: null;
		} catch {
			return null;
		}
	}

	async function preflight(): Promise<CertificateProviderReadiness> {
		const presence = await detectOpenssl(run);
		if (!presence.present) {
			return {
				ready: false,
				reason: "tool-missing",
				detail:
					`local-ca: ${presence.detail}. Node cannot mint an X.509 certificate on its own — ` +
					"`node:crypto`'s X509Certificate parses one, it does not issue one — so this provider " +
					"needs openssl and will not pretend otherwise.",
				fix: OPENSSL_MISSING_FIX,
			};
		}
		return { ready: true, detail: presence.version };
	}

	async function issue(request: CertificateIssueRequest): Promise<CertificateMaterial> {
		const readiness = await preflight();
		if (!readiness.ready) {
			throw new CertificateRefusal(readiness.reason, readiness.detail, readiness.fix);
		}
		const lifetimeDays = assertShortLeafLifetime(request.lifetimeDays);
		// The constraint enforced HERE, before openssl is called — the half of the bound that does
		// not depend on any device's trust store honouring `nameConstraints`.
		const names = assertNamesUnderSuffixes(request.names, nameSuffixes);
		const ca = await ensureCa();

		const stem = certificateFileStem(names[0] as string);
		const keyFile = join(options.dir, `${stem}.key`);
		const certFile = join(options.dir, `${stem}.crt`);
		const csrFile = join(options.dir, `${stem}.csr`);
		const configFile = join(options.dir, `${stem}.cnf`);
		await writeFile(configFile, leafConfigFile(names), { mode: 0o600 });

		const key = await run(["genrsa", "-out", keyFile, "2048"]);
		if (key.code !== 0) throw failed("generating the leaf key", key);
		await chmod(keyFile, 0o600);

		const csr = await run([
			"req",
			"-new",
			"-key",
			keyFile,
			"-out",
			csrFile,
			"-subj",
			`/CN=${subjectCommonName(names[0] as string)}`,
			"-config",
			configFile,
		]);
		if (csr.code !== 0) throw failed("building the certificate request", csr);

		const signed = await run([
			"x509",
			"-req",
			"-in",
			csrFile,
			"-CA",
			ca.certFile,
			"-CAkey",
			ca.keyFile,
			"-set_serial",
			`0x${randomBytes(16).toString("hex")}`,
			"-days",
			String(lifetimeDays),
			"-sha256",
			"-out",
			certFile,
			"-extfile",
			configFile,
			"-extensions",
			"v3_leaf",
		]);
		if (signed.code !== 0) throw failed("signing the certificate", signed);
		await rm(csrFile, { force: true });

		const parsed = new X509Certificate(await readFile(certFile));
		say(`local-ca: issued ${certFile} for ${names.join(", ")}, valid until ${parsed.validTo}`);
		return {
			certFile,
			keyFile,
			caFile: ca.certFile,
			names,
			notBefore: new Date(parsed.validFrom).toISOString(),
			notAfter: new Date(parsed.validTo).toISOString(),
			providerId: LOCAL_CA_PROVIDER_ID,
		};
	}

	return {
		id: LOCAL_CA_PROVIDER_ID,
		title: "A certificate issued by the operator's own certificate authority, on this machine",
		requires: [
			"openssl on PATH (present on essentially every Linux, macOS and WSL install)",
			"nothing else — no network, no account, no root, no standing privilege grant",
		],
		costs: [
			"the CA must be installed once on each device that will open the page",
			"CA trust is device-local and CANNOT be revoked remotely — undoing it means going into " +
				"that device's settings",
			"no external exposure: nothing about this node enters a public log",
		],
		preflight,
		issue,
		ensureCa,
		caCertFile,
		caKeyFile,
		nameSuffixes,
	};
}
