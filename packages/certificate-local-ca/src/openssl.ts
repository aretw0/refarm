import { spawn } from "node:child_process";

/**
 * The one external tool this provider needs, behind an interface.
 *
 * WHY AN EXTERNAL TOOL AT ALL. Node cannot mint an X.509 certificate: `node:crypto`'s
 * `X509Certificate` PARSES one, it does not issue one, and there is no signing/extension API in
 * the standard library to build one with. A pure-Node issuer would mean vendoring an ASN.1 encoder
 * — a dependency, in a repo whose canonical blocks are zero-dependency — to reimplement something
 * every Linux, macOS and WSL install already ships.
 *
 * So: `openssl`. It is present on essentially every Linux (`/usr/bin/openssl`, part of a base
 * install), on macOS, and in WSL. What matters more than the choice is the BEHAVIOUR WHEN IT IS
 * ABSENT: {@link detectOpenssl} answers "can this machine do it?" without throwing, so a missing
 * tool becomes a refusal that names the fix — and names the escape hatch, which is T2's third case
 * (declare a certificate you already have and use no provider at all).
 *
 * NOTHING SECRET EVER CROSSES THIS SEAM. Keys are produced BY openssl, written by openssl to a
 * path we chose, and read back never. No `-passin`, no key on argv, no key on stdin. That is what
 * makes "the private key is never logged" a property of the shape rather than of our discipline:
 * there is no value here that could be logged.
 */

export interface OpensslResult {
	/** Exit code, or `null` when the process could not be started at all. */
	code: number | null;
	stdout: string;
	stderr: string;
	/** Why the process could not be started (`ENOENT` when the binary is absent). `null` on a
	 *  process that ran, however it exited. */
	spawnError: string | null;
}

/** Run openssl with these arguments. Never throws — a failure is a RESULT. */
export type OpensslRunner = (args: readonly string[]) => Promise<OpensslResult>;

export const DEFAULT_OPENSSL_BIN = "openssl";

export function createNodeOpensslRunner(bin: string = DEFAULT_OPENSSL_BIN): OpensslRunner {
	return (args) =>
		new Promise<OpensslResult>((resolve) => {
			let stdout = "";
			let stderr = "";
			let settled = false;
			const finish = (result: OpensslResult) => {
				if (settled) return;
				settled = true;
				resolve(result);
			};
			let child;
			try {
				child = spawn(bin, [...args], { stdio: ["ignore", "pipe", "pipe"] });
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
		});
}

export type OpensslPresence =
	| { present: true; version: string }
	| { present: false; detail: string };

/**
 * Is openssl usable here? Never throws — this is the question a preflight asks, and a preflight
 * that can throw is a preflight nobody can call safely.
 */
export async function detectOpenssl(run: OpensslRunner): Promise<OpensslPresence> {
	const result = await run(["version"]);
	if (result.spawnError !== null) {
		return {
			present: false,
			detail:
				result.spawnError === "ENOENT"
					? "openssl is not on PATH"
					: `openssl could not be started: ${result.spawnError}`,
		};
	}
	if (result.code !== 0) {
		return { present: false, detail: `\`openssl version\` exited ${result.code}` };
	}
	return { present: true, version: result.stdout.trim().split("\n")[0] ?? "" };
}

/** What an operator does when openssl is absent — named, per platform, plus the escape hatch that
 *  needs no tool at all. */
export const OPENSSL_MISSING_FIX =
	"Install openssl (Debian/Ubuntu: `sudo apt install openssl`; Fedora: `sudo dnf install openssl`; " +
	"macOS: it ships with the system, or `brew install openssl`). If you would rather not install " +
	"anything, refarm can use a certificate you ALREADY have: declare its `certFile`/`keyFile` and " +
	"no provider runs at all.";

const PEM_PRIVATE_KEY =
	/-----BEGIN (?:[A-Z ]*)PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z ]*)PRIVATE KEY-----/g;

/**
 * Strip any private key from text on its way OUT of this package.
 *
 * openssl does not print keys to stderr, so this guards against a future that changes — a diagnostic
 * flag, a different tool, an operator's own wrapper on PATH. The rule "a private key is never
 * logged" should hold because of a filter that runs, not because of what we believe openssl does.
 * PURE.
 */
export function redactPrivateKeys(text: string): string {
	return text.replace(PEM_PRIVATE_KEY, "[private key redacted]");
}
