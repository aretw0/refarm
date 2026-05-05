export const NON_REUSABLE_STATUSES = new Set(["cancelled", "stale", "neutral"]);

export const FAILURE_STATUSES = new Set([
	"failure",
	"timed_out",
	"startup_failure",
	"action_required",
]);

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
				level: "warning",
				text: `Gate '${gate.key}' was skipped and no prior executed result was found.`,
			});
		}
	}

	return { hasFailure, messages };
}
