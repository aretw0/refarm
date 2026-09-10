/**
 * THE COLLECTOR.
 *
 * "Every block already knows how to check itself. Nothing ever asks all of them at once."
 * (`docs/superpowers/specs/2026-07-30-hardening-signal-design.md`.) This is the asking.
 *
 * It runs what can be run, normalises the differing result shapes, and classifies every discovered
 * suite into exactly one of the three states H3 requires — never two collapsed into one, and never
 * a fourth invented to avoid an awkward answer.
 */

import { statSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { discoverConformanceSuites, type DiscoveredSuite } from "./discover.js";
import { normaliseConformanceResult } from "./normalise.js";
import { resolveSubject } from "./subjects.js";
import { countEntries, type HardeningEntry, type HardeningSignal } from "./types.js";

export interface CollectOptions {
	workspaceRoot: string;
	/** Discovery is normally the filesystem's answer; tests may hand in their own. */
	suites?: readonly DiscoveredSuite[];
}

type ModuleExports = Record<string, unknown>;

interface LoadedSuite {
	suite: DiscoveredSuite;
	exports: ModuleExports | null;
	loadError: string | null;
}

/** Function source with whitespace flattened: what makes two declarations THE SAME SUITE rather
 *  than two suites that happen to share a name. */
function fingerprint(value: unknown): string | null {
	if (typeof value !== "function") return null;
	return Function.prototype.toString.call(value).replace(/\s+/g, " ").trim();
}

function isVendored(suite: DiscoveredSuite): boolean {
	return path
		.relative(suite.packageDir, suite.sourceFile)
		.split(path.sep)
		.includes("vendor");
}

async function loadSuite(suite: DiscoveredSuite): Promise<LoadedSuite> {
	// Nothing is imported for the two states that are decided from the declaration alone. A module
	// that registers a test suite can call `describe()` at module scope, and importing it to learn
	// what is already known would run that.
	if (suite.declares === "result-shape" || suite.registersTestSuite) {
		return { suite, exports: null, loadError: null };
	}
	if (!suite.module) {
		return {
			suite,
			exports: null,
			loadError: `no loadable module: ${suite.source} is TypeScript outside src/, so nothing maps it onto a built artifact`,
		};
	}
	if (!statSync(suite.module, { throwIfNoEntry: false })?.isFile()) {
		return {
			suite,
			exports: null,
			loadError: suite.buildable
				? `the package is not built — no ${path.basename(suite.module)}. Run \`pnpm --filter ${suite.packageName} run build\`.`
				: `no module at ${suite.module}`,
		};
	}
	try {
		return {
			suite,
			exports: (await import(pathToFileURL(suite.module).href)) as ModuleExports,
			loadError: null,
		};
	} catch (error) {
		return { suite, exports: null, loadError: `importing it threw — ${describe(error)}` };
	}
}

function describe(error: unknown): string {
	return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

/**
 * THE VENDORED COPY, COUNTED ONCE — and the dedup justified rather than asserted.
 *
 * `packages/farm-client/vendor/prompt-contract-v1.mjs` exports `runOperatorChannelConformance`, and
 * so does `packages/prompt-contract-v1`. A naive collector reports two suites and two passes for
 * one contract, which inflates every number it prints.
 *
 * Path convention alone would be a weak reason to merge them — `vendor/` says "a copy", not "an
 * IDENTICAL copy", and a drifted copy is a real second thing that deserves its own line. So the
 * merge requires PROOF: the two runners' function source must be identical once whitespace is
 * flattened (they are, byte for byte — the vendored file is emitted from the same source). The copy
 * defers to the canonical package; the canonical one is what runs.
 *
 * If the vendored copy ever drifts, this stops merging them and the signal grows by one. That is
 * the correct behaviour: a vendored copy that no longer matches its origin is exactly the thing a
 * hardening signal should surface, not hide.
 */
function vendoredDuplicates(loaded: readonly LoadedSuite[]): Map<string, LoadedSuite> {
	const duplicates = new Map<string, LoadedSuite>();
	for (const candidate of loaded) {
		if (!isVendored(candidate.suite)) continue;
		const copyPrint = fingerprint(candidate.exports?.[candidate.suite.runner]);
		if (!copyPrint) continue;
		const canonical = loaded.find(
			(other) =>
				other !== candidate &&
				!isVendored(other.suite) &&
				other.suite.runner === candidate.suite.runner &&
				fingerprint(other.exports?.[other.suite.runner]) === copyPrint,
		);
		if (canonical) duplicates.set(candidate.suite.id, canonical);
	}
	return duplicates;
}

function conformant(suite: DiscoveredSuite, checks: number): HardeningEntry {
	return {
		id: suite.id,
		packageName: suite.packageName,
		runner: suite.runner,
		declares: suite.declares,
		source: suite.source,
		state: "conformant",
		checks,
		failed: 0,
		detail: [],
		fix: null,
		reason: null,
	};
}

function notYetHardened(
	suite: DiscoveredSuite,
	fix: string,
	extra: { checks?: number; failed?: number; detail?: string[] } = {},
): HardeningEntry {
	return {
		id: suite.id,
		packageName: suite.packageName,
		runner: suite.runner,
		declares: suite.declares,
		source: suite.source,
		state: "not-yet-hardened",
		checks: extra.checks ?? 0,
		failed: extra.failed ?? 0,
		detail: extra.detail ?? [],
		fix,
		reason: null,
	};
}

function notApplicable(suite: DiscoveredSuite, reason: string): HardeningEntry {
	return {
		id: suite.id,
		packageName: suite.packageName,
		runner: suite.runner,
		declares: suite.declares,
		source: suite.source,
		state: "not-applicable",
		checks: 0,
		failed: 0,
		detail: [],
		fix: null,
		reason,
	};
}

async function evaluate(loaded: LoadedSuite, duplicateOf: LoadedSuite | undefined): Promise<HardeningEntry> {
	const { suite, exports, loadError } = loaded;

	// A `*ConformanceResult` type whose package exports no runner: a shape with nothing behind it.
	// It is NOT a failure — nothing has been checked and found wanting, there is simply no suite —
	// and reporting it as one would be the H3 mistake in its purest form. (Zero of these exist in
	// this repo today: every one of the 23 declared result shapes has a runner. The design doc
	// measured otherwise on 2026-07-30, so the gap closed between then and now.)
	if (suite.declares === "result-shape") {
		return notApplicable(
			suite,
			`a result shape with no entry point: ${suite.packageName} declares ${suite.runner} but exports no ` +
				`run*Conformance, so there is nothing to run. Declaring one makes it collectable.`,
		);
	}

	if (duplicateOf) {
		return notApplicable(
			suite,
			`vendored copy of ${duplicateOf.suite.packageName}'s suite — the runner's source is identical, ` +
				`so the contract is collected once, at ${duplicateOf.suite.source}`,
		);
	}

	// A module that imports a test framework REGISTERS a suite (describe/it); it returns nothing to
	// collect and only a test runner can execute it. That is a different kind of absent from "not
	// hardened", and saying so is the whole of H3.
	if (suite.registersTestSuite) {
		return notApplicable(
			suite,
			`registers a test-framework suite (describe/it) instead of returning a result — it is executed by ` +
				`\`pnpm --filter ${suite.packageName} run test\`, not collectable here`,
		);
	}

	if (!exports) {
		return notYetHardened(suite, loadError ?? "the module could not be loaded");
	}

	let subject;
	try {
		subject = await resolveSubject(suite, exports);
	} catch (error) {
		return notYetHardened(suite, `building its subject threw — ${describe(error)}`);
	}
	if (!subject.bound) return notYetHardened(suite, subject.fix);

	const runner = exports[suite.runner] as (...args: unknown[]) => unknown;
	let checks = 0;
	let failed = 0;
	const detail: string[] = [];
	for (const invocation of subject.invocations) {
		const prefix = invocation.label ? `${invocation.label}: ` : "";
		let value: unknown;
		try {
			value = await runner(...invocation.args);
		} catch (error) {
			failed += 1;
			checks += 1;
			detail.push(`${prefix}the suite threw — ${describe(error)}`);
			continue;
		}
		const result = normaliseConformanceResult(value);
		if (!result) {
			return notYetHardened(
				suite,
				`it returned a result shape this collector cannot read (${JSON.stringify(value)?.slice(0, 120) ?? typeof value}) — ` +
					`teach packages/hardening/src/normalise.ts to read it`,
			);
		}
		checks += result.checks;
		failed += result.failed;
		detail.push(...result.detail.map((line) => `${prefix}${line}`));
	}

	if (failed === 0) return conformant(suite, checks);
	return notYetHardened(
		suite,
		`${failed} of ${checks} checks fail — fix them in ${suite.source}, or in the implementation it drives (${subject.how})`,
		{ checks, failed, detail },
	);
}

export async function collectHardeningSignal(options: CollectOptions): Promise<HardeningSignal> {
	const suites = options.suites ?? discoverConformanceSuites(options.workspaceRoot);
	const loaded: LoadedSuite[] = [];
	for (const suite of suites) loaded.push(await loadSuite(suite));

	const duplicates = vendoredDuplicates(loaded);
	const entries: HardeningEntry[] = [];
	for (const item of loaded) entries.push(await evaluate(item, duplicates.get(item.suite.id)));

	entries.sort((a, b) => a.packageName.localeCompare(b.packageName) || a.runner.localeCompare(b.runner));
	return { workspaceRoot: options.workspaceRoot, entries, counts: countEntries(entries) };
}
