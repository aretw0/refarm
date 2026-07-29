// Connection catalog — the operator surface over the declared catalog of long-lived,
// shared connections (a VPN client holding a tunnel, a logged-in session).
//
// A connection is declared by the OPERATOR in `.refarm/config.json`, under `connections`.
// The Rust host (`packages/tractor/src/host/host_effects_bridge/connection_decl.rs`) is
// the authoritative parser and RUNS these declarations, so it fails shut on anything
// malformed — it is one step from executing an argv. This file mirrors its rules and
// defaults, but this surface only ASKS "what is declared, and is it usable?" — it never
// runs anything. So it REPORTS instead of throwing: a bad declaration still appears in
// `connections` (an operator debugging a broken one needs to see it, not have the whole
// catalog read fail), and every problem found is collected as a `CatalogIssue` rather than
// aborting at the first one. Never silently drop a declared connection from the report.
//
// `readConnectionCatalog` is pure over a config object — the caller supplies it via
// `loadConfig()` (see `apps/refarm/src/commands/workspace.ts` for the analogous pattern
// over a workspace's declared `commands` allowlist), so this never touches the filesystem
// itself and every test drives it with a literal.

import { constants as fsConstants } from "node:fs";
import fs from "node:fs";
import path from "node:path";

/** Mirrors `DEFAULT_READY_TIMEOUT_MS` in the Rust parser. */
const DEFAULT_READY_TIMEOUT_MS = 120_000;
/** Mirrors `DEFAULT_PROBE_INTERVAL_MS` in the Rust parser. */
const DEFAULT_PROBE_INTERVAL_MS = 1_000;
/** Mirrors `MAX_CONNECTIONS` in the Rust parser. */
const MAX_CONNECTIONS = 32;
/** Mirrors `MAX_CONNECTION_NAME_LEN` in the Rust parser. */
const MAX_CONNECTION_NAME_LEN = 128;
/** Mirrors `MAX_CONNECTION_PATTERN_LEN` in the Rust parser, applied to `probe.expect` and
 * to each notice rule's `pattern`. */
const MAX_CONNECTION_PATTERN_LEN = 512;
/** Mirrors `MAX_CONNECTION_NOTICES` in the Rust parser. */
const MAX_CONNECTION_NOTICES = 16;

/**
 * Binaries that would smuggle a shell back in through the probe. `sh -c "…"` is
 * argv-shaped but interprets a command string, so allowing it in the allowlist allows
 * everything. `env` is here for the same reason (`env sh -c …`). Mirrors `SHELL_LIKE` in
 * the Rust parser.
 */
const SHELL_LIKE = new Set(["sh", "bash", "zsh", "dash", "ksh", "fish", "env", "eval", "command"]);

/**
 * Sentinel used as `CatalogIssue.connection` for a problem with the WHOLE `connections`
 * block (e.g. it isn't an object at all) rather than with one named declaration. No real
 * declared connection can ever have this name — `parse_one`'s length check rejects an
 * empty name, and this string is never empty, so it can't collide.
 */
const CATALOG_LEVEL_ISSUE = "(connections)";

export interface ConnectionProbe {
	run: string[];
	expect?: string;
}

export interface DeclaredConnection {
	name: string;
	/** The argv that brings the connection up and HOLDS it. */
	establish: string[];
	probe: ConnectionProbe;
	env: Record<string, string>;
	cwd?: string;
	readyTimeoutMs: number;
	probeIntervalMs: number;
	/** What happens once the last claim on this connection is released. */
	linger: "operator" | { idleMs: number };
}

/** One problem found while reading the catalog, either about one named declaration or
 * (via `CATALOG_LEVEL_ISSUE`) about the `connections` block as a whole. */
export interface CatalogIssue {
	connection: string;
	field: string;
	message: string;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Read an argv-shaped field. A non-array, or a non-string entry, is reported rather than
 * silently coerced — a dropped or stringified entry would describe a DIFFERENT argv than
 * the one the operator declared. Returns the valid prefix read so far so the report still
 * shows what is usable, mirroring `string_array` in the Rust parser (which instead fails
 * the whole parse).
 */
function readStringArrayField(
	name: string,
	field: string,
	raw: unknown,
	issues: CatalogIssue[],
): string[] {
	if (raw === undefined || raw === null) return [];
	if (!Array.isArray(raw)) {
		issues.push({ connection: name, field, message: `${field} must be an array of strings` });
		return [];
	}
	const out: string[] = [];
	for (let i = 0; i < raw.length; i += 1) {
		const item: unknown = raw[i];
		if (typeof item !== "string") {
			issues.push({
				connection: name,
				field,
				message:
					`${field}[${i}] must be a string — a non-string entry would describe a different ` +
					`argv than the one declared`,
			});
			return out;
		}
		out.push(item);
	}
	return out;
}

function readOptionalStringField(
	name: string,
	field: string,
	raw: unknown,
	issues: CatalogIssue[],
): string | undefined {
	if (raw === undefined || raw === null) return undefined;
	if (typeof raw !== "string") {
		issues.push({ connection: name, field, message: `${field} must be a string` });
		return undefined;
	}
	return raw;
}

/**
 * Constructs that JavaScript's `RegExp` accepts but the host's Rust `regex` crate does
 * not: lookahead, lookbehind, and backreferences — the crate is a linear-time engine and
 * deliberately has none of these. A pattern that uses one compiles fine right here and
 * then fails shut on the host, which is exactly the drift this surface exists to catch —
 * "the operator reads fine for something the host refuses to run."
 *
 * This is a SUBSTRING heuristic, not a parser, and it is deliberately incomplete:
 *   - It DOES catch the unambiguous lookaround/named-backreference syntax — `(?=`, `(?!`,
 *     `(?<=`, `(?<!`, `\k<` — because these character sequences have no other meaning in a
 *     regex body, so a substring match is already a reliable positive.
 *   - It does NOT catch numbered backreferences (`\1`, `\2`, …). Telling a real
 *     backreference apart from a harmless escaped digit requires tracking how many capture
 *     groups precede it, which is parsing, not a substring check — cheap-and-reliable
 *     stops here. A pattern using only a numbered backreference will pass this check and
 *     can still be rejected by the host. Do not extend this function to "detect
 *     everything"; it is a best-effort tripwire, not a Rust-regex validator.
 */
function findHostUnsupportedRegexConstruct(pattern: string): string | null {
	if (pattern.includes("(?<=")) return "lookbehind ((?<=...))";
	if (pattern.includes("(?<!")) return "negative lookbehind ((?<!...))";
	if (pattern.includes("(?=")) return "lookahead ((?=...))";
	if (pattern.includes("(?!")) return "negative lookahead ((?!...))";
	if (pattern.includes("\\k<")) return "named backreference (\\k<...>)";
	return null;
}

/**
 * Validates a pattern string against the same rules `compile_pattern` enforces on the
 * host: within the length cap, and compilable. Also flags (but does not reject) the
 * JS/Rust regex-dialect gap above, since a pattern using one of those constructs is still
 * a valid JS `RegExp` — it is USABLE here, just not on the host.
 *
 * Returns whether the pattern is usable in JS (i.e. whether the caller should keep the
 * value); the dialect-gap warning does not affect this — it is reported as an additional
 * issue alongside a `true` result.
 */
function checkHostPattern(
	name: string,
	field: string,
	pattern: string,
	issues: CatalogIssue[],
): boolean {
	if (pattern.length > MAX_CONNECTION_PATTERN_LEN) {
		issues.push({
			connection: name,
			field,
			message: `${field} pattern exceeds max length (${MAX_CONNECTION_PATTERN_LEN})`,
		});
		return false;
	}
	try {
		new RegExp(pattern);
	} catch (error) {
		issues.push({
			connection: name,
			field,
			message: `${field} invalid pattern: ${error instanceof Error ? error.message : String(error)}`,
		});
		return false;
	}
	const unsupported = findHostUnsupportedRegexConstruct(pattern);
	if (unsupported) {
		issues.push({
			connection: name,
			field,
			message:
				`${field} uses ${unsupported}, which JavaScript's RegExp accepts but the host's Rust ` +
				"regex engine does not support (no lookaround or backreferences) — the host will " +
				"refuse to run this connection even though it parses here",
		});
	}
	return true;
}

/** Reads `probe.expect`: a string, within the length cap, and a compilable pattern. A
 * non-string or unusable `expect` must not silently degrade to "no expect at all" — that
 * would weaken readiness to exit-code-only, exactly the case the Rust parser's doc comment
 * calls out (an interface that exists but is DOWN still exits zero). */
function readOptionalPatternField(
	name: string,
	field: string,
	raw: unknown,
	issues: CatalogIssue[],
): string | undefined {
	const value = readOptionalStringField(name, field, raw, issues);
	if (value === undefined) return undefined;
	return checkHostPattern(name, field, value, issues) ? value : undefined;
}

/**
 * Reads `notices`: an array of `{ pattern, message }` rules. Mirrors the Rust parser's
 * validation exactly (a non-array block, a non-object entry, a missing/non-string
 * `pattern` or `message`, an over-length or uncompilable `pattern`, and more than
 * `MAX_CONNECTION_NOTICES` entries all fail `parse_one` on the host) but REPORTS every
 * problem instead of aborting at the first one — same posture as the rest of this file.
 *
 * `notices` is cosmetic on the host ("a missed notice never changes an outcome" — see the
 * Rust doc comment), so it is validated here for parity but deliberately NOT exposed on
 * `DeclaredConnection`: this task's interface has no field for it, and surfacing the
 * validation result is the point, not carrying the payload around.
 */
function readNoticesField(name: string, raw: unknown, issues: CatalogIssue[]): void {
	if (raw === undefined || raw === null) return;
	if (!Array.isArray(raw)) {
		issues.push({
			connection: name,
			field: "notices",
			message: "notices must be an array of rules",
		});
		return;
	}
	if (raw.length > MAX_CONNECTION_NOTICES) {
		// Report the cap violation but still validate every entry below — same "never
		// silently drop information" doctrine as the top-level MAX_CONNECTIONS cap: the
		// operator sees every problem at once, not just the first one that tripped a limit.
		issues.push({
			connection: name,
			field: "notices",
			message: `too many notice rules (max ${MAX_CONNECTION_NOTICES})`,
		});
	}
	for (let i = 0; i < raw.length; i += 1) {
		const entry: unknown = raw[i];
		if (!isPlainObject(entry)) {
			issues.push({
				connection: name,
				field: `notices[${i}]`,
				message: `notices[${i}] must be an object with 'pattern' and 'message'`,
			});
			continue;
		}
		const pattern = entry.pattern;
		if (typeof pattern !== "string") {
			issues.push({
				connection: name,
				field: `notices[${i}].pattern`,
				message: `notices[${i}].pattern is required and must be a string`,
			});
		} else {
			checkHostPattern(name, `notices[${i}].pattern`, pattern, issues);
		}
		const message = entry.message;
		if (typeof message !== "string") {
			issues.push({
				connection: name,
				field: `notices[${i}].message`,
				message: `notices[${i}].message is required and must be a string`,
			});
		}
	}
}

function readEnvField(
	name: string,
	raw: unknown,
	issues: CatalogIssue[],
): Record<string, string> {
	if (raw === undefined || raw === null) return {};
	if (!isPlainObject(raw)) {
		issues.push({ connection: name, field: "env", message: "env must be an object of strings" });
		return {};
	}
	const out: Record<string, string> = {};
	for (const [key, value] of Object.entries(raw)) {
		if (typeof value !== "string") {
			// A dropped entry changes the environment the command would run in, so it is
			// reported — but the rest of `env` is still usable, so every other entry is
			// still kept. This is the report/skip posture; the Rust parser fails the
			// whole declaration instead.
			issues.push({ connection: name, field: "env", message: `env['${key}'] must be a string` });
			continue;
		}
		out[key] = value;
	}
	return out;
}

function readProbeField(
	name: string,
	raw: unknown,
	issues: CatalogIssue[],
): ConnectionProbe {
	if (raw === undefined || raw === null) {
		issues.push({
			connection: name,
			field: "probe",
			message: "probe is required — readiness is decided by a probe, not by output",
		});
		return { run: [] };
	}
	if (!isPlainObject(raw)) {
		issues.push({ connection: name, field: "probe", message: "probe must be an object" });
		return { run: [] };
	}

	const run = readStringArrayField(name, "probe.run", raw.run, issues);
	if (run.length === 0) {
		issues.push({
			connection: name,
			field: "probe.run",
			message: "probe.run must be a non-empty array of strings",
		});
	} else {
		// Reject shell wrappers by BINARY NAME, ignoring any directory, so `/bin/sh` is
		// caught as well as `sh`. Mirrors the Rust parser's rule exactly: it is caught
		// here rather than left to run and silently smuggle a shell back in.
		const binary = path.basename(run[0]!);
		if (SHELL_LIKE.has(binary)) {
			issues.push({
				connection: name,
				field: "probe.run",
				message:
					`probe must not invoke a shell ('${binary}') — use structured argv with an ` +
					"'expect' pattern. A future probe.shell + probe.reason can declare that intent " +
					"and ask the operator to grant it; it is not supported yet.",
			});
		}
	}

	// D1c: a composing probe must ASK, never be silently allowed. Declaring `probe.shell`
	// today names the decision instead of downgrading it to a silent "not up", which would
	// read as a broken tunnel rather than a withheld permission.
	if (raw.shell !== undefined) {
		issues.push({
			connection: name,
			field: "probe.shell",
			message:
				"probe.shell requires an operator grant, which is not implemented yet — use " +
				"structured probe.run with expect for now",
		});
	}

	const expect = readOptionalPatternField(name, "probe.expect", raw.expect, issues);
	return expect === undefined ? { run } : { run, expect };
}

function readOptionalNonNegativeIntegerField(
	name: string,
	field: string,
	raw: unknown,
	fallback: number,
	issues: CatalogIssue[],
): number {
	if (raw === undefined || raw === null) return fallback;
	if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 0) {
		// A non-integer value must not silently fall back to the default, which reads as
		// "my timeout is being honoured" when it is not — but the report still needs a
		// usable number, so the default is used AND the problem is recorded.
		issues.push({ connection: name, field, message: `${field} must be a non-negative integer` });
		return fallback;
	}
	return raw;
}

function readProbeIntervalField(name: string, raw: unknown, issues: CatalogIssue[]): number {
	if (raw === undefined || raw === null) return DEFAULT_PROBE_INTERVAL_MS;
	if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 0) {
		issues.push({
			connection: name,
			field: "probeIntervalMs",
			message: "probeIntervalMs must be a non-negative integer",
		});
		return DEFAULT_PROBE_INTERVAL_MS;
	}
	if (raw === 0) {
		issues.push({
			connection: name,
			field: "probeIntervalMs",
			message: "probeIntervalMs must be greater than 0",
		});
		return DEFAULT_PROBE_INTERVAL_MS;
	}
	return raw;
}

function readLingerField(
	name: string,
	raw: unknown,
	issues: CatalogIssue[],
): DeclaredConnection["linger"] {
	if (raw === undefined || raw === null) return "operator";
	if (raw === "operator") return "operator";
	if (isPlainObject(raw)) {
		const idleMs = raw.idleMs;
		if (typeof idleMs === "number" && Number.isInteger(idleMs) && idleMs >= 0) {
			if (idleMs === 0) return { idleMs: 0 };
			// A non-zero idle window PARSES today and then does nothing: there is no idle
			// sweeper yet, only `{ idleMs: 0 }` (fall as soon as the last claim releases)
			// is wired up. Accepting it silently would make the operator believe the
			// connection falls after the window when it never does — the same failure
			// mode the Rust parser loudly refuses for `prompts`, `ready`/`fail` and
			// `probe.shell`. Falls back to the safe default ("stay up") for the report.
			issues.push({
				connection: name,
				field: "linger",
				message:
					`linger.idleMs = ${idleMs} is not implemented yet — there is no idle sweeper. Use ` +
					'"operator" (stay up) or { "idleMs": 0 } (fall as soon as the last claim is released).',
			});
			return "operator";
		}
	}
	issues.push({
		connection: name,
		field: "linger",
		message: 'linger must be "operator" or { idleMs: <number> }',
	});
	return "operator";
}

function parseOne(
	name: string,
	rawValue: unknown,
): { connection: DeclaredConnection; issues: CatalogIssue[] } {
	const issues: CatalogIssue[] = [];

	if (name.length === 0 || name.length > MAX_CONNECTION_NAME_LEN) {
		issues.push({
			connection: name,
			field: "name",
			message: `connection name '${name}' has invalid length`,
		});
	}

	const value = isPlainObject(rawValue) ? rawValue : {};
	if (!isPlainObject(rawValue)) {
		issues.push({
			connection: name,
			field: "connection",
			message: "connection declaration must be an object",
		});
	}

	// A leftover `ready`/`fail` from an earlier config shape must be reported loudly:
	// half-honouring it would look like output still decides readiness when the probe
	// now does.
	for (const legacy of ["ready", "fail"] as const) {
		if (value[legacy] !== undefined) {
			issues.push({
				connection: name,
				field: legacy,
				message: `\`${legacy}\` is no longer supported — readiness is decided by \`probe\``,
			});
		}
	}

	// A prompt rule needs an answer path, which does not exist yet. Accepting it silently
	// would let a login hang forever waiting for an answer nobody can give.
	if (value.prompts !== undefined) {
		issues.push({
			connection: name,
			field: "prompts",
			message: "prompts are not supported yet — remove the `prompts` block",
		});
	}

	const establish = readStringArrayField(name, "establish", value.establish, issues);
	if (establish.length === 0) {
		issues.push({
			connection: name,
			field: "establish",
			message: "establish must be a non-empty array of strings",
		});
	}

	const probe = readProbeField(name, value.probe, issues);
	readNoticesField(name, value.notices, issues);
	const env = readEnvField(name, value.env, issues);
	const cwd = readOptionalStringField(name, "cwd", value.cwd, issues);
	const readyTimeoutMs = readOptionalNonNegativeIntegerField(
		name,
		"readyTimeoutMs",
		value.readyTimeoutMs,
		DEFAULT_READY_TIMEOUT_MS,
		issues,
	);
	const probeIntervalMs = readProbeIntervalField(name, value.probeIntervalMs, issues);
	const linger = readLingerField(name, value.linger, issues);

	return {
		connection: { name, establish, probe, env, cwd, readyTimeoutMs, probeIntervalMs, linger },
		issues,
	};
}

/**
 * Read the `connections` block from a config object. Pure — the caller supplies `config`
 * via `loadConfig()`; this never touches the filesystem.
 *
 * Unlike the Rust parser this never fails: an absent block is an empty catalog (same as
 * Rust), and a malformed block or declaration is reported in `issues` while every declared
 * connection still appears in `connections` — the operator surface exists so a broken
 * declaration can be DEBUGGED, not hidden behind a thrown error.
 */
export function readConnectionCatalog(config: Record<string, unknown>): {
	connections: DeclaredConnection[];
	issues: CatalogIssue[];
} {
	const block = config.connections;
	if (block === undefined || block === null) {
		return { connections: [], issues: [] };
	}
	if (!isPlainObject(block)) {
		return {
			connections: [],
			issues: [
				{ connection: CATALOG_LEVEL_ISSUE, field: "connections", message: "connections must be an object" },
			],
		};
	}

	const entries = Object.entries(block);
	const issues: CatalogIssue[] = [];
	if (entries.length > MAX_CONNECTIONS) {
		// Report the cap violation but still process every entry below — the doctrine
		// here is "never silently drop a declared connection", even one over the cap.
		issues.push({
			connection: CATALOG_LEVEL_ISSUE,
			field: "connections",
			message: `too many connections declared (max ${MAX_CONNECTIONS})`,
		});
	}

	const connections: DeclaredConnection[] = [];
	for (const [name, rawValue] of entries) {
		const parsed = parseOne(name, rawValue);
		connections.push(parsed.connection);
		issues.push(...parsed.issues);
	}
	return { connections, issues };
}

function isExecutableFile(candidate: string): boolean {
	try {
		const stat = fs.statSync(candidate);
		if (!stat.isFile()) return false;
		fs.accessSync(candidate, fsConstants.X_OK);
		return true;
	} catch {
		// A missing path, an unreadable directory, or a permissions error are all
		// "cannot resolve" here — this function is a probe over the filesystem, not a
		// claim that the file SHOULD exist.
		return false;
	}
}

/**
 * Resolve a declared `argv[0]` to an absolute, executable path — or `null`. Never throws:
 * a missing PATH, an unreadable directory, or a permissions error all collapse to "cannot
 * resolve". This distinction is load-bearing for the caller: "the probe said no" (a
 * resolved binary ran and reported the connection down) is a different operator action
 * than "I could not even ask" (the binary itself is missing), and only `resolveBinary`
 * returning `null` tells the caller it's the latter.
 *
 * An argv0 containing a path separator (`./bin`, `sub/dir/bin`, `/usr/bin/true`) is
 * resolved as a path, exactly like `child_process.spawn` treats it — never searched on
 * PATH. A bare name is searched across `PATH`, in order, stopping at the first match.
 */
export function resolveBinary(argv0: string, env?: NodeJS.ProcessEnv): string | null {
	try {
		if (!argv0) return null;
		if (argv0.includes(path.sep) || path.isAbsolute(argv0)) {
			const candidate = path.resolve(argv0);
			return isExecutableFile(candidate) ? candidate : null;
		}
		const pathVar = (env ?? process.env).PATH;
		if (!pathVar) return null;
		for (const dir of pathVar.split(path.delimiter)) {
			if (!dir) continue;
			const candidate = path.join(dir, argv0);
			if (isExecutableFile(candidate)) return candidate;
		}
		return null;
	} catch {
		return null;
	}
}
