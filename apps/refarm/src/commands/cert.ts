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
	createLocalCaProvider,
	describeCaGrant,
	LINUX_CA_REFRESH_COMMAND,
	linuxCaAnchorPath,
	type LocalCaProvider,
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
 *  - `trust` — install that CA on a device. A SIGNIFICANT GRANT, carried through
 *    `@refarm.dev/operation-consent-v1` so it is proposed as an exact diff, decided by the human,
 *    and remembered with an undo that executes.
 *
 * T2's third case needs no subcommand and that is the point: an operator who already HAS a
 * certificate passes `--cert-file`/`--key-file` and no provider runs at all.
 */

/** The handoffs this command hands on. Built through the brand helper (ADR-087) rather than
 *  written as literals, so the binary is named in exactly one place.
 *
 * `cert trust` is declared privileged (`src/privileged-steps.ts`): it writes into
 * `/usr/local/share/ca-certificates`, which belongs to root. So its handoffs are built through
 * `refarmPrivilegedCommand`, which names the interpreter and the entrypoint by absolute path.
 * The bare `refarm cert trust` this used to print was correct in the operator's shell and
 * UNRUNNABLE the moment `sudo` went in front of it — `sudo` replaces PATH with `secure_path`,
 * which omits `~/.local/bin`. The operator got `sudo: refarm: command not found` from a command
 * that had just told them, in the same breath, that root was required. */
const CERT_ISSUE_COMMAND = refarmCommand(["cert", "issue", "--json"]);
const CERT_TRUST_COMMAND = refarmPrivilegedCommand(["cert", "trust", "--json"]);
const CERT_TRUST_PLAIN_COMMAND = `  ${refarmPrivilegedCommand(["cert", "trust"])}`;
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
 * The names this node answers to, by default.
 *
 * Just the hostname. NOT a guess at a tailnet suffix: `expose: "tailnet"` is resolved at bind time
 * by asking Tailscale, and inventing a suffix here would put a name in a certificate that nothing
 * verified. The operator passes `--suffix` when their names live under something wider.
 */
export function defaultNameSuffixes(hostname: string = os.hostname()): string[] {
	const trimmed = hostname.trim().toLowerCase();
	return trimmed ? [trimmed] : [];
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

	const suffixes = options.suffix?.length ? options.suffix : defaultNameSuffixes(hostname);
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

export interface CertTrustOptions {
	device?: string;
	anchor?: string;
	dir?: string;
	suffix?: string[];
	/** Deliberately re-open a decision the operator already made. */
	revisit?: boolean;
}

export type CertTrustResult =
	| {
			ok: boolean;
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
	const suffixes = options.suffix?.length ? options.suffix : defaultNameSuffixes(hostname);
	const say = deps.say ?? (() => {});

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
				`refarm cert trust: no permission to write ${anchorPath}`,
				`A system trust store belongs to root. Re-run as \`${CERT_TRUST_PLAIN_COMMAND.trim()}\`, or ` +
					`pass --anchor <path> to stage the file somewhere you can write and install it ` +
					`yourself with \`sudo cp\` + \`${LINUX_CA_REFRESH_COMMAND}\`.`,
			);
		}
		throw error;
	}

	const authorized = outcome.status === "authorized";
	return {
		ok: outcome.status !== "declined",
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
								"Each device that will open the page must trust the CA first:",
								CERT_TRUST_PLAIN_COMMAND,
							]
						: []),
				]);
			}),
		);

	command
		.command("trust")
		.description("Ask to trust this node's CA on a device — a grant, stated plainly")
		.option("--device <name>", "Which device is being changed (default: this host)")
		.option("--anchor <path>", "Where the trust anchor is written")
		.option("--dir <path>", "Where the CA lives")
		.option("--suffix <dns>", "A suffix this node's CA may vouch for (repeatable)", collect)
		.option("--revisit", "Re-open a decision you already made")
		.option("--json", "Print the result as JSON")
		.action(
			guarded("trust", async (options: CertTrustOptions & { json?: boolean }) => {
				const result = await runCertTrust(options, {
					say: (line) => {
						if (!options.json) process.stdout.write(`${line}\n`);
					},
				});
				if (result.status === "manual") {
					print(Boolean(options.json), result, [
						`"${result.device}" não é este dispositivo — o refarm não alcança o repositório de`,
						"confiança dele, e não vai fingir que alcança.",
						...result.grant.map((line) => `  ${line}`),
						"",
						...result.steps.map((line) => `  · ${line}`),
					]);
					return;
				}
				print(Boolean(options.json), result, [
					`decisão: ${result.status}`,
					`anchor:  ${result.anchorPath}`,
					`sha256:  ${result.fingerprint}`,
					...(result.status === "authorized" ? ["", `Falta rodar: ${result.refreshCommand}`] : []),
				]);
			}),
		);

	return command;
}

/** Re-exported so a caller can render a request without importing the consent block itself. */
export { renderOperationRequest };
