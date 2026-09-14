// Connection doctor findings — turns Task 1's declared connection catalog into
// `refarm doctor` warnings, so a declared connection that cannot be trusted to answer
// "are you up?" is surfaced WITHOUT the operator needing to already suspect a problem
// and run `refarm connection status` themselves.
//
// This exists for the failure the whole plan is closing: the operator's VPN dropped
// while they were away, a supervisor burned approval pushes at an absent human, and the
// tunnel sat down with nothing saying so. `refarm connection status` (Task 2) gave the
// operator a way to ASK. This gives refarm a way to TELL, unprompted, at the next
// `refarm doctor` run.
//
// Only two shapes of problem are worth a finding here, and both mean the same thing:
// the probe cannot be trusted to answer at all.
//   - a declared `establish` or `probe` binary that does not resolve on PATH/as a path
//   - any catalog issue Task 1's `readConnectionCatalog` reports (a shell probe, a
//     missing probe, a non-zero idle linger, and so on — every field it validates)
//
// An EMPTY catalog produces NO findings: an absent declaration is not a defect, and a
// doctor that nags about a feature nobody declared trains the operator to ignore it —
// see the Task 3 brief. Severity is always `warning`, never `failure`: a missing
// connection binary does not make the host unusable, and `refarm doctor`'s failures
// gate other flows.
//
// Pure over a config object, exactly like `readConnectionCatalog` — this never touches
// the filesystem itself, so every test drives it with a literal and none can reach the
// real `.refarm/config.json`.

import { readConnectionCatalog, resolveBinary, type CatalogIssue } from "./connection-catalog.js";
import type { RefarmDoctorRecommendation } from "./doctor.js";

/** The one command that answers "is it actually up?" for every declared connection —
 * the natural next step after a doctor finding names a connection as unrunnable. */
const CONNECTION_STATUS_NEXT_COMMAND = "refarm connection status --json";

function missingBinaryRecommendation(
	connectionName: string,
	role: "establish" | "probe",
	argv0: string,
): RefarmDoctorRecommendation {
	return {
		diagnostic: `connection:binary-missing:${connectionName}:${role}`,
		severity: "warning",
		summary: `Connection '${connectionName}' declares a ${role} binary that does not resolve: '${argv0}'.`,
		action:
			`Install '${argv0}' where refarm can reach it, or fix PATH, or update the connection's ` +
			`${role} declaration in .refarm/config.json.`,
		command: CONNECTION_STATUS_NEXT_COMMAND,
	};
}

/**
 * `connection:field` alone is NOT unique: one connection can collect several issues on the
 * same field (two malformed `env` entries, several bad `probe.run` args). Identical
 * diagnostic ids would render as duplicate warnings AND double-count `warningCount` in
 * `buildRefarmDoctorReport`, which appends every recommendation's id to `warnings`
 * un-deduped. The ordinal is per (connection, field) group so an unrelated field gaining
 * an issue does not renumber this one.
 */
function catalogIssueRecommendation(
	issue: CatalogIssue,
	ordinal: number,
): RefarmDoctorRecommendation {
	return {
		diagnostic: `connection:catalog-issue:${issue.connection}:${issue.field}:${ordinal}`,
		severity: "warning",
		summary: `Connection '${issue.connection}' has a declaration issue (${issue.field}): ${issue.message}`,
		action: "Fix the connection declaration in .refarm/config.json, then re-run connection status.",
		command: CONNECTION_STATUS_NEXT_COMMAND,
	};
}

/**
 * Build `refarm doctor` findings from a declared connection catalog. Pure — the caller
 * supplies `config` (the same object `loadConfig()` returns; see
 * `readConnectionCatalog`'s doc comment for why this never reads the filesystem
 * itself). Reuses Task 1's `readConnectionCatalog` and `resolveBinary` rather than
 * re-implementing catalog parsing or binary resolution.
 */
export function buildConnectionDoctorRecommendations(
	config: Record<string, unknown>,
): RefarmDoctorRecommendation[] {
	const { connections, issues } = readConnectionCatalog(config);
	const recommendations: RefarmDoctorRecommendation[] = [];

	for (const connection of connections) {
		// An empty `establish`/`probe.run` is already reported as a catalog issue below —
		// checking `resolveBinary` against argv0 of an empty array would either throw on
		// `undefined` or (worse) silently report a SECOND, redundant finding for the same
		// root cause, so binary resolution is only attempted when there is an argv0 to
		// resolve at all.
		if (connection.establish.length > 0) {
			const argv0 = connection.establish[0]!;
			if (resolveBinary(argv0) === null) {
				recommendations.push(missingBinaryRecommendation(connection.name, "establish", argv0));
			}
		}
		if (connection.probe.run.length > 0) {
			const argv0 = connection.probe.run[0]!;
			if (resolveBinary(argv0) === null) {
				recommendations.push(missingBinaryRecommendation(connection.name, "probe", argv0));
			}
		}
	}

	const seenPerField = new Map<string, number>();
	for (const issue of issues) {
		const key = `${issue.connection}:${issue.field}`;
		const ordinal = (seenPerField.get(key) ?? 0) + 1;
		seenPerField.set(key, ordinal);
		recommendations.push(catalogIssueRecommendation(issue, ordinal));
	}

	return recommendations;
}
