import { readFileSync, readlinkSync } from "node:fs";
import { SOVEREIGN_BASE_KEY, SOVEREIGN_DIR_SELECTOR_KEY } from "@refarm.dev/config";

/**
 * What the RUNNING node was actually told, read from its own `/proc/<pid>/environ` — not
 * reconstructed from what the CLI's own shell happens to have set.
 *
 * This module exists because `refarm context`'s `base:` line reads as the node's but is the
 * CLI's: a CLI invoked from one directory and a daemon started from another can disagree
 * about `SOVEREIGN_BASE`, and nothing before this said so. `../utils/loaded-plugin.ts` solved
 * the identical problem for `--plugin` by reading the process's own argv instead of
 * reconstructing a path; this reads the process's own environment instead of reconstructing
 * a value from the CLI's `process.env`. Same idiom, same posture: injectable reader, pure
 * parser, `null` on failure rather than a throw.
 *
 * `null` on a FIELD and `null` from the FUNCTION mean different things and must not collapse:
 *  - A field is `null` when the node declares that variable NOWHERE. That is a real finding —
 *    it means the node FELL BACK rather than being told. Verified on this machine: before
 *    `scripts/tractor-start.sh` was fixed, the daemon carried `REFARM_HOME` and
 *    `SOVEREIGN_DIR` and no `SOVEREIGN_BASE` at all.
 *  - The function returns `null` when the process could not be read at all — no environ, no
 *    finding possible about any field.
 */
export interface NodeEnvironment {
	/** What `SOVEREIGN_BASE_KEY` (`@refarm.dev/config`) resolves to in the node's own
	 *  environment — i.e. whether the node was TOLD its base. `null` means the node declares
	 *  no base in its environ; it does NOT mean the node falls back to its own cwd — the
	 *  Rust host never derives its base from cwd (see `dirs_sovereign_base` in
	 *  `packages/tractor/src/main.rs`: `REFARM_HOME` or the OS home dir, never
	 *  `/proc/<pid>/cwd`), and settles the actual value with `std::env::set_var` AFTER this
	 *  process was exec'd — invisible to a later read of this same environ. The node's
	 *  actual, settled base is `node.json`'s `declarationBase` (`./node-descriptor.ts`), not
	 *  this field; this field only answers whether the node was told or had to derive it
	 *  (see `../commands/context.ts`'s header, final fix wave 2026-08-06). */
	base: string | null;
	/** What `SOVEREIGN_DIR_SELECTOR_KEY` (`@refarm.dev/config`) resolves to. `null` means the
	 *  node declares no sovereign dir selector at all. */
	sovereignDir: string | null;
	/** `REFARM_HOME` as the node itself declares it. `null` means undeclared — the node falls
	 *  back to `~/.refarm` (see `resolveRefarmHome`). Not read from a `@refarm.dev/config`
	 *  constant: unlike `SOVEREIGN_BASE`/`SOVEREIGN_DIR`, the config package does not export a
	 *  name for it; `REFARM_HOME` here matches the literal `refarm-home.ts` already reads. */
	home: string | null;
	/** `REFARM_NAMESPACE` as the node itself declares it. `null` means undeclared — the node
	 *  falls back to `"default"` (see `resolveTractorNamespace`). Same literal-key note as
	 *  `home` above: no exported constant exists for this name either. */
	namespace: string | null;
	/** The node's own working directory (`/proc/<pid>/cwd`), or `null` when it could not be
	 *  read. Independent of the fields above: an unreadable cwd does not discard an
	 *  otherwise-readable environ (see `resolveNodeEnvironment`'s doc). */
	cwd: string | null;
}

export interface NodeEnvironmentDeps {
	readEnviron?(pid: number): string | null;
	readCwd?(pid: number): string | null;
}

/**
 * Parse the NUL-separated `KEY=value` shape /proc/<pid>/environ actually produces. Splits on
 * NUL bytes; an entry with no `=` is ignored rather than treated as a key with an invented
 * empty value (`BROKEN` is not `BROKEN=""`). A value MAY itself contain `=`, so only the
 * FIRST `=` splits key from value.
 */
export function parseProcEnviron(raw: string): Record<string, string> {
	const result: Record<string, string> = {};
	for (const entry of raw.split("\0")) {
		if (entry === "") continue;
		const eq = entry.indexOf("=");
		if (eq === -1) continue;
		result[entry.slice(0, eq)] = entry.slice(eq + 1);
	}
	return result;
}

function defaultReadEnviron(pid: number): string | null {
	try {
		return readFileSync(`/proc/${pid}/environ`, "utf8");
	} catch {
		return null;
	}
}

function defaultReadCwd(pid: number): string | null {
	try {
		// /proc/<pid>/cwd is a symlink to the process's working directory, not a regular
		// file — reading its target, not its (nonexistent) contents.
		return readlinkSync(`/proc/${pid}/cwd`);
	} catch {
		return null;
	}
}

/**
 * What the node at `pid` was actually told, or `null` when the process could not be read at
 * all (gone, no permission). A field being `null` inside a non-null result is a DIFFERENT
 * thing — see `NodeEnvironment`'s doc — and this function is careful never to let the two
 * collapse: an unreadable `cwd` alone does not turn the whole result `null`, and an
 * undeclared variable is reported `null` rather than omitted or defaulted.
 */
export function resolveNodeEnvironment(pid: number, deps: NodeEnvironmentDeps = {}): NodeEnvironment | null {
	const readEnviron = deps.readEnviron ?? defaultReadEnviron;
	const readCwd = deps.readCwd ?? defaultReadCwd;

	const raw = readEnviron(pid);
	if (raw === null) return null;

	const parsed = parseProcEnviron(raw);
	return {
		base: parsed[SOVEREIGN_BASE_KEY] ?? null,
		sovereignDir: parsed[SOVEREIGN_DIR_SELECTOR_KEY] ?? null,
		home: parsed.REFARM_HOME ?? null,
		namespace: parsed.REFARM_NAMESPACE ?? null,
		cwd: readCwd(pid),
	};
}
