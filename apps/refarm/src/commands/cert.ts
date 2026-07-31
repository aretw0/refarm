import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
	CertificateRefusal,
	createCertificateProviderRegistry,
	DEFAULT_LEAF_LIFETIME_DAYS,
	needsRotation,
	resolveCertificate,
	type CertificateDeclaration,
	type CertificateMaterial,
	type CertificateProviderRegistry,
} from "@refarm.dev/certificate-contract-v1";
import {
	buildCaTrustRequest,
	buildNssCaTrustRequest,
	certutilCommandLine,
	certutilDeleteArgs,
	CERTUTIL_MISSING_FIX,
	chromiumNssDir,
	createLocalCaProvider,
	createNodeCertutilRunner,
	createNssOperationFileSystem,
	describeCaGrant,
	describeNssStoreReach,
	detectCertutil,
	discoverNssStores,
	firefoxProfileRoots,
	LINUX_CA_REFRESH_COMMAND,
	linuxCaAnchorPath,
	nssEntryPath,
	readLocalCaNameSuffixes,
	type CertutilRunner,
	type LocalCaProvider,
	type NssStore,
} from "@refarm.dev/certificate-local-ca";
import {
	createFileOperationTrail,
	renderOperationRequest,
	runOperationConsent,
	type OperationConsentChannel,
	type OperationOutcome,
	type OperationTrail,
} from "@refarm.dev/operation-consent-v1";
import { buildJsonErrorEnvelope, printJson } from "@refarm.dev/capabilities/envelope";
import { createStdioOperatorChannel } from "@refarm.dev/prompt-contract-v1";
import chalk from "chalk";
import { Command } from "commander";

import { refarmCommand, refarmPrivilegedCommand } from "../brand.js";

/**
 * `refarm cert` — the operator's side of sovereign TLS.
 *
 * WHY THIS COMMAND EXISTS AT ALL. `/attend` and `/auth/verify` call `crypto.subtle`, and
 * `crypto.subtle` refuses to exist outside a secure context. `http://<tailnet-name>:4321` is not
 * one — only https and `http://localhost` are — so the browser surface that shipped could not
 * work, on any device, and no test caught it because no browser was ever opened. This is the door.
 *
 * THREE SUBCOMMANDS, ONE FOR EACH THING THE OPERATOR ACTUALLY DECIDES:
 *
 *  - `providers` — what can issue a certificate here, what each needs, and what each COSTS. T3's
 *    table, printed rather than buried in a design document, because the choice between "install a
 *    CA on each device" and "this hostname enters public Certificate Transparency logs, forever" is
 *    not one refarm should make on the operator's behalf.
 *  - `issue` — get a certificate. Canonically from the operator's own CA (`local-ca`), which needs
 *    no network, no account, no root and no standing privilege grant.
 *  - `trust` — install that CA in a trust store. A SIGNIFICANT GRANT, carried through
 *    `@refarm.dev/operation-consent-v1` so it is proposed as an exact diff, decided by the human,
 *    and remembered with an undo that executes.
 *
 * T2's third case needs no subcommand and that is the point: an operator who already HAS a
 * certificate passes `--cert-file`/`--key-file` and no provider runs at all.
 *
 * ── WHY `trust` HAS TWO SCOPES, AND WHY THE SMALLER ONE IS THE DEFAULT ───────────
 *
 * `trust` asked for root because it wrote into `/usr/local/share/ca-certificates`. That was the
 * largest grant available, and the goal it was serving — open this page in a browser — needs the
 * SMALLEST: on Linux, Chrome and Firefox each keep their own NSS database in the operator's own
 * home, and adding a CA there needs no privilege at all. Asking for root to achieve something that
 * root was never required for is the defect, not the missing `sudo`.
 *
 * So the scope is explicit and the default is the small one:
 *
 *  - `refarm cert trust` (= `trust browser`) — this user's own browser stores. No root, no
 *    `update-ca-certificates`, nothing outside `$HOME`. Reaches every Chromium-family browser and
 *    each Firefox profile that is authorised individually.
 *  - `refarm cert trust system` — `/usr/local/share/ca-certificates` + `update-ca-certificates`.
 *    Reaches `curl`, `node`, `git` and every system tool, and every user on the machine. Needs
 *    root, and says so.
 *
 * NEITHER SCOPE ESCALATES INTO THE OTHER. A machine with no browser store gets a refusal that
 * names the system scope as the operator's choice — never a silent `sudo`. A machine with browser
 * stores is never told the system store is required, because for the browser it is not: the two
 * are different reaches, and the request states each one's.
 */

/** The handoffs this command hands on. Built through the brand helper (ADR-087) rather than
 *  written as literals, so the binary is named in exactly one place.
 *
 * ONLY `cert trust system` IS DECLARED PRIVILEGED (`src/privileged-steps.ts`): it is the one that
 * writes into `/usr/local/share/ca-certificates`, which belongs to root. Its handoffs go through
 * `refarmPrivilegedCommand`, which names the interpreter and the entrypoint by absolute path —
 * the bare `refarm cert trust` this used to print was correct in the operator's shell and
 * UNRUNNABLE the moment `sudo` went in front of it, because `sudo` replaces PATH with
 * `secure_path`, which omits `~/.local/bin`.
 *
 * The DEFAULT handoff is deliberately the bare, unprivileged one. Emitting the absolute
 * interpreter path for a step that needs no root would carry the whole cost of privilege — the
 * unreadable command, the `sudo` prompt — to buy nothing. */
const CERT_ISSUE_COMMAND = refarmCommand(["cert", "issue", "--json"]);
const CERT_TRUST_COMMAND = refarmCommand(["cert", "trust", "--json"]);
const CERT_TRUST_PLAIN_COMMAND = `  ${refarmCommand(["cert", "trust"])}`;
/** Named ONLY where the larger grant is genuinely the operator's choice — a refusal that explains
 *  why the small scope could not serve them. Deliberately absent from every `nextCommands` menu: a
 *  machine following a handoff list must not be able to pick `sudo` off it by accident. */
const CERT_TRUST_SYSTEM_PLAIN_COMMAND = refarmPrivilegedCommand(["cert", "trust", "system"]);
const CERT_HELP_COMMAND = refarmCommand(["cert", "--help"]);

/** Where this node keeps its CA and the certificates it has issued. */
export function resolveTlsDir(root: string = process.cwd()): string {
	return path.resolve(root, ".refarm", "tls");
}

/** Where the trail of trust decisions lives — beside the CA they are about. */
export function resolveCertTrailPath(root: string = process.cwd()): string {
	return path.join(resolveTlsDir(root), "operations.json");
}

/**
 * The names this node answers to, when there is nothing else to go on.
 *
 * Just the hostname. NOT a guess at a tailnet suffix: `expose: "tailnet"` is resolved at bind time
 * by asking Tailscale, and inventing a suffix here would put a name in a certificate that nothing
 * verified. The operator passes `--suffix` when their names live under something wider.
 *
 * This is the FLOOR, not the whole story — see {@link resolveNameSuffixes}, which prefers an
 * EXISTING CA's own constraint over this guess, because that constraint is already known rather
 * than invented.
 */
export function defaultNameSuffixes(hostname: string = os.hostname()): string[] {
	const trimmed = hostname.trim().toLowerCase();
	return trimmed ? [trimmed] : [];
}

/**
 * What suffix this CA's directory should be built with — explicit, then the CA THAT IS ALREADY
 * THERE, then the hostname guess.
 *
 * `refarm cert trust` used to skip straight from "no `--suffix`" to the hostname guess, so an
 * operator whose CA already carried a wider constraint (a tailnet suffix, issued earlier under
 * `--suffix`) got refused for asking to narrow it — `ensureCa` correctly refuses a mismatch, but
 * nothing should have asked for the mismatch in the first place. The constraint an existing CA
 * carries is a FACT on this machine (`ca.json`, beside the CA itself), not a guess, so it outranks
 * the hostname floor. An explicit `--suffix` still outranks both — and if it conflicts with a CA
 * that already exists, `ensureCa` still refuses exactly as before: this only changes what happens
 * with NO `--suffix` at all.
 */
export async function resolveNameSuffixes(input: {
	dir: string;
	suffix?: string[];
	hostname: string;
}): Promise<string[]> {
	if (input.suffix?.length) return input.suffix;
	const existing = await readLocalCaNameSuffixes(input.dir);
	return existing ?? defaultNameSuffixes(input.hostname);
}

export interface CertDeps {
	root?: string;
	registry?: CertificateProviderRegistry;
	localCa?: LocalCaProvider;
	trail?: OperationTrail;
	operator?: OperationConsentChannel | null;
	now?: () => string;
	say?: (line: string) => void;
	hostname?: string;
	/** The certutil seam. Injected in tests so a suite drives a throwaway database and never the
	 *  operator's own. */
	certutil?: CertutilRunner;
	/** The NSS stores to consider, when the caller has already measured them. */
	stores?: readonly NssStore[];
	/** Whose stores — `os.homedir()` unless a test says otherwise. */
	home?: string;
}

/** Build the registry for this node. One line per provider, exactly as T2 asks — `tailscale cert`
 *  is the second line, when it arrives, and it changes nothing here. */
export function buildCertificateRegistry(options: {
	dir: string;
	nameSuffixes: readonly string[];
	log?: (line: string) => void;
}): { registry: CertificateProviderRegistry; localCa: LocalCaProvider } {
	const localCa = createLocalCaProvider({
		dir: options.dir,
		nameSuffixes: options.nameSuffixes,
		caName: "refarm",
		...(options.log ? { log: options.log } : {}),
	});
	return { registry: createCertificateProviderRegistry([localCa]), localCa };
}

// ── providers ─────────────────────────────────────────────────────────────────

export interface CertProviderReport {
	id: string;
	title: string;
	requires: string[];
	costs: string[];
	ready: boolean;
	detail: string;
	fix?: string;
}

export async function runCertProviders(deps: CertDeps = {}): Promise<{
	ok: boolean;
	providers: CertProviderReport[];
	declaredCertificateIsAlwaysAvailable: true;
	nextCommand: string;
	nextCommands: string[];
}> {
	const root = deps.root ?? process.cwd();
	const registry =
		deps.registry ??
		buildCertificateRegistry({
			dir: resolveTlsDir(root),
			nameSuffixes: defaultNameSuffixes(deps.hostname),
		}).registry;
	const providers: CertProviderReport[] = [];
	for (const provider of registry.list()) {
		const readiness = await provider.preflight();
		providers.push({
			id: provider.id,
			title: provider.title,
			requires: [...provider.requires],
			costs: [...provider.costs],
			ready: readiness.ready,
			detail: readiness.detail,
			...(readiness.ready ? {} : { fix: readiness.fix }),
		});
	}
	return {
		ok: true,
		providers,
		// Stated in the OUTPUT, not only in a design document: an operator with a certificate of
		// their own needs none of these.
		declaredCertificateIsAlwaysAvailable: true,
		nextCommand: CERT_ISSUE_COMMAND,
		nextCommands: [CERT_ISSUE_COMMAND, CERT_TRUST_COMMAND],
	};
}

// ── issue ─────────────────────────────────────────────────────────────────────

export interface CertIssueOptions {
	provider?: string;
	name?: string[];
	suffix?: string[];
	days?: number;
	dir?: string;
	/** T2's third case: a certificate the operator already has. No provider runs. */
	certFile?: string;
	keyFile?: string;
	caFile?: string;
}

export interface CertIssueResult {
	ok: true;
	certificate: CertificateMaterial;
	caFile: string | null;
	needsRotation: boolean;
	serveCommand: string;
	nextCommand: string;
	nextCommands: string[];
}

export async function runCertIssue(
	options: CertIssueOptions,
	deps: CertDeps = {},
): Promise<CertIssueResult> {
	const root = deps.root ?? process.cwd();
	const dir = options.dir ? path.resolve(options.dir) : resolveTlsDir(root);
	const say = deps.say ?? (() => {});
	const hostname = deps.hostname ?? os.hostname();

	const declaration: CertificateDeclaration =
		options.certFile || options.keyFile
			? {
					kind: "declared",
					certFile: path.resolve(options.certFile ?? ""),
					keyFile: path.resolve(options.keyFile ?? ""),
					...(options.caFile ? { caFile: path.resolve(options.caFile) } : {}),
				}
			: {
					kind: "provider",
					provider: options.provider ?? "local-ca",
					names: options.name?.length ? options.name : [hostname.trim().toLowerCase()],
					lifetimeDays: options.days ?? DEFAULT_LEAF_LIFETIME_DAYS,
				};

	if (declaration.kind === "declared" && (!options.certFile || !options.keyFile)) {
		throw new CertificateRefusal(
			"malformed-declaration",
			"refarm cert issue: --cert-file and --key-file go together — a certificate is a pair",
			"Pass both, or pass neither and let `local-ca` issue one.",
		);
	}

	const suffixes = await resolveNameSuffixes({ dir, suffix: options.suffix, hostname });
	const registry =
		deps.registry ?? buildCertificateRegistry({ dir, nameSuffixes: suffixes, log: say }).registry;

	const certificate = await resolveCertificate({
		declaration,
		registry,
		exists: async (file) => {
			try {
				await readFile(file);
				return true;
			} catch {
				return false;
			}
		},
	});

	const serveCommand = refarmCommand([
		"web",
		"serve",
		".refarm/dist/farm-client",
		"--tls-cert",
		certificate.certFile,
		"--tls-key",
		certificate.keyFile,
	]);
	return {
		ok: true,
		certificate,
		caFile: certificate.caFile,
		needsRotation: needsRotation(certificate, new Date(deps.now?.() ?? new Date().toISOString())),
		serveCommand,
		nextCommand: certificate.caFile ? CERT_TRUST_COMMAND : serveCommand,
		nextCommands: [...(certificate.caFile ? [CERT_TRUST_COMMAND] : []), serveCommand],
	};
}

// ── trust ─────────────────────────────────────────────────────────────────────

/** WHICH trust store. `browser` is this user's own NSS databases and needs no privilege;
 *  `system` is `/usr/local/share/ca-certificates` and needs root. */
export type CertTrustScope = "browser" | "system";

/** THE SMALLEST GRANT THAT OPENS THE PAGE. Stated as a constant so "what does the default do?" is
 *  answered by one value rather than by reading a branch. */
export const DEFAULT_CERT_TRUST_SCOPE: CertTrustScope = "browser";

/** The nickname the CA is filed under inside an NSS database, and the one the undo deletes. */
export const NSS_CA_NICKNAME = "refarm";

export interface CertTrustOptions {
	/** Defaults to {@link DEFAULT_CERT_TRUST_SCOPE}. */
	scope?: CertTrustScope;
	device?: string;
	/** `system` scope only: where the anchor file is written. */
	anchor?: string;
	dir?: string;
	suffix?: string[];
	/** `browser` scope only: narrow to these store ids, instead of every one discovered. */
	store?: string[];
	/** Deliberately re-open a decision the operator already made. */
	revisit?: boolean;
}

/** What happened in ONE store. Per store, because each is a separate grant with a separate reach —
 *  declining Chrome must not be read as declining a Firefox profile. */
export interface CertTrustStoreOutcome {
	store: string;
	kind: NssStore["kind"];
	label: string;
	dir: string;
	status: OperationOutcome["status"];
	/** What this store reaches, and what it does not. */
	reaches: string[];
	doesNotReach: string[];
	recordId: string | null;
	/** The exact command that undoes it without refarm. */
	undoCommand: string;
}

export type CertTrustResult =
	| {
			ok: boolean;
			scope: "browser";
			/** Stated in the OUTPUT, not only in prose: this asked for nothing. */
			privileged: false;
			device: string;
			fingerprint: string;
			grant: string[];
			stores: CertTrustStoreOutcome[];
			nextCommand: string;
			nextCommands: string[];
	  }
	| {
			ok: boolean;
			scope: "system";
			privileged: true;
			status: OperationOutcome["status"];
			device: string;
			anchorPath: string;
			fingerprint: string;
			grant: string[];
			refreshCommand: string;
			recordId: string | null;
			nextCommand: string;
			nextCommands: string[];
	  }
	| {
			ok: true;
			/** refarm cannot reach into another device's trust store, and says so instead of
			 *  pretending. The grant is printed anyway, because the operator is about to perform it
			 *  by hand and deserves the same words. */
			status: "manual";
			scope: "manual";
			device: string;
			caFile: string;
			fingerprint: string;
			grant: string[];
			steps: string[];
			nextCommand: string;
			nextCommands: string[];
	  };

export async function runCertTrust(
	options: CertTrustOptions,
	deps: CertDeps = {},
): Promise<CertTrustResult> {
	const root = deps.root ?? process.cwd();
	const dir = options.dir ? path.resolve(options.dir) : resolveTlsDir(root);
	const hostname = deps.hostname ?? os.hostname();
	const device = options.device?.trim() || hostname;
	const suffixes = await resolveNameSuffixes({ dir, suffix: options.suffix, hostname });
	const say = deps.say ?? (() => {});
	const scope = options.scope ?? DEFAULT_CERT_TRUST_SCOPE;

	const localCa =
		deps.localCa ?? buildCertificateRegistry({ dir, nameSuffixes: suffixes, log: say }).localCa;
	const ca = await localCa.ensureCa();
	const caPem = await readFile(ca.certFile, "utf8");

	const grant = describeCaGrant({
		caName: "refarm",
		fingerprint: ca.fingerprint,
		nameSuffixes: ca.nameSuffixes,
		device,
		refreshCommand: device === hostname ? LINUX_CA_REFRESH_COMMAND : null,
	});

	// ANOTHER DEVICE IS NOT SOMETHING THIS PROCESS CAN CHANGE. A phone's trust store is reachable
	// only from the phone. Saying so — and handing over the file, the fingerprint and the same
	// grant text — is the honest answer; writing a file here and calling the phone "configured"
	// would be the "delivered vs could-not-attempt" failure this repo keeps naming.
	if (device !== hostname && !options.anchor) {
		return {
			ok: true,
			status: "manual",
			scope: "manual",
			device,
			caFile: ca.certFile,
			fingerprint: ca.fingerprint,
			grant,
			steps: [
				`Copie ${ca.certFile} para "${device}" (é o certificado PÚBLICO — a chave privada não sai daqui).`,
				`Confira a impressão digital no dispositivo: sha256 ${ca.fingerprint}`,
				"Instale nas configurações de segurança do dispositivo, como CA de confiança.",
				"Para desfazer depois: remova a CA nas MESMAS configurações — não existe revogação remota.",
			],
			nextCommand: CERT_ISSUE_COMMAND,
			nextCommands: [CERT_ISSUE_COMMAND],
		};
	}

	if (scope === "browser") {
		return runBrowserTrust({ options, deps, root, device, hostname, ca, caPem, grant, say });
	}

	const anchorPath = options.anchor ? path.resolve(options.anchor) : linuxCaAnchorPath("refarm");
	const existingPem = await readFile(anchorPath, "utf8").catch(() => null);
	const request = buildCaTrustRequest({
		caName: "refarm",
		caPem,
		fingerprint: ca.fingerprint,
		nameSuffixes: ca.nameSuffixes,
		device,
		anchorPath,
		existingPem,
		requester: "refarm cert trust",
		requestedAt: deps.now?.() ?? new Date().toISOString(),
		refreshCommand: device === hostname ? LINUX_CA_REFRESH_COMMAND : null,
	});

	const trail = deps.trail ?? createFileOperationTrail(resolveCertTrailPath(root));
	const channel = deps.operator === undefined ? createStdioOperatorChannel() : deps.operator;

	let outcome: OperationOutcome;
	try {
		outcome = await runOperationConsent({
			request,
			trail,
			channel,
			...(deps.now ? { now: deps.now } : {}),
			host: hostname,
			...(options.revisit ? { revisit: true } : {}),
			announce: (line) => say(line),
		});
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		if (code === "EACCES" || code === "EPERM") {
			throw new CertificateRefusal(
				"issuance-failed",
				`refarm cert trust system: no permission to write ${anchorPath}`,
				`A system trust store belongs to root. Re-run as \`${CERT_TRUST_SYSTEM_PLAIN_COMMAND}\`, or ` +
					`pass --anchor <path> to stage the file somewhere you can write and install it ` +
					`yourself with \`sudo cp\` + \`${LINUX_CA_REFRESH_COMMAND}\`. If all you need is a ` +
					`BROWSER, none of this is required: \`${CERT_TRUST_PLAIN_COMMAND.trim()}\` writes into ` +
					`your own NSS store and asks for no privilege.`,
			);
		}
		throw error;
	}

	const authorized = outcome.status === "authorized";
	return {
		ok: outcome.status !== "declined",
		scope: "system",
		privileged: true,
		status: outcome.status,
		device,
		anchorPath,
		fingerprint: ca.fingerprint,
		grant,
		refreshCommand: LINUX_CA_REFRESH_COMMAND,
		recordId: outcome.record?.id ?? null,
		nextCommand: authorized ? LINUX_CA_REFRESH_COMMAND : CERT_ISSUE_COMMAND,
		nextCommands: authorized
			? [LINUX_CA_REFRESH_COMMAND, CERT_ISSUE_COMMAND]
			: [CERT_ISSUE_COMMAND],
	};
}

// ── browser scope — the smallest grant that opens the page ────────────────────

/** Where discovery LOOKED, named in the refusal, so "refarm says I have no browser store" is a
 *  claim the operator can check rather than one they have to take on faith. PURE. */
export function nssSearchLocations(home: string): string[] {
	return [chromiumNssDir(home), ...firefoxProfileRoots(home).map((root) => `${root}/profiles.ini`)];
}

/**
 * The unprivileged path: this user's own NSS databases, ONE CONSENTED GRANT EACH.
 *
 * Per store rather than one blanket question, because they are not one thing. Chrome's database
 * and a Firefox profile's database have different reaches and do not see each other; a single
 * "may I trust this in your browsers?" would be exactly the category-shaped prompt that
 * `operation-consent-v1` exists to refuse to ask. Declining Firefox must leave Chrome undecided.
 */
async function runBrowserTrust(input: {
	options: CertTrustOptions;
	deps: CertDeps;
	root: string;
	device: string;
	hostname: string;
	ca: { fingerprint: string; nameSuffixes: readonly string[]; certFile: string };
	caPem: string;
	grant: string[];
	say: (line: string) => void;
}): Promise<CertTrustResult> {
	const { options, deps, root, device, hostname, ca, caPem, say } = input;
	const home = deps.home ?? os.homedir();
	const run = deps.certutil ?? createNodeCertutilRunner();

	// THE TOOL FIRST, because its absence is the one thing consent cannot work around — and because
	// a refusal that names the package is worth more than a stack trace out of certutil. Same shape
	// `cert issue` uses for a missing openssl.
	const presence = await detectCertutil(run);
	if (!presence.present) {
		throw new CertificateRefusal(
			"tool-missing",
			`refarm cert trust: ${presence.detail} — a browser's own trust store is an NSS database, ` +
				"and certutil is the only tool that can write one",
			`${CERTUTIL_MISSING_FIX} If you would rather not install it, the SYSTEM store is the other ` +
				"option — it reaches curl and node as well as browsers, and it needs root: " +
				`\`${CERT_TRUST_SYSTEM_PLAIN_COMMAND}\`.`,
		);
	}

	const discovered = deps.stores ?? (await discoverNssStores({ home }));
	const wanted = options.store?.length ? new Set(options.store) : null;
	const stores = wanted ? discovered.filter((store) => wanted.has(store.id)) : [...discovered];

	// NO SILENT ESCALATION. "No browser store here" is not a reason to reach for root on the
	// operator's behalf. It is a fact, reported with WHERE we looked, and with the larger grant
	// offered as THEIR choice rather than taken as our conclusion.
	if (stores.length === 0) {
		throw new CertificateRefusal(
			"missing-file",
			wanted
				? `refarm cert trust: no NSS store here matches ${[...wanted].join(", ")} ` +
					`(found: ${discovered.map((store) => store.id).join(", ") || "none"})`
				: "refarm cert trust: this user has no browser trust store yet — there is nothing to " +
					"install into",
			`Looked in: ${nssSearchLocations(home).join(", ")}. Open Chrome or Firefox once — each ` +
				"creates its store on first run — and try again. If what you actually need is `curl`, " +
				"`node` or `git` to trust the CA, that is the SYSTEM store: it reaches every user on " +
				`this machine, and it needs root — \`${CERT_TRUST_SYSTEM_PLAIN_COMMAND}\`.`,
		);
	}

	const trail = deps.trail ?? createFileOperationTrail(resolveCertTrailPath(root));
	const channel = deps.operator === undefined ? createStdioOperatorChannel() : deps.operator;
	const fs = createNssOperationFileSystem(run);
	const requestedAt = deps.now?.() ?? new Date().toISOString();

	const outcomes: CertTrustStoreOutcome[] = [];
	const grant: string[] = [];
	for (const store of stores) {
		const entry = nssEntryPath(store.dir, NSS_CA_NICKNAME);
		const existingPem = await fs.readFile(entry);
		const request = buildNssCaTrustRequest({
			caName: "refarm",
			caPem,
			fingerprint: ca.fingerprint,
			nameSuffixes: ca.nameSuffixes,
			device,
			store,
			nickname: NSS_CA_NICKNAME,
			existingPem,
			requester: "refarm cert trust",
			requestedAt,
		});
		grant.push(...(request.notes ?? []));
		const outcome = await runOperationConsent({
			request,
			trail,
			channel,
			fs,
			...(deps.now ? { now: deps.now } : {}),
			host: hostname,
			...(options.revisit ? { revisit: true } : {}),
			// The rendered "Arquivo" is an ENTRY in a database, not a file on disk. Saying so is the
			// difference between a diff the operator can place and one they have to decode.
			labels: { file: "Repositório de confiança" },
			announce: (line) => say(line),
		});
		const reach = describeNssStoreReach(store);
		outcomes.push({
			store: store.id,
			kind: store.kind,
			label: store.label,
			dir: store.dir,
			status: outcome.status,
			reaches: reach.reaches,
			doesNotReach: reach.doesNotReach,
			recordId: outcome.record?.id ?? null,
			undoCommand: certutilCommandLine(certutilDeleteArgs(store.dir, NSS_CA_NICKNAME)),
		});
	}

	return {
		ok: outcomes.some((outcome) => outcome.status !== "declined"),
		scope: "browser",
		privileged: false,
		device,
		fingerprint: ca.fingerprint,
		grant,
		stores: outcomes,
		nextCommand: CERT_ISSUE_COMMAND,
		nextCommands: [CERT_ISSUE_COMMAND],
	};
}

// ── the commander surface ─────────────────────────────────────────────────────

function collect(value: string, previous: string[] = []): string[] {
	return [...previous, value];
}

function print(json: boolean, payload: unknown, lines: string[]): void {
	process.stdout.write(json ? `${JSON.stringify(payload)}\n` : `${lines.join("\n")}\n`);
}

/**
 * THE ACTION BOUNDARY. Every `throw` above is an internal signal; this is the one place they stop
 * being one.
 *
 * An operator-facing command must never surface a raw stack trace, and a `--json` consumer must
 * get an envelope on the error path too — the contract `connection.ts` and `intention.ts` follow
 * and that `test/architecture/cli-refusal-conformance.test.ts` enforces for the whole CLI. It
 * matters more here than usual: the FIRST thing a machine without openssl gets from
 * `refarm cert issue` is a refusal, and a refusal that arrives as a crash is indistinguishable
 * from a bug in refarm.
 *
 * `CertificateRefusal` carries its own `fix`, and the fix is what goes into `nextAction` — the
 * operator is told what to do, not merely that something did not happen.
 */
function guarded<TOptions extends { json?: boolean }>(
	operation: string,
	handler: (options: TOptions) => Promise<void>,
): (options: TOptions) => Promise<void> {
	return async (options) => {
		try {
			await handler(options);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			const fix = error instanceof CertificateRefusal ? error.fix : null;
			const reason = error instanceof CertificateRefusal ? error.reason : "cert-failed";
			if (options.json) {
				printJson(
					buildJsonErrorEnvelope({
						command: "cert",
						operation,
						error: `cert-${reason}`,
						message,
						nextAction: fix ?? `Run \`${CERT_HELP_COMMAND}\` to see the accepted options.`,
						nextCommand: CERT_HELP_COMMAND,
					}),
				);
			} else {
				console.error(chalk.red(`✗  ${message}`));
				console.error(chalk.dim(`   ${fix ?? CERT_HELP_COMMAND}`));
			}
			process.exitCode = 1;
		}
	};
}

export function createCertCommand(): Command {
	const command = new Command("cert").description(
		"Certificates for this node's surfaces — a local CA of your own, or one you already have",
	);

	command
		.command("providers")
		.description("What can issue a certificate here, what each needs, and what each costs")
		.option("--json", "Print the report as JSON")
		.action(
			guarded("providers", async (options: { json?: boolean }) => {
				const report = await runCertProviders();
				print(Boolean(options.json), report, [
					"Certificate providers on this node:",
					...report.providers.flatMap((provider) => [
						`  ${provider.ready ? "✓" : "✗"} ${provider.id} — ${provider.title}`,
						...provider.requires.map((line) => `      precisa: ${line}`),
						...provider.costs.map((line) => `      custa:   ${line}`),
						...(provider.fix ? [`      → ${provider.fix}`] : []),
					]),
					"  · você também pode declarar um certificado que JÁ tem:",
					"      refarm cert issue --cert-file <cert.pem> --key-file <key.pem>",
					"    nesse caso nenhum provider roda.",
				]);
			}),
		);

	command
		.command("issue")
		.description("Issue (or renew) a certificate for this node's surfaces")
		.option("--provider <id>", "Which provider issues it", "local-ca")
		.option("--name <dns>", "A DNS name the certificate vouches for (repeatable)", collect)
		.option("--suffix <dns>", "A suffix this node's CA may vouch for (repeatable)", collect)
		.option("--days <n>", "Leaf lifetime in days", (value) => Number.parseInt(value, 10))
		.option("--dir <path>", "Where the CA and certificates live")
		.option("--cert-file <path>", "Use a certificate you already have — no provider runs")
		.option("--key-file <path>", "The private key for --cert-file")
		.option("--ca-file <path>", "The issuing CA for --cert-file, when clients must trust it")
		.option("--json", "Print the result as JSON")
		.action(
			guarded("issue", async (options: CertIssueOptions & { json?: boolean }) => {
				const result = await runCertIssue(options, {
					say: (line) => {
						if (!options.json) process.stdout.write(`${line}\n`);
					},
				});
				print(Boolean(options.json), result, [
					`certificate: ${result.certificate.certFile}`,
					`key:         ${result.certificate.keyFile} (0600 — never printed, never logged)`,
					...(result.caFile ? [`ca:          ${result.caFile}`] : []),
					`names:       ${result.certificate.names.join(", ") || "(as declared)"}`,
					`valid until: ${result.certificate.notAfter ?? "(not inspected)"}`,
					"",
					"Serve it beside the plain listener — the kit keeps polling http:// unchanged:",
					`  ${result.serveCommand}`,
					...(result.caFile
						? [
								"",
								"Each browser that will open the page must trust the CA first — this needs no root:",
								CERT_TRUST_PLAIN_COMMAND,
							]
						: []),
				]);
			}),
		);

	/** The options every scope takes. Declared on the group AND on each subcommand, because the two
	 *  declarations answer different questions: the subcommand's is what makes
	 *  `cert trust system --json` a legitimate invocation (and what the executable-guidance harness
	 *  reads), while Commander itself files the VALUE on the nearest ancestor that declares the same
	 *  long option — which is why every action below reads {@link commandOptions} rather than the
	 *  object Commander hands it. */
	const sharedTrustOptions = (target: Command): Command =>
		target
			.option("--device <name>", "Which device is being changed (default: this host)")
			.option("--dir <path>", "Where the CA lives")
			.option("--suffix <dns>", "A suffix this node's CA may vouch for (repeatable)", collect)
			.option("--revisit", "Re-open a decision you already made")
			.option("--json", "Print the result as JSON");

	/**
	 * WHAT THE OPERATOR ACTUALLY TYPED, wherever Commander decided to file it.
	 *
	 * Commander 14 resolves an option to the nearest ANCESTOR that declares the same long name, so
	 * `cert trust system --json` lands `json` on `trust`, not on `system`, and the subcommand's own
	 * `opts()` comes back `{}`. A handler reading that would take `--json` to be absent — it would
	 * print a refusal as prose to stderr and hand a `--json` consumer an empty stdout, which is the
	 * exact "exited 1 with no envelope" shape `cli-refusal-conformance.test.ts` exists to catch.
	 * `optsWithGlobals()` merges the chain, so the handler sees the invocation rather than the tree.
	 */
	const commandOptions = <T>(handler: (options: T) => Promise<void>) =>
		async function (this: Command, _options: unknown, command: Command): Promise<void> {
			await handler(command.optsWithGlobals() as T);
		};

	const renderTrust = (json: boolean, result: CertTrustResult): void => {
		if (result.scope === "manual") {
			print(json, result, [
				`"${result.device}" não é este dispositivo — o refarm não alcança o repositório de`,
				"confiança dele, e não vai fingir que alcança.",
				...result.grant.map((line) => `  ${line}`),
				"",
				...result.steps.map((line) => `  · ${line}`),
			]);
			return;
		}
		if (result.scope === "system") {
			print(json, result, [
				`escopo:  sistema (precisa de root) — alcança curl, node, git e todo usuário da máquina`,
				`decisão: ${result.status}`,
				`anchor:  ${result.anchorPath}`,
				`sha256:  ${result.fingerprint}`,
				...(result.status === "authorized" ? ["", `Falta rodar: ${result.refreshCommand}`] : []),
			]);
			return;
		}
		print(json, result, [
			"escopo:  navegador (sem privilégio) — só os repositórios do seu usuário",
			`sha256:  ${result.fingerprint}`,
			"",
			...result.stores.flatMap((store) => [
				`  ${store.status === "authorized" ? "✓" : "·"} ${store.label} — ${store.status}`,
				`      base:     ${store.dir}`,
				`      alcança:  ${store.reaches.join("; ")}`,
				`      NÃO vai:  ${store.doesNotReach.join("; ")}`,
				`      desfazer: ${store.undoCommand}`,
			]),
			"",
			"Feche e reabra o navegador para ele reler o repositório.",
		]);
	};

	const trust = command
		.command("trust")
		.description(
			"Trust this node's CA in your own browsers — no root. `trust system` is the larger grant",
		);
	const trustAction = (scope: CertTrustScope) =>
		commandOptions(
			guarded("trust", async (options: CertTrustOptions & { json?: boolean }) => {
				renderTrust(
					Boolean(options.json),
					await runCertTrust(
						{ ...options, scope },
						{
							say: (line) => {
								if (!options.json) process.stdout.write(`${line}\n`);
							},
						},
					),
				);
			}),
		);

	sharedTrustOptions(trust)
		.option("--store <id>", "Only this NSS store (repeatable; default: every one found)", collect)
		.action(trustAction("browser"));

	sharedTrustOptions(
		trust
			.command("browser")
			.description("Say the default out loud: this user's own browser trust stores, no privilege"),
	)
		.option("--store <id>", "Only this NSS store (repeatable; default: every one found)", collect)
		.action(trustAction("browser"));

	sharedTrustOptions(
		trust
			.command("system")
			.description(
				"The SYSTEM trust store — reaches curl, node, git and every user here. Needs root",
			),
	)
		.option("--anchor <path>", "Where the trust anchor is written")
		.action(trustAction("system"));

	return command;
}

/** Re-exported so a caller can render a request without importing the consent block itself. */
export { renderOperationRequest };
