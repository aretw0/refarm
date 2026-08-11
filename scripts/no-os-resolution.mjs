#!/usr/bin/env node
/**
 * `no-os-resolution` — the ratchet. Finds every site where this repo resolves "where does
 * this node's state live" by asking the OS where the process happens to be standing, as a
 * SILENT fallback: `= process.cwd()` (a bare assignment or a parameter default) and
 * `?? process.cwd()` / `?? homedir()` (an inline nullish fallback). Forgetting the argument
 * a resolver like this depends on does not raise an error — it silently produces the current
 * directory / the OS home, which is right while developing inside the repo and wrong the
 * moment the process is invoked from anywhere else. Two live instances, both found by
 * running rather than reading (2026-08-05/07): `refarm connection status --json` was
 * invisible from any directory but the repo, and a plugin install wrote the working tree's
 * `agent.wasm` into the operator's REAL `~/.refarm/assets/` because
 * `packages/storage-fs/src/scope.ts` reads `options.userHome ?? homedir()` and never
 * consults the declared home. See docs/NO_OS_RESOLUTION.md for the rule this file enforces.
 *
 * `scanForOsResolution(files)` is PURE — it takes `{ path, content }` file records and
 * returns the offending sites. It never touches the filesystem. `collectScanFiles` (below
 * the "impure edge" marker) is the thin filesystem walk that builds those records for a
 * real repo checkout, and `computeBaseline` composes the two for `no-os-resolution.test.mjs`
 * and this file's own CLI entry point.
 *
 * Usage: `node scripts/no-os-resolution.mjs` — prints the current count, the recorded
 * ratchet ceiling, and the delta (a negative delta is a burn-down slice worth celebrating).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..");

/**
 * THE WHITELIST — exactly two modules may resolve "where is this node's home" by asking the
 * OS. Anything NOT named here is forbidden, so a new resolver module cannot join the center
 * by accident (a BLACKLIST of "known offenders" would let a brand-new file slip through
 * silently; a whitelist cannot). Matched against a file's FULL relative path from the repo
 * root, never a basename — `packages/other/src/refarm-home.ts` (same filename, different
 * package) is NOT allowlisted, and this file's own test pins that distinction directly.
 */
export const ALLOWLISTED_RESOLVER_MODULES = [
	"apps/refarm/src/utils/refarm-home.ts",
	"packages/config/src/index.js",
];

/**
 * PURE. Replaces every `//` line comment and `/* *‍/` block comment with same-length
 * whitespace, preserving every `\n` so line numbers stay aligned. Split out from string
 * masking (`maskStringsAndTemplates`, below) specifically so `findOsModuleBindings` can run
 * on comment-free text that still has its STRING content intact — an import specifier like
 * `"node:os"` is itself a string literal, and a masking pass that blanked strings first would
 * blank the very text that names which module is imported. This is the established shape in
 * this repo for "match code, not comments" — `scripts/ci/check-model-defaults-drift.mjs`'s
 * `stripRustComments` does the same thing for Rust.
 */
export function maskComments(source) {
	let out = "";
	let i = 0;
	const n = source.length;
	while (i < n) {
		const two = source.slice(i, i + 2);
		if (two === "//") {
			while (i < n && source[i] !== "\n") {
				out += " ";
				i++;
			}
			continue;
		}
		if (two === "/*") {
			out += "  ";
			i += 2;
			while (i < n && source.slice(i, i + 2) !== "*/") {
				out += source[i] === "\n" ? "\n" : " ";
				i++;
			}
			if (i < n) {
				out += "  ";
				i += 2;
			}
			continue;
		}
		out += source[i];
		i++;
	}
	return out;
}

/**
 * PURE. Replaces every single/double/backtick string (including template literals —
 * interpolated `${...}` code included, deliberately: see below) with same-length whitespace,
 * preserving every `\n`. Expects comment-free input (`maskComments`'s output) — a `//` or
 * `/* *‍/` still present would have its own quote characters misread as string delimiters.
 *
 * Template literals are masked WHOLESALE, including any `${...}` interpolation — a resolver
 * call used only inside an interpolated expression (e.g. `` `${resolveX(a = process.cwd())}` ``)
 * is therefore invisible to the scan. This is a deliberate, documented gap, not an oversight:
 * the brief this file was built from requires "an occurrence inside a string literal or
 * template literal must NOT count," full stop, and no such interpolated-defect shape exists
 * in this repo today (verified 2026-08-07). A real tokenizer would recurse into `${...}`;
 * this text scanner does not, and undercounts rather than risks a wrong count from a half
 * measure.
 */
export function maskStringsAndTemplates(source) {
	let out = "";
	let i = 0;
	const n = source.length;
	while (i < n) {
		const ch = source[i];
		if (ch === "'" || ch === '"' || ch === "`") {
			const quote = ch;
			out += " ";
			i++;
			while (i < n && source[i] !== quote) {
				if (source[i] === "\\" && i + 1 < n) {
					out += source[i + 1] === "\n" ? " \n" : "  ";
					i += 2;
					continue;
				}
				out += source[i] === "\n" ? "\n" : " ";
				i++;
			}
			if (i < n) {
				out += " ";
				i++;
			}
			continue;
		}
		out += ch;
		i++;
	}
	return out;
}

/** Comments AND strings masked — what the resolver-call scan itself matches against. Import
 * BINDING discovery uses `maskComments` alone (see `findOsModuleBindings`), because it needs
 * the import specifier's string content readable. */
export function maskCommentsAndStrings(source) {
	return maskStringsAndTemplates(maskComments(source));
}

function escapeRegExp(value) {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * PURE. `os.homedir()` can reach a file's text as a member call on a default/namespace
 * import (`import os from "node:os"`, `import * as os from "node:os"`), or as a BARE call on
 * a destructured — and possibly ALIASED — named import (`import { homedir } from "node:os"`,
 * `import { homedir as getHome } from "node:os"`). Reading `homedir(` as text alone cannot
 * tell "the OS resolver" from an unrelated local function that happens to share the name
 * (this file's own test pins that exact false positive) — so this reads the file's OWN
 * `"node:os"` import declaration first, and the scan below only ever treats a bare call as
 * the OS resolver when THIS file's imports actually bind that name to `node:os`. `objectNames`
 * are identifiers a `.homedir()` member call is trusted on; `homedirNames` are identifiers a
 * BARE `()` call is trusted on (the local name after any `as` alias — a scan for the literal
 * word `homedir` would miss `getHome()` entirely, which is exactly the alias case the brief
 * calls out by name).
 *
 * Expects COMMENT-masked but STRING-intact source (`maskComments`'s output, never
 * `maskCommentsAndStrings`'s) — an import mentioned only in a comment must never contribute a
 * binding, but the import specifier `"node:os"` is itself a string literal and must stay
 * readable for this to find it at all.
 */
export function findOsModuleBindings(maskedSource) {
	const objectNames = new Set();
	const homedirNames = new Set();
	const importRe = /import\s+([^;]+?)\s+from\s+["']node:os["']/g;
	for (const match of maskedSource.matchAll(importRe)) {
		const clause = match[1].trim();
		const namedMatch = clause.match(/\{([^}]*)\}/);
		let defaultOrNamespacePart = clause;
		if (namedMatch) {
			defaultOrNamespacePart = clause.slice(0, namedMatch.index).replace(/,\s*$/, "").trim();
			for (const rawPiece of namedMatch[1].split(",")) {
				const piece = rawPiece.trim();
				if (!piece) continue;
				const aliasMatch = piece.match(/^([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/);
				if (aliasMatch) {
					if (aliasMatch[1] === "homedir") homedirNames.add(aliasMatch[2]);
					continue;
				}
				if (piece === "homedir") homedirNames.add("homedir");
			}
		}
		const namespaceMatch = defaultOrNamespacePart.match(/^\*\s+as\s+([A-Za-z_$][\w$]*)$/);
		if (namespaceMatch) {
			objectNames.add(namespaceMatch[1]);
		} else if (/^[A-Za-z_$][\w$]*$/.test(defaultOrNamespacePart)) {
			objectNames.add(defaultOrNamespacePart);
		}
	}
	return { objectNames, homedirNames };
}

/** The alternation of resolver-call TEXT this file's bindings make trustworthy, in a fixed,
 * reported order (process.cwd() first, then every discovered homedir spelling). */
function resolverCallPatterns(bindings) {
	const patterns = ["process\\.cwd\\(\\s*\\)"];
	for (const name of bindings.objectNames) {
		patterns.push(`${escapeRegExp(name)}\\.homedir\\(\\s*\\)`);
	}
	for (const name of bindings.homedirNames) {
		patterns.push(`${escapeRegExp(name)}\\(\\s*\\)`);
	}
	return patterns;
}

function lineNumberAt(text, index) {
	let line = 1;
	for (let i = 0; i < index; i++) {
		if (text[i] === "\n") line++;
	}
	return line;
}

function lineTextAt(text, index) {
	const start = text.lastIndexOf("\n", index - 1) + 1;
	let end = text.indexOf("\n", index);
	if (end === -1) end = text.length;
	return text.slice(start, end).trim();
}

/**
 * PURE. Every offending site in ONE file, ignoring the allowlist (the allowlist is applied
 * by the caller, `scanForOsResolution`, which is the only place that needs to know it).
 *
 * Two shapes, matching the plan this ratchet was built from:
 *   - `"fallback"` — `?? <resolverCall>`, anywhere it appears. Unambiguous: `??` is always a
 *     fallback expression, so no further context check is needed.
 *   - `"default"` — a BARE `=` (never `==`, `!=`, `<=`, `>=`, or `=>` — the negative
 *     lookbehind/lookahead below excludes all five) immediately followed by a resolver call.
 *     This deliberately covers BOTH a true function-signature default
 *     (`function f(root = process.cwd())`) and a destructuring default
 *     (`{ home = homedir() } = {}`, the real shape at packages/farm-client/src/auth.mjs) AND
 *     a plain, unconditional variable assignment (`const x = process.cwd();`) — the last of
 *     those is not "forgettable" the way a parameter default is, but this file's own
 *     Step 5 proof (see no-os-resolution.test.mjs and task-1-report.md) pins exactly that
 *     shape as the offender the ratchet must catch, and the burn-down plan's own Task 2 audits
 *     every flagged site for whether it wanted the node's base or the operator's current
 *     directory regardless of which of these three sub-shapes it is — so this scanner does
 *     not attempt to pre-judge that question by position alone. `= process.env` never
 *     matches here because "process.env" is not one of the resolver-call patterns searched
 *     for at all — excluded BY CONSTRUCTION, not by a second check that could drift.
 *
 * NOT matched (documented gaps, not oversights — see docs/NO_OS_RESOLUTION.md "Known
 * limitations"): `||`-based fallbacks (`context.rootDir || process.cwd()` —
 * packages/health/src/auditors/*.js has several live examples); a resolver call used only
 * inside a template literal's `${...}` interpolation (masked wholesale, see
 * `maskCommentsAndStrings`); and any call reached through means other than a direct member
 * or bare call on a name this file's own `"node:os"` import binds (a re-exported alias from
 * a THIRD module, for instance).
 */
/**
 * THE VOCABULARY — which question a site answers, which is what decides whether reading the OS
 * is a defect. The shape (`?? process.cwd()`) is identical in all four cases; only the question
 * differs, and only the author knows it.
 *
 * These are the SAME words `scripts/directory-independence.mjs` judges by (`scope: "node" |
 * "project"`), on purpose: the consequence probe already knows that a project-scoped command
 * SHOULD answer differently from a different directory — it convicts one that does not. Two
 * instruments measuring the same property in two vocabularies is how this ratchet ended up
 * counting a site that carries five lines of written argument for why it is right (see
 * `doctor.ts`'s `operatorBase`) beside a site that is simply wrong.
 *
 * `verdict` is the whole point: only `node` is debt. The other three are ANSWERS, and an
 * answered site is not a smaller problem — it is not a problem.
 */
export const SITE_PURPOSES = {
	/** "Which project/repo am I in?" The operator's directory IS the question being asked. */
	project: { verdict: "legitimate" },
	/** "What cwd do I hand this child process, or resolve this operator-typed path against?" */
	process: { verdict: "legitimate" },
	/** "Where is the OS ACCOUNT's own home?" (`~/.ssh`, the config-tier co-habitation in
	 *  `composition-resolver.ts`). Legitimate but rare, and the reason must say why the node's
	 *  declared base is the WRONG answer here — otherwise this is `node` wearing a disguise. */
	"os-user": { verdict: "legitimate" },
	/** "Where does THIS NODE's state live?" The defect. Must resolve from `declaredBase()`. */
	node: { verdict: "defect" },
};

/** `// os-resolution: <purpose> — <reason>`. The separator is optional and may be any dash. */
const PURPOSE_MARKER_RE = /os-resolution:\s*([a-z][a-z-]*)\s*(?:[—–-]+\s*)?(.*)$/;

/**
 * PURE. Reads ONE line of raw source and returns what it declares, in three states — never two.
 * A line with no marker is `null` ("nobody has judged this site"), which is categorically
 * different from `{ state: "invalid" }` ("somebody tried and it does not parse"): collapsing
 * them would let a typo'd purpose token read as unclassified debt and quietly rejoin the pile
 * it was meant to leave.
 *
 * A reason of fewer than three words is REJECTED rather than accepted-with-a-shrug. The failure
 * mode this whole mechanism exists to avoid is a judgement that cannot be re-checked by the next
 * reader, and `// os-resolution: project — ok` is that failure mode with extra steps.
 */
export function parsePurposeMarker(line) {
	const match = PURPOSE_MARKER_RE.exec(line);
	if (!match) return null;
	const [, token, rest] = match;
	const reason = rest
		.replace(/\*\/\s*$/, "")
		.trim()
		.replace(/\s+/g, " ");
	if (!Object.hasOwn(SITE_PURPOSES, token)) {
		return { state: "invalid", problem: "unknown-purpose", token, reason };
	}
	if (reason.split(" ").filter(Boolean).length < 3) {
		return { state: "invalid", problem: "no-reason", token, reason };
	}
	return { state: "declared", purpose: token, reason };
}

/** A line that is inside or is a comment — used to walk the contiguous block above a site. */
function isCommentLine(line) {
	const trimmed = line.trim();
	return (
		trimmed.startsWith("//") ||
		trimmed.startsWith("*") ||
		trimmed.startsWith("/*") ||
		trimmed.endsWith("*/")
	);
}

/**
 * PURE. The marker for the site on `lineNumber` (1-based): trailing on the site's own line, or
 * anywhere in the CONTIGUOUS comment block directly above it. The block is walked rather than a
 * fixed one-line lookback because the reasons that already exist in this repo are written inside
 * JSDoc blocks several lines long (`doctor.ts:396-401`), and forcing them to be restated on the
 * line above would duplicate the prose it is the point of this marker to make machine-readable.
 *
 * Walks at most `MAX_BLOCK` lines so a file-header comment cannot silently classify the first
 * site in the file.
 */
export function purposeForSite(lines, lineNumber) {
	const MAX_BLOCK = 14;
	const own = parsePurposeMarker(lines[lineNumber - 1] ?? "");
	if (own) return own;
	for (let i = lineNumber - 2, walked = 0; i >= 0 && walked < MAX_BLOCK; i -= 1, walked += 1) {
		if (!isCommentLine(lines[i])) break;
		const found = parsePurposeMarker(lines[i]);
		if (found) return found;
	}
	return null;
}

export function scanFileForOsResolution(filePath, content) {
	const commentsOnly = maskComments(content);
	const bindings = findOsModuleBindings(commentsOnly);
	const masked = maskStringsAndTemplates(commentsOnly);
	const alternation = `(?:${resolverCallPatterns(bindings).join("|")})`;
	const sites = [];

	const fallbackRe = new RegExp(`\\?\\?\\s*${alternation}`, "g");
	for (const match of masked.matchAll(fallbackRe)) {
		const resolver = match[0].replace(/^\?\?\s*/, "").replace(/\s+/g, "");
		sites.push({
			file: filePath,
			line: lineNumberAt(masked, match.index),
			kind: "fallback",
			resolver,
			snippet: lineTextAt(content, match.index),
		});
	}

	// (?<![=!<>]) excludes ==, !=, <=, >=. The pattern itself (whitespace then a resolver
	// CALL, never a bare ">") excludes =>.
	const defaultRe = new RegExp(`(?<![=!<>])=(?!=)\\s*${alternation}`, "g");
	for (const match of masked.matchAll(defaultRe)) {
		const resolver = match[0].replace(/^=\s*/, "").replace(/\s+/g, "");
		sites.push({
			file: filePath,
			line: lineNumberAt(masked, match.index),
			kind: "default",
			resolver,
			snippet: lineTextAt(content, match.index),
		});
	}

	// Purpose is read from the ORIGINAL content, not the masked copy: masking is what erases
	// comments, and the declaration lives in one. Every site carries a `purpose` key — `null`
	// for "not yet judged" — so no consumer has to distinguish an absent key from an absent
	// judgement.
	const rawLines = content.split("\n");
	for (const site of sites) {
		const declared = purposeForSite(rawLines, site.line);
		site.purpose = declared?.state === "declared" ? declared.purpose : null;
		site.purposeReason = declared?.state === "declared" ? declared.reason : null;
		site.purposeInvalid = declared?.state === "invalid" ? declared : null;
	}

	sites.sort((a, b) => a.line - b.line || a.kind.localeCompare(b.kind));
	return sites;
}

/**
 * PURE. `files` is an array of `{ path, content }`, `path` a POSIX-relative path from the
 * repo root (the impure `collectScanFiles` below guarantees that shape for a real checkout;
 * a test passes literals directly). Returns every offending site across every file EXCEPT the
 * two allowlisted modules, matched by exact relative path — never a basename.
 */
export function scanForOsResolution(files, { allowlist = ALLOWLISTED_RESOLVER_MODULES } = {}) {
	const allowlistSet = new Set(allowlist);
	const sites = [];
	for (const { path: filePath, content } of files) {
		const normalized = filePath.replace(/\\/g, "/");
		if (allowlistSet.has(normalized)) continue;
		sites.push(...scanFileForOsResolution(normalized, content));
	}
	return sites;
}

// ---- Impure edge: everything below touches the filesystem. ----

const WORKSPACE_ROOTS = ["apps", "packages"];
const SOURCE_EXTENSION_RE = /\.(ts|tsx|mts|cts|js|mjs|cjs|jsx)$/;
const TEST_FILE_RE = /\.(test|spec)\.[cm]?[jt]sx?$/;

function isTestFile(name, fullPath) {
	if (TEST_FILE_RE.test(name)) return true;
	const segments = fullPath.split(path.sep);
	return segments.includes("__tests__");
}

function collectFilesRecursive(dir, repoRoot, acc) {
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		if (entry.name === "node_modules" || entry.name === "dist" || entry.name === "dist-web")
			continue;
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			collectFilesRecursive(full, repoRoot, acc);
			continue;
		}
		if (!SOURCE_EXTENSION_RE.test(entry.name)) continue;
		if (isTestFile(entry.name, full)) continue;
		acc.push({
			path: path.relative(repoRoot, full).replace(/\\/g, "/"),
			content: fs.readFileSync(full, "utf8"),
		});
	}
	return acc;
}

/**
 * The impure filesystem walk: every source file under `apps/*‍/src` and `packages/*‍/src`,
 * excluding `dist/`/`dist-web/`/`node_modules/` and test files (`*.test.*`, `*.spec.*`,
 * anything under a `__tests__/` directory) — the exact scope named in the brief this file was
 * built from ("Scan apps/*‍/src and packages/*‍/src. Exclude test files and anything under
 * dist/."). Does NOT scan `examples/*`, `validations/*`, or `templates/*` — out of scope by
 * the same brief, not an oversight.
 */
export function collectScanFiles({ repoRoot = REPO_ROOT } = {}) {
	const files = [];
	for (const workspaceRoot of WORKSPACE_ROOTS) {
		const base = path.join(repoRoot, workspaceRoot);
		if (!fs.existsSync(base)) continue;
		for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
			if (!entry.isDirectory()) continue;
			const srcDir = path.join(base, entry.name, "src");
			if (!fs.existsSync(srcDir)) continue;
			collectFilesRecursive(srcDir, repoRoot, files);
		}
	}
	return files;
}

/**
 * Composes the impure walk with the pure scan for a real checkout. This is what
 * `no-os-resolution.test.mjs`'s ratchet assertion calls, and what this file's own CLI entry
 * point below prints.
 */
/**
 * PURE. Folds sites into the counters the ratchet actually gates on. Split out from
 * `computeBaseline` so the arithmetic is assertable against literal site records, without a
 * filesystem walk — the same shape `summarise` has in `scripts/directory-independence.mjs`.
 *
 * `unclassified` and `invalid` are counted apart. Both are "no usable judgement here", but one
 * is nobody having looked and the other is somebody having looked and mistyped, and a burn-down
 * that reports them as one number cannot tell an untouched pile from a broken declaration.
 */
export function summariseByPurpose(sites) {
	const byPurpose = Object.fromEntries(Object.keys(SITE_PURPOSES).map((name) => [name, 0]));
	let unclassified = 0;
	let invalid = 0;
	for (const site of sites) {
		if (site.purposeInvalid) invalid += 1;
		else if (site.purpose) byPurpose[site.purpose] += 1;
		else unclassified += 1;
	}
	const defect = Object.entries(byPurpose)
		.filter(([name]) => SITE_PURPOSES[name].verdict === "defect")
		.reduce((total, [, count]) => total + count, 0);
	const legitimate = Object.entries(byPurpose)
		.filter(([name]) => SITE_PURPOSES[name].verdict === "legitimate")
		.reduce((total, [, count]) => total + count, 0);
	return { byPurpose, unclassified, invalid, defect, legitimate, total: sites.length };
}

export function computeBaseline({ repoRoot = REPO_ROOT } = {}) {
	const files = collectScanFiles({ repoRoot });
	const sites = scanForOsResolution(files);
	const byKind = { default: 0, fallback: 0 };
	for (const site of sites) byKind[site.kind] = (byKind[site.kind] ?? 0) + 1;
	return {
		sites,
		count: sites.length,
		filesScanned: files.length,
		byKind,
		purposes: summariseByPurpose(sites),
	};
}

/**
 * THE RATCHET CEILING. Recorded 2026-08-07 as THIS SCAN'S OWN count — deliberately NOT the
 * plan's grep estimate (43 signature defaults + 60 inline fallbacks = 103; see
 * task-1-report.md for the measured gap and why it exists: mainly that this scanner's
 * "default" shape is intentionally broader than "parameter default" alone — see
 * `scanFileForOsResolution`'s doc — plus full precision on homedir import bindings, plus the
 * comment/string exclusion actually removing real textual matches, all quantified in the
 * report). Lowered only by an audited burn-down slice (Task 2+ of the plan this file
 * implements) that removes real sites, by exactly the number of sites removed; NEVER raised
 * to make a slice pass — see docs/NO_OS_RESOLUTION.md.
 */
export const BASELINE_MAX_OFFENDING_SITES = 111;

/**
 * THE BURN-DOWN CEILING — sites nobody has judged yet. This is the number a burn-down actually
 * moves, and the reason the one above never moved on purpose: `BASELINE_MAX_OFFENDING_SITES`
 * counts shape, which mixes real debt with sites that are correct and say so, so lowering it
 * required removing code rather than answering a question. Classifying a site lowers THIS one
 * with no behaviour change at all, because the missing thing was the judgement.
 *
 * Falls to 0. It cannot be lowered by accident: a new unjudged site raises it immediately.
 */
export const BASELINE_MAX_UNCLASSIFIED_SITES = 111;

/**
 * A marker that does not parse — an unknown purpose token, or a purpose with no re-checkable
 * reason. Always 0: unlike the two counts above, this is never legacy debt. It can only be
 * introduced by an edit made after this mechanism existed, so it is always fixable now, by the
 * person who just typed it.
 */
export const BASELINE_MAX_INVALID_MARKERS = 0;

function formatReport(baseline) {
	const { count, byKind, filesScanned, purposes } = baseline;
	const delta = count - BASELINE_MAX_OFFENDING_SITES;
	const unclassifiedDelta = purposes.unclassified - BASELINE_MAX_UNCLASSIFIED_SITES;
	const signed = (n) => `${n > 0 ? "+" : ""}${n}`;
	const declared = Object.entries(purposes.byPurpose)
		.filter(([, n]) => n > 0)
		.map(([name, n]) => `${name}=${n}`)
		.join(", ");
	return (
		`no-os-resolution: ${count} site(s) across ${filesScanned} scanned file(s) ` +
		`(default=${byKind.default}, fallback=${byKind.fallback})\n` +
		`  total:        ${count} / ceiling ${BASELINE_MAX_OFFENDING_SITES} · delta ${signed(delta)}\n` +
		`  unclassified: ${purposes.unclassified} / ceiling ${BASELINE_MAX_UNCLASSIFIED_SITES} · delta ${signed(unclassifiedDelta)}` +
		`${unclassifiedDelta < 0 ? " (burn-down — lower BASELINE_MAX_UNCLASSIFIED_SITES to match)" : ""}\n` +
		`  invalid:      ${purposes.invalid} / ceiling ${BASELINE_MAX_INVALID_MARKERS}\n` +
		`  declared:     ${purposes.defect} defect, ${purposes.legitimate} legitimate` +
		`${declared ? ` (${declared})` : ""}\n`
	);
}

/** True when every ceiling holds. Separated from printing so the exit code has one owner. */
function ceilingsHold(purposes, count) {
	return (
		count <= BASELINE_MAX_OFFENDING_SITES &&
		purposes.unclassified <= BASELINE_MAX_UNCLASSIFIED_SITES &&
		purposes.invalid <= BASELINE_MAX_INVALID_MARKERS
	);
}

function main() {
	const baseline = computeBaseline();
	// `--json` exists because a burn-down cannot start from a number. Before this, the ONLY way
	// to see WHICH sites were counted was to import the module and call the pure function by
	// hand, so every slice re-derived the list — and `docs/NO_OS_RESOLUTION.md`'s own burn-down
	// instructions said "read `sites` from `computeBaseline()` directly", which is a document
	// telling its reader to write a script.
	if (process.argv.includes("--json")) {
		process.stdout.write(`${JSON.stringify(baseline, null, 2)}\n`);
	} else if (process.argv.includes("--list")) {
		const only = process.argv.includes("--unclassified");
		for (const site of baseline.sites) {
			if (only && (site.purpose || site.purposeInvalid)) continue;
			const mark = site.purposeInvalid
				? `!${site.purposeInvalid.problem}`
				: (site.purpose ?? "unclassified");
			process.stdout.write(
				`${site.file}:${site.line}\t${mark}\t${site.resolver}\t${site.snippet.trim()}\n`,
			);
		}
	} else {
		process.stdout.write(formatReport(baseline));
	}
	if (!ceilingsHold(baseline.purposes, baseline.count)) process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
	main();
}
