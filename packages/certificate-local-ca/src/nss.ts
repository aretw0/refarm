import { spawn } from "node:child_process";
import { stat, readFile as readFileFromDisk } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { CertificateRefusal } from "@refarm.dev/certificate-contract-v1";
import type { OperationFileSystem } from "@refarm.dev/operation-consent-v1";

/**
 * THE TRUST STORE A BROWSER ACTUALLY READS — which, on Linux, is not the system's.
 *
 * ── THE MEASUREMENT THAT PUT THIS FILE HERE ──────────────────────────────────────
 *
 * `refarm cert trust` went straight for `/usr/local/share/ca-certificates` +
 * `update-ca-certificates`, so it needed root, so the operator needed `sudo`, so the handoff had
 * to name an absolute interpreter path — a chain of consequences whose FIRST link was wrong. The
 * case that motivated all of it is "open the refarm page in a browser", and on Linux
 * **Chrome and Firefox do not consult the system trust store at all**. Each keeps its own NSS
 * database, per user:
 *
 *   · Chromium-family (Chrome, Chromium, Brave, Vivaldi, Opera, Edge) → `~/.pki/nssdb`, shared;
 *   · Firefox → one database PER PROFILE, under the profile directory.
 *
 * Both are files the operator owns. Adding a CA to them needs **no privilege whatsoever**.
 *
 * The system store still matters — `curl`, `wget`, `git`, `node`, `python-requests` and every
 * system tool read it, and nothing here changes that. It is a DIFFERENT need, wanted less often,
 * and it is the caller's job to say so rather than quietly grant the larger thing.
 *
 * ── WHY `certutil` ───────────────────────────────────────────────────────────────
 *
 * An NSS database is a SQLite file with NSS's own schema (`cert9.db`, `key4.db`). Writing it
 * correctly means implementing NSS, so this block shells out to `certutil`, exactly as
 * `openssl.ts` shells out to openssl and for the same reason — and, like it, what matters more
 * than the choice is the BEHAVIOUR WHEN IT IS ABSENT: {@link detectCertutil} answers "can this
 * machine do it?" without throwing, so a missing tool becomes a refusal that names the package.
 *
 * ── THE SHAPE THAT MAKES THE UNDO EXECUTABLE ─────────────────────────────────────
 *
 * `operation-consent-v1` applies a change set through an {@link OperationFileSystem}: write the
 * `after`, or remove the file when `after` is null. {@link createNssOperationFileSystem} is that
 * interface implemented over `certutil` — a "path" of `<db-dir>#<nickname>` names ONE ENTRY in
 * ONE database, `writeFile` is `certutil -A`, and `removeFile` is `certutil -D`. So the undo the
 * operator is shown is not a sentence: reversing the recorded snapshots runs the deletion.
 *
 * The pseudo-path names the ENTRY rather than `cert9.db` deliberately. The before/after the
 * operator reads must be true, and the true before/after of this operation is the certificate
 * under that nickname — not the binary database, whose bytes would tell them nothing.
 */

// ── the tool ──────────────────────────────────────────────────────────────────

export interface CertutilResult {
	/** Exit code, or `null` when the process could not be started at all. */
	code: number | null;
	stdout: string;
	stderr: string;
	/** Why the process could not be started (`ENOENT` when the binary is absent). `null` on a
	 *  process that ran, however it exited. */
	spawnError: string | null;
}

/** Run certutil with these arguments, optionally feeding it stdin. Never throws — a failure is a
 *  RESULT, which is what lets a preflight ask "can this machine do it?" safely. */
export type CertutilRunner = (args: readonly string[], stdin?: string) => Promise<CertutilResult>;

export const DEFAULT_CERTUTIL_BIN = "certutil";

export function createNodeCertutilRunner(bin: string = DEFAULT_CERTUTIL_BIN): CertutilRunner {
	return (args, stdin) =>
		new Promise<CertutilResult>((resolve) => {
			let stdout = "";
			let stderr = "";
			let settled = false;
			const finish = (result: CertutilResult) => {
				if (settled) return;
				settled = true;
				resolve(result);
			};
			let child;
			try {
				child = spawn(bin, [...args], {
					stdio: [stdin === undefined ? "ignore" : "pipe", "pipe", "pipe"],
				});
			} catch (error) {
				finish({
					code: null,
					stdout: "",
					stderr: "",
					spawnError: error instanceof Error ? error.message : String(error),
				});
				return;
			}
			child.stdout?.on("data", (chunk: Buffer) => (stdout += chunk.toString("utf8")));
			child.stderr?.on("data", (chunk: Buffer) => (stderr += chunk.toString("utf8")));
			child.on("error", (error: NodeJS.ErrnoException) =>
				finish({ code: null, stdout, stderr, spawnError: error.code ?? error.message }),
			);
			child.on("close", (code) => finish({ code: code ?? 1, stdout, stderr, spawnError: null }));
			if (stdin !== undefined) {
				child.stdin?.on("error", () => {});
				child.stdin?.end(stdin);
			}
		});
}

export type CertutilPresence = { present: true } | { present: false; detail: string };

/**
 * Is certutil usable here? Never throws.
 *
 * PRESENCE IS "THE PROCESS STARTED", NOT "IT EXITED 0". Measured on this machine (NSS 3.x):
 * `certutil -H` exits 1, bare `certutil` exits 1, `certutil --version` exits 1 and `certutil -V`
 * exits 255 — there is no invocation that both prints a version and succeeds. So the probe asks
 * the only question that has an honest answer: could the binary be executed at all?
 */
export async function detectCertutil(run: CertutilRunner): Promise<CertutilPresence> {
	const result = await run(["-H"]);
	if (result.spawnError === null) return { present: true };
	return {
		present: false,
		detail:
			result.spawnError === "ENOENT"
				? "certutil is not on PATH"
				: `certutil could not be started: ${result.spawnError}`,
	};
}

/** What an operator does when certutil is absent — named per platform, because "install NSS tools"
 *  is not a command anybody can type. */
export const CERTUTIL_MISSING_FIX =
	"Install NSS's certutil — Debian/Ubuntu: `sudo apt install libnss3-tools`; " +
	"Fedora/RHEL: `sudo dnf install nss-tools`; Arch: `sudo pacman -S nss`; " +
	"openSUSE: `sudo zypper install mozilla-nss-tools`; macOS: `brew install nss`. " +
	"It is the only tool that can edit a browser's own trust store, and that store is the one a " +
	"browser reads — the system store does not reach it.";

// ── the arguments ─────────────────────────────────────────────────────────────

/**
 * The trust flags for a CA that may vouch for TLS SERVERS and nothing else.
 *
 * NSS's three trust categories are `SSL,S/MIME,JAR/XPI`. `C,,` is "trusted CA" in the SSL column
 * and EMPTY in the other two: this authority cannot vouch for an email identity and cannot sign a
 * browser extension. It is the narrowest flag set that makes https work, which is the point of
 * the whole file.
 */
export const NSS_CA_TRUST_FLAGS = "C,,";

/** How certutil is told to use the modern (sqlite) database format in `dir`. PURE. */
export function nssDbSpec(dir: string): string {
	return `sql:${dir}`;
}

/** Add a CA, reading the PEM from STDIN — so what is installed is byte-for-byte what the operator
 *  was shown, rather than whatever a file on disk happens to hold by then. PURE. */
export function certutilAddArgs(
	dir: string,
	nickname: string,
	trustFlags: string = NSS_CA_TRUST_FLAGS,
): string[] {
	return ["-A", "-d", nssDbSpec(dir), "-n", nickname, "-t", trustFlags, "-a"];
}

/** Print one entry as PEM. Exits non-zero when the nickname is not there, which is how "what is
 *  installed right now?" is answered without a second tool. PURE. */
export function certutilListArgs(dir: string, nickname: string): string[] {
	return ["-L", "-d", nssDbSpec(dir), "-n", nickname, "-a"];
}

/** Remove one entry. THE UNDO. PURE. */
export function certutilDeleteArgs(dir: string, nickname: string): string[] {
	return ["-D", "-d", nssDbSpec(dir), "-n", nickname];
}

/** The same argv as a line the operator can paste. Quoting is applied only where a shell would
 *  otherwise re-split or re-interpret the token. PURE. */
export function certutilCommandLine(
	args: readonly string[],
	bin: string = DEFAULT_CERTUTIL_BIN,
): string {
	return [bin, ...args]
		.map((token) => (/^[\w@%+=:,./-]+$/.test(token) ? token : `'${token.replace(/'/g, `'\\''`)}'`))
		.join(" ");
}

// ── the stores ────────────────────────────────────────────────────────────────

export type NssStoreKind = "chromium" | "firefox";

/** One NSS database this user owns. */
export interface NssStore {
	/** Stable id an operator can pass to narrow the operation (`chromium`, `firefox:default`). */
	id: string;
	kind: NssStoreKind;
	/** How it is named to the operator — short, because the directory is carried separately. */
	label: string;
	/** The database directory certutil is pointed at. */
	dir: string;
	/** The Firefox profile's own name, when this is a Firefox store. */
	profile?: string;
}

/** Where the Chromium family keeps its shared NSS database. PURE. */
export function chromiumNssDir(home: string): string {
	return path.join(home, ".pki", "nssdb");
}

/**
 * Everywhere a Firefox install keeps its profile tree, in the order they are searched.
 *
 * Three, because packaging moved it twice and the operator did not choose which packaging they
 * got: the classic path, Ubuntu's snap, and Flatpak. A discovery that knew only the first would
 * report "no Firefox" on a machine with Firefox open in front of the operator. PURE.
 */
export function firefoxProfileRoots(home: string): string[] {
	return [
		path.join(home, ".mozilla", "firefox"),
		path.join(home, "snap", "firefox", "common", ".mozilla", "firefox"),
		path.join(home, ".var", "app", "org.mozilla.firefox", ".mozilla", "firefox"),
	];
}

export interface FirefoxProfileEntry {
	name: string;
	/** As written in `profiles.ini` — relative to the root, or absolute. */
	path: string;
	isRelative: boolean;
}

/**
 * Firefox's own index of its profiles.
 *
 * FIREFOX IS NOT ONE STORE. A profile is a whole separate NSS database, and an operator may have
 * none (never launched), one (the common case), or several — a default plus an ESR plus a
 * throwaway. `profiles.ini` is the authority on which exist; guessing by listing directories would
 * pick up `Crash Reports` and `Pending Pings`, which are not profiles. PURE.
 */
export function parseFirefoxProfilesIni(text: string): FirefoxProfileEntry[] {
	const profiles: FirefoxProfileEntry[] = [];
	let current: { name?: string; path?: string; isRelative: boolean } | null = null;
	const flush = () => {
		if (current?.path) {
			profiles.push({
				name: current.name ?? current.path,
				path: current.path,
				isRelative: current.isRelative,
			});
		}
		current = null;
	};
	for (const raw of text.split(/\r?\n/)) {
		const line = raw.trim();
		const section = /^\[(.+)\]$/.exec(line);
		if (section) {
			flush();
			// `[Profile0]`, `[Profile1]` — and NOT `[General]` or `[Install…]`, which carry a
			// `Default=` of their own and would otherwise be read as a profile.
			if (/^Profile\d+$/i.test(section[1] ?? "")) current = { isRelative: true };
			continue;
		}
		if (!current) continue;
		const pair = /^([^=]+)=(.*)$/.exec(line);
		if (!pair) continue;
		const key = (pair[1] ?? "").trim().toLowerCase();
		const value = (pair[2] ?? "").trim();
		if (key === "name") current.name = value;
		else if (key === "path") current.path = value;
		else if (key === "isrelative") current.isRelative = value !== "0";
	}
	flush();
	return profiles;
}

/** The only I/O discovery performs, behind an interface so a test never needs a real HOME. */
export interface NssDiscoveryIo {
	exists(target: string): Promise<boolean>;
	readFile(target: string): Promise<string | null>;
}

export function createNodeNssDiscoveryIo(): NssDiscoveryIo {
	return {
		async exists(target) {
			try {
				await stat(target);
				return true;
			} catch {
				return false;
			}
		},
		async readFile(target) {
			try {
				return await readFileFromDisk(target, "utf8");
			} catch {
				return null;
			}
		},
	};
}

/** The file whose presence means "this profile has an NSS database". */
export const NSS_DATABASE_FILE = "cert9.db";

export interface DiscoverNssStoresOptions {
	home?: string;
	io?: NssDiscoveryIo;
}

/**
 * Which NSS databases exist for THIS user, right now.
 *
 * PRESENCE IS MEASURED, NEVER ASSUMED, and the two families are measured differently because they
 * behave differently:
 *
 *  · Chromium — the store is present when `~/.pki/nssdb` EXISTS as a directory. `certutil -A`
 *    creates the database inside an existing directory (verified), so a Chrome that has run at
 *    least once is enough; a machine where Chrome has never started has no such directory and is
 *    honestly reported as having no store rather than having one conjured for it.
 *  · Firefox — a profile counts when its directory holds `cert9.db`, i.e. Firefox has actually
 *    opened it. Creating a database inside a profile Firefox has never used would leave a file
 *    Firefox may later replace, which is a change nobody authorised.
 */
export async function discoverNssStores(
	options: DiscoverNssStoresOptions = {},
): Promise<NssStore[]> {
	const home = options.home ?? os.homedir();
	const io = options.io ?? createNodeNssDiscoveryIo();
	const stores: NssStore[] = [];
	const seen = new Set<string>();

	const chromium = chromiumNssDir(home);
	if (await io.exists(chromium)) {
		seen.add(chromium);
		stores.push({ id: "chromium", kind: "chromium", label: "Chrome/Chromium", dir: chromium });
	}

	const usedIds = new Set(stores.map((store) => store.id));
	for (const root of firefoxProfileRoots(home)) {
		const ini = await io.readFile(path.join(root, "profiles.ini"));
		if (ini === null) continue;
		for (const profile of parseFirefoxProfilesIni(ini)) {
			const dir = profile.isRelative ? path.join(root, profile.path) : profile.path;
			if (seen.has(dir)) continue;
			if (!(await io.exists(path.join(dir, NSS_DATABASE_FILE)))) continue;
			seen.add(dir);
			let id = `firefox:${profile.name}`;
			for (let n = 2; usedIds.has(id); n += 1) id = `firefox:${profile.name}-${n}`;
			usedIds.add(id);
			stores.push({
				id,
				kind: "firefox",
				label: `Firefox — perfil "${profile.name}"`,
				dir,
				profile: profile.name,
			});
		}
	}
	return stores;
}

/** What a grant in this store reaches, and what it does NOT. */
export interface NssStoreReach {
	reaches: string[];
	doesNotReach: string[];
}

/** Everything that keeps reading the SYSTEM store no matter what happens in an NSS database — the
 *  sentence an operator needs in order to understand a later `curl` failure. */
const SYSTEM_STORE_READERS =
	"curl, wget, git, node, python (requests), openssl e as ferramentas de sistema — essas leem o " +
	"repositório do SISTEMA (/etc/ssl/certs), que esta autorização NÃO toca. Se um `curl https://…` " +
	"reclamar de certificado desconhecido depois disto, é exatamente por isso";

/**
 * The reach of one store, stated so that a later surprise is explainable from what was said here.
 *
 * "It works in Chrome but curl still fails" is the predictable next question, and an operator who
 * has to discover the answer by hitting it was not told the truth about what they authorised. PURE.
 */
export function describeNssStoreReach(store: NssStore): NssStoreReach {
	if (store.kind === "chromium") {
		return {
			reaches: [
				"Google Chrome, Chromium, Brave, Vivaldi, Opera e Edge — todos leem esta mesma base NSS",
				`só o usuário dono de ${store.dir}: outra conta neste computador não é alcançada`,
			],
			doesNotReach: [
				SYSTEM_STORE_READERS,
				"o Firefox, que mantém uma base separada POR PERFIL e não lê esta",
				"qualquer outro dispositivo",
			],
		};
	}
	return {
		reaches: [
			`só o perfil "${store.profile ?? store.id}" do Firefox (${store.dir})`,
			"esse perfil em qualquer janela do Firefox, depois de fechar e reabrir o navegador",
		],
		doesNotReach: [
			"os OUTROS perfis do Firefox — cada perfil tem a sua própria base, e cada um precisa da sua autorização",
			"Chrome/Chromium, que lê ~/.pki/nssdb",
			SYSTEM_STORE_READERS,
			"o Firefox no Linux não usa o repositório do sistema por padrão (`security.enterprise_roots.enabled` " +
				"não vem ligado), então confiar no sistema também NÃO alcançaria este perfil",
		],
	};
}

// ── the entry, as a change consent can apply and undo ─────────────────────────

/** What separates the database directory from the nickname in an entry path. */
export const NSS_ENTRY_SEPARATOR = "#";

/** The change's "path": one entry, in one database. PURE. */
export function nssEntryPath(dir: string, nickname: string): string {
	return `${dir}${NSS_ENTRY_SEPARATOR}${nickname}`;
}

/** Read it back. `null` when the string is not an entry path at all. PURE. */
export function parseNssEntryPath(target: string): { dir: string; nickname: string } | null {
	const at = target.lastIndexOf(NSS_ENTRY_SEPARATOR);
	if (at <= 0 || at === target.length - 1) return null;
	return { dir: target.slice(0, at), nickname: target.slice(at + 1) };
}

function certutilFailure(action: string, target: string, result: CertutilResult): never {
	if (result.spawnError !== null) {
		throw new CertificateRefusal(
			"tool-missing",
			`nss: certutil could not be started to ${action} ${target} (${result.spawnError})`,
			CERTUTIL_MISSING_FIX,
		);
	}
	const detail = (result.stderr || result.stdout).trim().split("\n")[0] ?? "";
	throw new CertificateRefusal(
		"issuance-failed",
		`nss: certutil exited ${result.code} trying to ${action} ${target}${detail ? ` — ${detail}` : ""}`,
		"Check that the database directory exists and is writable by you, and that no browser is " +
			"holding it open. Nothing was changed.",
	);
}

/**
 * `operation-consent-v1`'s filesystem, implemented over certutil.
 *
 * This is the seam that makes an NSS grant a first-class consented operation rather than a special
 * case: the same `runOperationConsent` that writes a shell profile writes this, the same recorded
 * snapshots reverse it, and `undoOperationRecord` therefore RUNS `certutil -D`.
 */
export function createNssOperationFileSystem(
	run: CertutilRunner,
	options: { trustFlags?: string } = {},
): OperationFileSystem {
	const trustFlags = options.trustFlags ?? NSS_CA_TRUST_FLAGS;
	const entryOf = (target: string): { dir: string; nickname: string } => {
		const parsed = parseNssEntryPath(target);
		if (!parsed) {
			throw new CertificateRefusal(
				"malformed-declaration",
				`nss: ${JSON.stringify(target)} does not name an entry in an NSS database`,
				`Expected <database-dir>${NSS_ENTRY_SEPARATOR}<nickname> — build it with nssEntryPath().`,
			);
		}
		return parsed;
	};
	const read = async (dir: string, nickname: string): Promise<string | null> => {
		const result = await run(certutilListArgs(dir, nickname));
		if (result.spawnError !== null) certutilFailure("read", nssEntryPath(dir, nickname), result);
		// A non-zero exit here is the ordinary "not installed" answer, not a failure: certutil says
		// `Could not find cert` and exits 255. Reporting that as an error would make every FIRST
		// trust operation look broken.
		return result.code === 0 ? result.stdout : null;
	};
	return {
		async readFile(target) {
			const { dir, nickname } = entryOf(target);
			return read(dir, nickname);
		},
		async writeFile(target, content) {
			const { dir, nickname } = entryOf(target);
			const result = await run(certutilAddArgs(dir, nickname, trustFlags), content);
			if (result.code !== 0 || result.spawnError !== null) {
				certutilFailure("install into", nssEntryPath(dir, nickname), result);
			}
		},
		async removeFile(target) {
			const { dir, nickname } = entryOf(target);
			// "A missing file is not an error" is the interface's contract, and certutil disagrees —
			// deleting an absent nickname exits 255 with SEC_ERROR_INVALID_ARGS (verified). Asking
			// first keeps the contract without matching on an error string.
			if ((await read(dir, nickname)) === null) return;
			const result = await run(certutilDeleteArgs(dir, nickname));
			if (result.code !== 0 || result.spawnError !== null) {
				certutilFailure("remove from", nssEntryPath(dir, nickname), result);
			}
		},
	};
}
