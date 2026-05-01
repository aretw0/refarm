import type {
	Effort,
	EffortConformanceResult,
	EffortTransportAdapter,
} from "./types.js";

function nowIso(): string {
	return new Date().toISOString();
}

export async function runEffortV1Conformance(
	adapter: EffortTransportAdapter,
): Promise<EffortConformanceResult> {
	const failures: string[] = [];

	const effort: Effort = {
		id: `conformance-${Date.now()}`,
		direction: "Conformance test effort",
		tasks: [
			{
				id: `task-${Date.now()}`,
				pluginId: "test-plugin",
				fn: "noop",
				args: {},
			},
		],
		source: "conformance",
		submittedAt: nowIso(),
	};

	let effortId: string | undefined;

	try {
		effortId = await adapter.submit(effort);
		if (!effortId) failures.push("submit() returned empty effortId");
	} catch (error) {
		failures.push(`submit() threw: ${String(error)}`);
	}

	if (effortId) {
		await new Promise((resolve) => setTimeout(resolve, 100));

		try {
			const result = await adapter.query(effortId);
			if (result !== null) {
				if (result.effortId !== effortId) {
					failures.push("query() returned wrong effortId");
				}

				if (
					!["pending", "in-progress", "done", "failed"].includes(result.status)
				) {
					failures.push(`query() returned invalid status: ${result.status}`);
				}
			}
		} catch (error) {
			failures.push(`query() threw: ${String(error)}`);
		}
	}

	const failed = failures.length;
	return { pass: failed === 0, total: 3, failed, failures };
}
