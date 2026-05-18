import { canTransition } from "@refarm.dev/artefact-contract-v1";
import type { Effort } from "@refarm.dev/effort-contract-v1";
import type {
	Automation,
	AutomationAdapter,
	AutomationBody,
	AutomationFilter,
	AutomationSummary,
	ArtefactStatus,
	EffortTemplate,
} from "./types.js";

export interface InMemoryAutomationOptions {
	/** Default body used when no body is specified on create(). */
	body?: AutomationBody;
	/** Required when using a plugin body — called instead of loading a real plugin. */
	pluginFn?: (input: unknown) => Effort | null;
}

function nowIso(): string {
	return new Date().toISOString();
}

/** Replace {{varName}} placeholders in a string with values from input. */
function interpolate(template: string, input: Record<string, unknown>): string {
	return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) =>
		String(input[key] ?? ""),
	);
}

function bakeEffort(template: EffortTemplate, input: unknown): Effort {
	const inp =
		input !== null && typeof input === "object"
			? (input as Record<string, unknown>)
			: {};
	return {
		id: crypto.randomUUID(),
		submittedAt: nowIso(),
		direction: interpolate(template.direction, inp),
		tasks: template.tasks,
		source: template.source,
		context: template.context,
		priority: template.priority,
		tags: template.tags,
	};
}

export function createInMemoryAutomationAdapter(
	opts: InMemoryAutomationOptions = {},
): AutomationAdapter {
	const store = new Map<string, Automation>();

	const defaultBody: AutomationBody = opts.body ?? {
		type: "static",
		effort: { direction: "in-memory", tasks: [] },
	};

	function transition(id: string, to: ArtefactStatus): Automation {
		const current = store.get(id);
		if (!current) throw new Error(`Automation not found: ${id}`);
		if (!canTransition(current.status, to)) {
			throw new Error(`Invalid transition: ${current.status} → ${to}`);
		}
		const updated: Automation = {
			...current,
			status: to,
			updatedAt: nowIso(),
			...(to === "archived" ? { archivedAt: nowIso() } : {}),
			...(current.revision !== undefined
				? { revision: current.revision + 1 }
				: {}),
		};
		store.set(id, updated);
		return updated;
	}

	return {
		async create(input) {
			const now = nowIso();
			const automation: Automation = {
				id: crypto.randomUUID(),
				status: "draft",
				createdAt: now,
				updatedAt: now,
				...input,
				body: input.body ?? defaultBody,
			};
			store.set(automation.id, automation);
			return automation;
		},

		async get(id) {
			return store.get(id) ?? null;
		},

		async update(id, patch) {
			const current = store.get(id);
			if (!current) throw new Error(`Automation not found: ${id}`);
			const updated: Automation = { ...current, ...patch, updatedAt: nowIso() };
			store.set(id, updated);
			return updated;
		},

		async delete(id) {
			store.delete(id);
		},

		async query(filter?: AutomationFilter) {
			let results = [...store.values()];
			if (filter?.status !== undefined) {
				const statuses = Array.isArray(filter.status)
					? filter.status
					: [filter.status];
				results = results.filter((a) => statuses.includes(a.status));
			}
			if (filter?.tags?.length) {
				results = results.filter((a) =>
					filter.tags!.every((t) => a.tags?.includes(t)),
				);
			}
			return results;
		},

		async validate(id) { return transition(id, "ready"); },
		async activate(id) { return transition(id, "active"); },
		async deactivate(id) { return transition(id, "ready"); },
		async archive(id) { return transition(id, "archived"); },
		async revert(id) { return transition(id, "draft"); },

		async trigger(id, input) {
			const automation = store.get(id);
			if (!automation || automation.status !== "active") return null;

			const { body } = automation;

			if (body.type === "static") {
				return bakeEffort(body.effort, input);
			}

			if (body.type === "template") {
				return bakeEffort(body.effort, input);
			}

			if (body.type === "plugin") {
				if (!opts.pluginFn) {
					throw new Error(
						"pluginFn is required in InMemoryAutomationOptions when using plugin body type",
					);
				}
				return opts.pluginFn(input);
			}

			return null;
		},

		async summary() {
			const all = [...store.values()];
			const s: AutomationSummary = {
				total: all.length,
				draft: 0,
				ready: 0,
				active: 0,
				archived: 0,
			};
			for (const a of all) s[a.status] += 1;
			return s;
		},
	};
}
