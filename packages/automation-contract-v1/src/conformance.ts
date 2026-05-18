import type { AutomationAdapter, AutomationConformanceResult } from "./types.js";

function makeInput() {
	return {
		name: `conformance-${Date.now()}`,
		body: {
			type: "static" as const,
			effort: { direction: "conformance test effort", tasks: [] },
		},
		triggers: [{ type: "manual" as const }],
	};
}

export async function runAutomationV1Conformance(
	adapter: AutomationAdapter,
): Promise<AutomationConformanceResult> {
	const failures: string[] = [];
	let ran = 0;

	function check(label: string, condition: boolean): void {
		ran++;
		if (!condition) failures.push(label);
	}

	// 1. create() returns Automation with status "draft"
	let automation;
	try {
		automation = await adapter.create(makeInput());
		check(
			"create() returns Automation with status draft",
			automation.status === "draft" &&
				typeof automation.id === "string" &&
				automation.id.length > 0,
		);
	} catch (e) {
		failures.push(`create() threw: ${String(e)}`);
		return { pass: false, total: ran, failed: failures.length, failures };
	}

	// 2. get(unknown) returns null
	try {
		check("get(unknown) returns null", (await adapter.get("__nonexistent__")) === null);
	} catch (e) {
		failures.push(`get(unknown) threw: ${String(e)}`);
	}

	// 3. get(id) returns Automation with correct shape
	try {
		const result = await adapter.get(automation.id);
		check(
			"get(id) returns Automation with correct shape",
			result !== null &&
				typeof result.name === "string" &&
				result.body !== undefined &&
				Array.isArray(result.triggers),
		);
	} catch (e) {
		failures.push(`get(id) threw: ${String(e)}`);
	}

	// 4. validate(draft-id) → ready
	try {
		const result = await adapter.validate(automation.id);
		check("validate() transitions to ready", result.status === "ready");
	} catch (e) {
		failures.push(`validate() threw: ${String(e)}`);
	}

	// 5. activate(ready-id) → active
	try {
		const result = await adapter.activate(automation.id);
		check("activate() transitions to active", result.status === "active");
	} catch (e) {
		failures.push(`activate() threw: ${String(e)}`);
	}

	// 6. trigger(active-id) returns Effort (not null)
	try {
		const effort = await adapter.trigger(automation.id);
		check(
			"trigger(active-id) returns Effort",
			effort !== null &&
				typeof effort.id === "string" &&
				typeof effort.direction === "string",
		);
	} catch (e) {
		failures.push(`trigger(active-id) threw: ${String(e)}`);
	}

	// 7. trigger(non-active-id) returns null
	try {
		const draft = await adapter.create(makeInput());
		check("trigger(non-active-id) returns null", (await adapter.trigger(draft.id)) === null);
	} catch (e) {
		failures.push(`trigger(non-active-id) threw: ${String(e)}`);
	}

	// 8. trigger(unknown-id) returns null
	try {
		check("trigger(unknown-id) returns null", (await adapter.trigger("__nonexistent__")) === null);
	} catch (e) {
		failures.push(`trigger(unknown-id) threw: ${String(e)}`);
	}

	// 9. deactivate(active-id) → ready
	try {
		const result = await adapter.deactivate(automation.id);
		check("deactivate() transitions to ready", result.status === "ready");
	} catch (e) {
		failures.push(`deactivate() threw: ${String(e)}`);
	}

	// 10. revert(ready-id) → draft
	try {
		const result = await adapter.revert(automation.id);
		check("revert() transitions to draft", result.status === "draft");
	} catch (e) {
		failures.push(`revert() threw: ${String(e)}`);
	}

	// 11. archive(id) → archived + archivedAt set
	try {
		const result = await adapter.archive(automation.id);
		check(
			"archive() transitions to archived",
			result.status === "archived" && typeof result.archivedAt === "string",
		);
	} catch (e) {
		failures.push(`archive() threw: ${String(e)}`);
	}

	// 12. delete(id) → get(id) returns null
	try {
		const toDelete = await adapter.create(makeInput());
		await adapter.delete(toDelete.id);
		check("delete() removes automation", (await adapter.get(toDelete.id)) === null);
	} catch (e) {
		failures.push(`delete() threw: ${String(e)}`);
	}

	// 13. summary?() — all numeric fields present
	if (adapter.summary) {
		try {
			const s = await adapter.summary();
			check(
				"summary() has all numeric status fields",
				typeof s.total === "number" &&
					typeof s.draft === "number" &&
					typeof s.ready === "number" &&
					typeof s.active === "number" &&
					typeof s.archived === "number" &&
					s.total >= 1,
			);
		} catch (e) {
			failures.push(`summary() threw: ${String(e)}`);
		}
	}

	// 14. query?() — contains the created automation
	if (adapter.query) {
		try {
			const queryTarget = await adapter.create(makeInput());
			const all = await adapter.query();
			check(
				"query() contains created automation",
				all.some((a) => a.id === queryTarget.id),
			);
		} catch (e) {
			failures.push(`query() threw: ${String(e)}`);
		}
	}

	const failed = failures.length;
	return { pass: failed === 0, total: ran, failed, failures };
}
