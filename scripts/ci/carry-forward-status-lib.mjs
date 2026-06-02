export const NON_REUSABLE_STATUSES = new Set(["cancelled", "stale", "neutral"]);

export const FAILURE_STATUSES = new Set([
	"failure",
	"timed_out",
	"startup_failure",
	"action_required",
]);

function envFlag(env, name) {
	return env[name] === "true";
}

export function buildSkippedGateDefinitions(env = process.env) {
	const codeChanges = envFlag(env, "CODE_CHANGES");
	const definitions = [
		{
			key: "quality_security",
			skip: false,
			type: "step",
			job: "quality",
			stepNames: ["Security audit"],
		},
		{
			key: "quality_tsconfig",
			skip: false,
			type: "step",
			job: "quality",
			stepNames: ["TSConfig preflight"],
		},
		{
			key: "quality_verify_full_turbo",
			skip: false,
			type: "step",
			job: "quality",
			stepNames: ["Verify (Full Turbo)", "Verify (Full Turbo fallback)"],
		},
		{
			key: "task_smoke_core",
			skip: codeChanges && !envFlag(env, "RUN_TASK_SMOKE"),
			type: "step",
			job: "quality",
			stepNames: ["Farmhand task execution smoke (CLI ↔ sidecar)"],
		},
		{
			key: "task_smoke_pi_agent",
			skip: codeChanges && !envFlag(env, "RUN_TASK_SMOKE"),
			type: "step",
			job: "quality",
			stepNames: ["Farmhand pi-agent respond smoke (effort round-trip)"],
		},
		{
			key: "tractor_health_probe",
			skip: codeChanges && !envFlag(env, "TRACTOR_GATES"),
			type: "step",
			job: "quality",
			stepNames: ["Tractor health probe smoke"],
		},
		{
			key: "tractor_runtime_module",
			skip: codeChanges && !envFlag(env, "TRACTOR_GATES"),
			type: "step",
			job: "quality",
			stepNames: ["Browser runtime descriptor gate (Tractor TS)"],
		},
		{
			key: "tractor_release_smoke",
			skip: codeChanges && !envFlag(env, "TRACTOR_GATES"),
			type: "step",
			job: "quality",
			stepNames: ["Runtime descriptor release-path smoke (Tractor TS)"],
		},
		{
			key: "tractor_revocation_report",
			skip: codeChanges && !envFlag(env, "TRACTOR_GATES"),
			type: "step",
			job: "quality",
			stepNames: ["Revocation diagnostics report smoke (Tractor TS)"],
		},
		{
			key: "tractor_revocation_baseline",
			skip: codeChanges && !envFlag(env, "TRACTOR_GATES"),
			type: "step",
			job: "quality",
			stepNames: ["Revocation diagnostics baseline lookup (Tractor TS)"],
		},
		{
			key: "tractor_revocation_history",
			skip: codeChanges && !envFlag(env, "TRACTOR_GATES"),
			type: "step",
			job: "quality",
			stepNames: ["Revocation diagnostics history smoke (Tractor TS)"],
		},
		{
			key: "tractor_benchmark_gate",
			skip: codeChanges && !envFlag(env, "TRACTOR_GATES"),
			type: "step",
			job: "quality",
			stepNames: ["Benchmark Quality Gate (Tractor)"],
		},
		{
			key: "tractor_coverage_gate",
			skip: codeChanges && !envFlag(env, "TRACTOR_GATES"),
			type: "step",
			job: "quality",
			stepNames: ["Coverage Quality Gate (Tractor)"],
		},
		{
			key: "audit_moderate",
			skip: !envFlag(env, "RUN_AUDIT"),
			type: "job",
			job: "audit-moderate",
		},
		{
			key: "build",
			skip: !envFlag(env, "RUN_BUILD"),
			type: "job",
			job: "build",
		},
		{
			key: "e2e",
			skip: !envFlag(env, "RUN_E2E"),
			type: "job",
			job: "e2e",
		},
		{
			key: "deep_regression",
			skip: !envFlag(env, "RUN_DEEP"),
			type: "job",
			job: "deep-regression",
		},
	];
	return definitions.filter((gate) => gate.skip);
}

export function resolveGateFromJobs(gate, run, jobs, options = {}) {
	const nonReusableStatuses =
		options.nonReusableStatuses || NON_REUSABLE_STATUSES;
	const job = jobs.find((item) => item.name === gate.job);
	if (!job) return null;

	if (gate.type === "job") {
		if (job.conclusion && job.conclusion !== "skipped") {
			if (nonReusableStatuses.has(job.conclusion)) return null;
			return { status: job.conclusion, sourceUrl: run.html_url || "" };
		}
		return null;
	}

	const step = (job.steps || []).find((item) =>
		(gate.stepNames || []).includes(item.name),
	);
	if (step && step.conclusion && step.conclusion !== "skipped") {
		if (nonReusableStatuses.has(step.conclusion)) return null;
		return { status: step.conclusion, sourceUrl: run.html_url || "" };
	}
	return null;
}

export async function collectCarryForwardResults({
	tracked,
	candidates,
	getJobs,
	resolveGate = resolveGateFromJobs,
}) {
	const results = new Map();
	for (const run of candidates) {
		const unresolved = tracked.filter((gate) => !results.has(gate.key));
		if (unresolved.length === 0) break;

		const jobs = await getJobs(run);
		for (const gate of unresolved) {
			const resolved = resolveGate(gate, run, jobs);
			if (resolved) {
				results.set(gate.key, resolved);
			}
		}
	}
	return results;
}

export function evaluateCarryForwardResults({
	tracked,
	results,
	failureStatuses = FAILURE_STATUSES,
}) {
	const messages = [];
	let hasFailure = false;

	for (const gate of tracked) {
		const resolved = results.get(gate.key) || {
			status: "unknown",
			sourceUrl: "",
		};
		const status = resolved.status;
		const sourceUrl = resolved.sourceUrl;

		if (failureStatuses.has(status)) {
			hasFailure = true;
			messages.push({
				level: "error",
				text: `Gate '${gate.key}' was skipped; reusing prior failing status '${status}' (${sourceUrl}).`,
			});
			continue;
		}

		if (status === "success") {
			messages.push({
				level: "notice",
				text: `Gate '${gate.key}' was skipped; reused prior success (${sourceUrl}).`,
			});
		} else {
			messages.push({
				level: "log",
				text: `Gate '${gate.key}' was skipped and no prior executed result was found.`,
			});
		}
	}

	return { hasFailure, messages };
}
