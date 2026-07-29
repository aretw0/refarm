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

// ── The host's SPAWN-TIME policy guards ──────────────────────────────────────
//
// The Rust parser above (`connection_decl.rs`) is only the first gate. Before the host
// actually spawns anything — `run_probe` -> `spawn_process`, and `spawn_establish_process`
// for the establish argv — it runs three more guards in
// `host_effects_bridge/core.rs` + `policy_and_fs.rs`: `enforce_shell_allowlist`,
// `enforce_spawn_env` and `enforce_spawn_cwd`. All three return `Err` BEFORE the process
// exists, and `run_probe` swallows that error into `false`.
//
// So a declaration that violates any of them is PERMANENTLY down on the host, while this
// CLI — which spawns through Node, not through those guards — would spawn it happily and
// report `up`. That lie runs the dangerous way round: the operator is told the tunnel is
// fine when the engine can never even ask. The constants and checks below mirror the
// deterministic, LEXICAL half of those guards so the same declaration is refused here.
//
// What is deliberately NOT mirrored, and why:
//   - The SENSITIVE-KEY blocklist (`is_blocked_spawn_env_key` ->
//     `host::sensitive_aliases`). That table is ~2000 lines of alias/prefix/suffix policy
//     that the host evolves on its own schedule. A copy of it here would be its own drift:
//     it would go stale silently and start disagreeing with the host in BOTH directions
//     (missing a newly-blocked key, or blocking one the host has since allowed) — the exact
//     failure this whole file exists to prevent. So a declaration whose `env` names a
//     sensitive key (an auth token, a credential alias) passes THIS check and is still
//     refused by the host: `connection status` can report `up` for it while the engine
//     reports `down`. Closing that needs the host to EXPORT its policy (a WIT query or a
//     generated table), not a second hand-written copy. Same posture as the regex-dialect
//     gap documented on `findHostUnsupportedRegexConstruct`.
//   - The ENVIRONMENTAL half of `enforce_spawn_cwd`: that the directory exists, is a
//     directory, and lies inside `MODEL_FS_ROOT`. Those depend on the filesystem and on a
//     host env var, and `readConnectionCatalog` is pure over a config object by contract
//     (see its doc comment) — a config that is fine on the host's machine must not be
//     reported as broken here just because this process cannot see the path. A missing
//     `cwd` surfaces instead as `unknown` at probe time (the spawn error path), which is
//     the honest answer: "I could not ask."
//   - The shell ALLOWLIST membership itself (`policy.shell_allowlist()`): host policy read
//     from the sovereign config at runtime, not a lexical property of the declaration.

/** Mirrors `MAX_SPAWN_ARGV_COUNT` in `host_effects_bridge/core.rs`. */
const MAX_SPAWN_ARGV_COUNT = 128;
/** Mirrors `MAX_SPAWN_ARG_LEN` — per-entry, in BYTES (Rust `str::len()`). */
const MAX_SPAWN_ARG_LEN = 4096;
/** Mirrors `MAX_SPAWN_ARGV_TOTAL_BYTES`. */
const MAX_SPAWN_ARGV_TOTAL_BYTES = 64 * 1024;
/** Mirrors `MAX_SHELL_TOKEN_LEN`, applied by `enforce_shell_allowlist_with` to argv[0]. */
const MAX_SHELL_TOKEN_LEN = 256;
/** Mirrors `MAX_SPAWN_ENV_VARS`. */
const MAX_SPAWN_ENV_VARS = 128;
/** Mirrors `MAX_SPAWN_ENV_KEY_LEN`. */
const MAX_SPAWN_ENV_KEY_LEN = 128;
/** Mirrors `MAX_SPAWN_ENV_VALUE_LEN`. */
const MAX_SPAWN_ENV_VALUE_LEN = 4096;
/** Mirrors `MAX_SPAWN_ENV_TOTAL_BYTES`. */
const MAX_SPAWN_ENV_TOTAL_BYTES = 128 * 1024;
/** Mirrors `MAX_SPAWN_CWD_LEN`. */
const MAX_SPAWN_CWD_LEN = 4096;

/**
 * `is_safe_spawn_env_key`'s charset rule: an ASCII letter or `_`, then ASCII
 * alphanumerics or `_`. Anchored, so it also rejects control characters and whitespace —
 * the two checks the Rust helper makes separately before the charset walk.
 */
const SAFE_SPAWN_ENV_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Rust's `str::len()` is BYTES, not UTF-16 code units — a multi-byte name, pattern, arg
 * or env value must be judged by the same ruler the host uses, or a declaration passes
 * here and is refused there (or vice versa). */
function byteLength(value: string): number {
	return Buffer.byteLength(value, "utf8");
}

/** Rust's `str::is_ascii()`: every byte below 0x80. */
function isAscii(value: string): boolean {
	for (let i = 0; i < value.length; i += 1) {
		if (value.charCodeAt(i) > 0x7f) return false;
	}
	return true;
}

/** Rust's `char::is_control()`: the Unicode `Cc` general category. */
function containsControlChars(value: string): boolean {
	return /\p{Cc}/u.test(value);
}

/** Rust's `char::is_whitespace()`: the Unicode `White_Space` property. `String.trim()`
 * is close but not identical (it also strips U+FEFF and misses U+0085), so both the
 * "surrounding" and the "any" whitespace checks go through this one property. */
function containsWhitespace(value: string): boolean {
	return /\p{White_Space}/u.test(value);
}

function hasSurroundingWhitespace(value: string): boolean {
	return (
		value.length > 0 &&
		(containsWhitespace(value[0]!) || containsWhitespace(value[value.length - 1]!))
	);
}

/**
 * Mirrors `enforce_shell_allowlist_with` + `enforce_spawn_argv_within_limits` (the
 * declaration-lexical half). Applied to BOTH `establish` and `probe.run`, because both
 * argvs reach the same guard on the host: `spawn_establish_process` and `run_probe` each
 * call `enforce_shell_allowlist` before spawning.
 *
 * An empty argv is not reported here — `parseOne`/`readProbeField` already report that,
 * and a second issue for one root cause is noise, not information.
 */
function checkSpawnArgv(name: string, field: string, argv: string[], issues: CatalogIssue[]): void {
	if (argv.length === 0) return;
	if (argv.length > MAX_SPAWN_ARGV_COUNT) {
		issues.push({
			connection: name,
			field,
			message: `${field} has too many entries (max ${MAX_SPAWN_ARGV_COUNT}) — the host refuses to spawn it`,
		});
	}

	// argv[0] carries the stricter rules: the host treats it as the binary token, not as
	// data, so it must be ASCII, whitespace- and control-free, and within the shell-token
	// length cap. Trailing/leading whitespace is its own error there because a padded
	// binary name silently resolves to a DIFFERENT (usually nonexistent) file.
	const binary = argv[0]!;
	if (binary.trim().length === 0) {
		issues.push({
			connection: name,
			field,
			message: `${field}[0] must be a non-empty binary name — the host refuses to spawn it`,
		});
	} else if (hasSurroundingWhitespace(binary)) {
		issues.push({
			connection: name,
			field,
			message: `${field}[0] has surrounding whitespace — the host refuses to spawn it`,
		});
	} else if (containsControlChars(binary)) {
		issues.push({
			connection: name,
			field,
			message: `${field}[0] contains control characters — the host refuses to spawn it`,
		});
	} else if (containsWhitespace(binary)) {
		issues.push({
			connection: name,
			field,
			message:
				`${field}[0] contains whitespace — a binary and its arguments must be separate ` +
				"argv entries; the host refuses to spawn it",
		});
	} else if (!isAscii(binary)) {
		issues.push({
			connection: name,
			field,
			message: `${field}[0] must be ASCII — the host refuses to spawn it`,
		});
	} else if (byteLength(binary) > MAX_SHELL_TOKEN_LEN) {
		issues.push({
			connection: name,
			field,
			message: `${field}[0] exceeds max length (${MAX_SHELL_TOKEN_LEN} bytes) — the host refuses to spawn it`,
		});
	}

	let totalBytes = 0;
	for (let i = 0; i < argv.length; i += 1) {
		const entry = argv[i]!;
		if (byteLength(entry) > MAX_SPAWN_ARG_LEN) {
			issues.push({
				connection: name,
				field,
				message: `${field}[${i}] exceeds max length (${MAX_SPAWN_ARG_LEN} bytes) — the host refuses to spawn it`,
			});
		} else if (i > 0 && !isAscii(entry)) {
			issues.push({
				connection: name,
				field,
				message: `${field}[${i}] must be ASCII — the host refuses to spawn it`,
			});
		} else if (i > 0 && containsControlChars(entry)) {
			issues.push({
				connection: name,
				field,
				message: `${field}[${i}] contains control characters — the host refuses to spawn it`,
			});
		}
		totalBytes += byteLength(entry);
	}
	if (totalBytes > MAX_SPAWN_ARGV_TOTAL_BYTES) {
		issues.push({
			connection: name,
			field,
			message: `${field} payload exceeds max total bytes (${MAX_SPAWN_ARGV_TOTAL_BYTES}) — the host refuses to spawn it`,
		});
	}
}

/**
 * Mirrors `enforce_spawn_cwd_with`'s lexical half. The existence / is-a-directory /
 * inside-`MODEL_FS_ROOT` half is deliberately NOT mirrored — see the block comment on the
 * spawn-guard constants above for why.
 */
function checkSpawnCwd(name: string, cwd: string, issues: CatalogIssue[]): void {
	const push = (message: string): void => {
		issues.push({ connection: name, field: "cwd", message });
	};
	if (cwd.trim().length === 0) {
		push("cwd must be non-empty — the host refuses to spawn with it");
		return;
	}
	if (hasSurroundingWhitespace(cwd)) {
		push("cwd has surrounding whitespace — the host refuses to spawn with it");
		return;
	}
	if (byteLength(cwd) > MAX_SPAWN_CWD_LEN) {
		push(`cwd exceeds max length (${MAX_SPAWN_CWD_LEN} bytes) — the host refuses to spawn with it`);
		return;
	}
	if (!isAscii(cwd)) {
		push("cwd must be ASCII — the host refuses to spawn with it");
		return;
	}
	if (containsControlChars(cwd)) {
		push("cwd contains control characters — the host refuses to spawn with it");
		return;
	}
	if (containsWhitespace(cwd)) {
		push("cwd must not contain whitespace — the host refuses to spawn with it");
	}
}

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
	if (byteLength(pattern) > MAX_CONNECTION_PATTERN_LEN) {
		issues.push({
			connection: name,
			field,
			message: `${field} pattern exceeds max length (${MAX_CONNECTION_PATTERN_LEN} bytes)`,
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

function readEnvField(name: string, raw: unknown, issues: CatalogIssue[]): Record<string, string> {
	if (raw === undefined || raw === null) return {};
	if (!isPlainObject(raw)) {
		issues.push({ connection: name, field: "env", message: "env must be an object of strings" });
		return {};
	}
	const entries = Object.entries(raw);
	if (entries.length > MAX_SPAWN_ENV_VARS) {
		issues.push({
			connection: name,
			field: "env",
			message: `env declares too many variables (max ${MAX_SPAWN_ENV_VARS}) — the host refuses to spawn with it`,
		});
	}

	const out: Record<string, string> = {};
	// Mirrors `enforce_spawn_env`'s duplicate check, which normalizes with
	// `to_ascii_uppercase`. JSON object keys are already unique by exact string, so this
	// only ever fires for keys that differ ONLY in case (`Path` vs `PATH`) — which the
	// host rejects outright rather than letting the platform pick a winner.
	const seenUppercase = new Map<string, string>();
	let totalBytes = 0;
	for (const [key, value] of entries) {
		if (typeof value !== "string") {
			// A dropped entry changes the environment the command would run in, so it is
			// reported — but the rest of `env` is still usable, so every other entry is
			// still kept. This is the report/skip posture; the Rust parser fails the
			// whole declaration instead.
			issues.push({ connection: name, field: "env", message: `env['${key}'] must be a string` });
			continue;
		}

		const upper = key.toUpperCase();
		const previous = seenUppercase.get(upper);
		if (previous !== undefined) {
			issues.push({
				connection: name,
				field: "env",
				message: `env declares duplicate keys '${previous}' and '${key}' (the host compares them case-insensitively) — it refuses to spawn with them`,
			});
		} else {
			seenUppercase.set(upper, key);
		}

		if (!SAFE_SPAWN_ENV_KEY.test(key) || byteLength(key) > MAX_SPAWN_ENV_KEY_LEN) {
			issues.push({
				connection: name,
				field: "env",
				message:
					`env key '${key}' is not a valid spawn env key — it must match ` +
					`[A-Za-z_][A-Za-z0-9_]* and stay within ${MAX_SPAWN_ENV_KEY_LEN} bytes; ` +
					"the host refuses to spawn with it",
			});
		}

		// Value rules, in the host's own order — first problem wins per value, then the
		// next variable is still checked (report posture; the host returns on the first).
		if (byteLength(value) > MAX_SPAWN_ENV_VALUE_LEN) {
			issues.push({
				connection: name,
				field: "env",
				message: `env['${key}'] exceeds max length (${MAX_SPAWN_ENV_VALUE_LEN} bytes) — the host refuses to spawn with it`,
			});
		} else if (hasSurroundingWhitespace(value)) {
			issues.push({
				connection: name,
				field: "env",
				message: `env['${key}'] has surrounding whitespace — the host refuses to spawn with it`,
			});
		} else if (!isAscii(value)) {
			issues.push({
				connection: name,
				field: "env",
				message: `env['${key}'] must be ASCII — the host refuses to spawn with it`,
			});
		} else if (containsControlChars(value)) {
			issues.push({
				connection: name,
				field: "env",
				message: `env['${key}'] contains control characters — the host refuses to spawn with it`,
			});
		} else if (containsWhitespace(value)) {
			issues.push({
				connection: name,
				field: "env",
				message: `env['${key}'] must not contain whitespace — the host refuses to spawn with it`,
			});
		}

		totalBytes += byteLength(key) + byteLength(value);
		out[key] = value;
	}

	if (totalBytes > MAX_SPAWN_ENV_TOTAL_BYTES) {
		issues.push({
			connection: name,
			field: "env",
			message: `env payload exceeds max total bytes (${MAX_SPAWN_ENV_TOTAL_BYTES}) — the host refuses to spawn with it`,
		});
	}
	return out;
}

function readProbeField(name: string, raw: unknown, issues: CatalogIssue[]): ConnectionProbe {
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
		// The host applies its spawn-time argv guards to `probe.run` too (`run_probe` ->
		// `spawn_process` -> `enforce_shell_allowlist`), so a violation here means the
		// host's probe can never run — reporting `up` for such a declaration would be the
		// exact CLI-says-up/engine-says-down lie this parity exists to close.
		checkSpawnArgv(name, "probe.run", run, issues);
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

	// Byte length, not `String.length`: the Rust parser measures with `str::len()`, so an
	// accented or emoji-bearing name must be judged by the same ruler on both sides.
	if (name.length === 0 || byteLength(name) > MAX_CONNECTION_NAME_LEN) {
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
	// `spawn_establish_process` runs the same `enforce_shell_allowlist` guard on this argv
	// before the host ever forks, so an argv the host refuses is a connection that can
	// never be brought up — worth reporting even though it does not stop us PROBING.
	checkSpawnArgv(name, "establish", establish, issues);

	const probe = readProbeField(name, value.probe, issues);
	readNoticesField(name, value.notices, issues);
	const env = readEnvField(name, value.env, issues);
	const cwd = readOptionalStringField(name, "cwd", value.cwd, issues);
	if (cwd !== undefined) checkSpawnCwd(name, cwd, issues);
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
				{
					connection: CATALOG_LEVEL_ISSUE,
					field: "connections",
					message: "connections must be an object",
				},
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
