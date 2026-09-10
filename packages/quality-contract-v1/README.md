# @refarm.dev/quality-contract-v1

`quality:v1` is a small contract for declared quality checks. It gives
consumers one envelope for rule profiles, checker results, findings, severities,
and loci while keeping matchers domain-owned.

The contract does not define a taxonomy. Text, UI, diagrams, docs, and future
domains can all use the same profile/report shape while interpreting
`rule.check` with their own checker.

```ts
import {
	createRegexQualityChecker,
	runQualityCheck,
} from "@refarm.dev/quality-contract-v1";

const checker = createRegexQualityChecker();
const report = await runQualityCheck(checker, "generic AI-made conclusion", {
	name: "writing",
	rules: [
		{
			id: "generic-conclusion",
			severity: "warn",
			description: "Avoid generic conclusions.",
			check: { type: "regex", pattern: "generic", flags: "i" },
		},
	],
});
```

The bundled regex checker is a reference implementation for text-like subjects.
UI checkers such as `@refarm.dev/ds/lint` can map their rendered-DOM findings
into the same `quality:v1` report envelope without changing this contract.

## Validating a report you did not produce

A `QualityReport` is a JSON envelope. Any producer can write one — a checker
run in-process, a WASM component, or an engine in another language writing a
file — and a consumer needs one pure function that says whether it holds:

```ts
import { validateQualityReport } from "@refarm.dev/quality-contract-v1";

const { ok, issues } = validateQualityReport(JSON.parse(readFileSync("quality-report.json", "utf8")));
// issues: [{ path: "$.counts.warn", message: "Expected 1 from findings, got 2." }]
```

It checks the capability tag, the identifying strings, every finding's required
fields, and that `counts` is exactly the per-severity tally of `findings`.
`isQualityReport` is the type-guard form. The conformance suite
(`runQualityV1Conformance`) remains the test for a *checker*; this is the test
for a *report*.

