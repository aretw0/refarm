export type BaseSurfaceState =
	| "ready"
	| "degraded"
	| "blocked"
	| "unavailable"
	| "unknown";

export type BaseSurfaceSeverity = "info" | "warning" | "failure";

export interface BaseSurfaceEvidence {
	kind: string;
	label: string;
	value: string;
}

export interface BaseSurfaceAction {
	id?: string;
	label: string;
	command: string;
	intent?: string;
	payload?: Record<string, unknown>;
	primary?: boolean;
}

export interface BaseSurfaceUnit {
	id: string;
	label: string;
	owner: string;
	state: BaseSurfaceState;
	severity: BaseSurfaceSeverity;
	summary: string;
	evidence: BaseSurfaceEvidence[];
	actions: BaseSurfaceAction[];
	details?: Record<string, unknown>;
}

interface CommandHandoffLike {
	ok?: boolean;
	nextAction?: string | null;
	nextActions?: string[];
	nextCommand?: string | null;
	nextCommands?: string[];
	recommendations?: RecommendationLike[];
}

interface RecommendationLike {
	summary?: string;
	action?: string;
	command?: string;
	severity?: BaseSurfaceSeverity;
	target?: string;
	diagnostic?: string;
	issueType?: string;
}

interface RuntimeLike extends CommandHandoffLike {
	command?: string;
	operation?: string;
	configuredEngine?: string;
	activeEngine?: string;
	ready?: boolean;
	sidecarUrl?: string;
	sidecarProbe?: {
		url?: string;
		ready?: boolean;
		status?: number;
		error?: string;
		timedOut?: boolean;
	};
	startCommand?: string;
	issue?: string;
}

interface ModelLike extends CommandHandoffLike {
	command?: string;
	operation?: string;
	current?: {
		ref?: string;
		provider?: string;
		modelId?: string;
	};
	credential?: {
		state?: string;
		status?: string | null;
		envKey?: string;
	};
	routes?: Record<string, unknown>;
	source?: unknown;
}

interface HealthLike extends CommandHandoffLike {
	command?: string;
	operation?: string;
	issueCount?: number;
}

export interface BaseSurfaceModelInput {
	runtime?: RuntimeLike;
	model?: ModelLike;
	health?: HealthLike;
	units?: BaseSurfaceUnit[];
}

export interface BaseSurfaceModelOptions {
	owner?: string;
	command?: string;
	operation?: string;
}

export interface BaseSurfaceModel {
	schemaVersion: 1;
	command: string;
	operation: string;
	ok: boolean;
	units: BaseSurfaceUnit[];
	nextAction: string | null;
	nextActions: string[];
	nextCommand: string | null;
	nextCommands: string[];
}

export interface CapabilitySurfaceRegistryLike {
	list(): Array<{ name: string }>;
}

export interface CapabilitySurfaceUnitOptions {
	owner: string;
	id?: string;
	label?: string;
	subject?: string;
	noun?: string;
	action?: BaseSurfaceAction;
	details?: Record<string, unknown>;
}

export interface ReviewQueueSurfaceUnitContext {
	total: number;
	pending: number;
	totalLabel: string;
	pendingLabel: string;
}

export interface ReviewQueueSurfaceUnitOptions {
	id: string;
	label: string;
	owner: string;
	total: number;
	pending: number;
	totalLabel: string;
	pendingLabel: string;
	readySummary?: string | ((context: ReviewQueueSurfaceUnitContext) => string);
	pendingSummary?: string | ((context: ReviewQueueSurfaceUnitContext) => string);
	pendingAction?: BaseSurfaceAction;
	details?: Record<string, unknown>;
}

export interface BaseSurfaceTextFormatOptions {
	title?: string;
}

export function buildBaseSurfaceModel(
	input: BaseSurfaceModelInput,
	options: BaseSurfaceModelOptions = {},
): BaseSurfaceModel {
	const owner = options.owner ?? "@refarm.dev/operator-state";
	const units = [
		input.runtime ? runtimeUnit(input.runtime, owner) : undefined,
		input.model ? modelUnit(input.model, owner) : undefined,
		input.health ? healthUnit(input.health, owner) : undefined,
		...(input.units ?? []),
	].filter((unit): unit is BaseSurfaceUnit => unit !== undefined);
	const nextActions = dedupe([
		...nextActionsFromHandoff(input.runtime),
		...nextActionsFromHandoff(input.model),
		...nextActionsFromHandoff(input.health),
		...units.flatMap((unit) => unit.actions.map((action) => action.label)),
	]);
	const nextCommands = dedupe([
		...nextCommandsFromHandoff(input.runtime),
		...nextCommandsFromHandoff(input.model),
		...nextCommandsFromHandoff(input.health),
		...units.flatMap((unit) => unit.actions.map((action) => action.command)),
	]);

	return {
		schemaVersion: 1,
		command: options.command ?? "status",
		operation: options.operation ?? "base",
		ok: units.every((unit) => unit.severity !== "failure"),
		units,
		nextAction: nextActions[0] ?? null,
		nextActions,
		nextCommand: nextCommands[0] ?? null,
		nextCommands,
	};
}

export function buildCapabilitySurfaceUnit(
	registry: CapabilitySurfaceRegistryLike,
	options: CapabilitySurfaceUnitOptions,
): BaseSurfaceUnit {
	const names = registry.list().map((entry) => entry.name);
	const noun = options.noun ?? "capability verbs";
	return {
		id: options.id ?? "capabilities",
		label: options.label ?? "Capabilities",
		owner: options.owner,
		state: "ready",
		severity: "info",
		summary: `${options.subject ?? options.label ?? "Registry"} mounts ${names.length} ${noun}.`,
		evidence: [
			{ kind: "count", label: "verbs", value: String(names.length) },
			{ kind: "state", label: "mounted", value: names.join(", ") },
		],
		actions: options.action ? [options.action] : [],
		details: { capabilityNames: names, ...(options.details ?? {}) },
	};
}

export function buildReviewQueueSurfaceUnit(
	options: ReviewQueueSurfaceUnitOptions,
): BaseSurfaceUnit {
	const context: ReviewQueueSurfaceUnitContext = {
		total: options.total,
		pending: options.pending,
		totalLabel: options.totalLabel,
		pendingLabel: options.pendingLabel,
	};
	const hasPending = options.pending > 0;
	return {
		id: options.id,
		label: options.label,
		owner: options.owner,
		state: hasPending ? "degraded" : "ready",
		severity: hasPending ? "warning" : "info",
		summary: renderReviewQueueSummary(
			hasPending ? options.pendingSummary : options.readySummary,
			context,
			hasPending,
			options.label,
		),
		evidence: [
			{ kind: "count", label: options.totalLabel, value: String(options.total) },
			{ kind: "count", label: options.pendingLabel, value: String(options.pending) },
		],
		actions: hasPending && options.pendingAction ? [options.pendingAction] : [],
		details: options.details,
	};
}

export function formatBaseSurfaceModelText(
	model: BaseSurfaceModel,
	options: BaseSurfaceTextFormatOptions = {},
): string {
	const lines = [options.title ?? `${model.command} ${model.operation} status`, ""];
	for (const unit of model.units) {
		lines.push(`${unit.label}: ${unit.summary}`);
		for (const evidence of unit.evidence) {
			lines.push(`  ${evidence.label}: ${evidence.value}`);
		}
	}
	if (model.nextCommands.length > 0) {
		lines.push("", "next:");
		for (const command of model.nextCommands) {
			lines.push(`  ${command}`);
		}
	}
	return `${lines.join("\n")}\n`;
}

function renderReviewQueueSummary(
	template: ReviewQueueSurfaceUnitOptions["readySummary"],
	context: ReviewQueueSurfaceUnitContext,
	hasPending: boolean,
	label: string,
): string {
	if (typeof template === "function") return template(context);
	if (template) return template;
	if (hasPending) {
		return `${label} has ${context.total} ${context.totalLabel}; ${context.pending} ${context.pendingLabel}.`;
	}
	return `${label} has ${context.total} ${context.totalLabel}.`;
}

function runtimeUnit(runtime: RuntimeLike, owner: string): BaseSurfaceUnit {
	const ready = runtime.ready === true;
	const blocked =
		runtime.ready === false || runtime.ok === false || Boolean(runtime.issue);
	const evidence: BaseSurfaceEvidence[] = [];
	if (runtime.activeEngine) {
		evidence.push({ kind: "state", label: "engine", value: runtime.activeEngine });
	}
	if (runtime.sidecarUrl) {
		evidence.push({ kind: "route", label: "sidecar", value: runtime.sidecarUrl });
	}
	if (runtime.sidecarProbe?.error) {
		evidence.push({
			kind: "probe",
			label: "sidecar probe",
			value: runtime.sidecarProbe.error,
		});
	} else if (runtime.sidecarProbe?.status !== undefined) {
		evidence.push({
			kind: "probe",
			label: "sidecar probe",
			value: String(runtime.sidecarProbe.status),
		});
	}
	if (runtime.startCommand) {
		evidence.push({
			kind: "command",
			label: "start command",
			value: runtime.startCommand,
		});
	}

	return {
		id: "runtime",
		label: "Runtime",
		owner,
		state: blocked ? "blocked" : ready ? "ready" : "unknown",
		severity: blocked ? "failure" : "info",
		summary: blocked
			? "Runtime sidecar is not ready."
			: ready
				? "Runtime sidecar is ready."
				: "Runtime readiness is unknown.",
		evidence,
		actions: actionsFromHandoff(runtime),
		details: {
			configuredEngine: runtime.configuredEngine,
			activeEngine: runtime.activeEngine,
			ready: runtime.ready,
			sidecarProbe: runtime.sidecarProbe,
		},
	};
}

function modelUnit(model: ModelLike, owner: string): BaseSurfaceUnit {
	const missingCredential = model.credential?.state === "missing";
	const ref = model.current?.ref ?? "unknown";
	return {
		id: "model",
		label: "Model",
		owner,
		state: missingCredential ? "blocked" : "ready",
		severity: missingCredential ? "failure" : "info",
		summary: missingCredential
			? "Model route is missing credentials."
			: "Model route is configured.",
		evidence: [
			{ kind: "route", label: "current", value: ref },
			...(model.credential?.status
				? [
						{
							kind: "state",
							label: "credential",
							value: model.credential.status,
						},
					]
				: []),
		],
		actions: actionsFromHandoff(model),
		details: {
			current: model.current,
			credential: model.credential,
			routes: model.routes,
			source: model.source,
		},
	};
}

function healthUnit(health: HealthLike, owner: string): BaseSurfaceUnit {
	const issueCount = health.issueCount ?? 0;
	const blocked = health.ok === false || issueCount > 0;
	return {
		id: "health",
		label: "Health",
		owner,
		state: blocked ? "blocked" : "ready",
		severity: blocked ? "failure" : "info",
		summary: blocked
			? `Workspace health has ${issueCount} blocking issue${issueCount === 1 ? "" : "s"}.`
			: "Workspace health has no blocking issues.",
		evidence: [
			{ kind: "count", label: "issues", value: String(issueCount) },
			...firstRecommendationEvidence(health.recommendations ?? []),
		],
		actions: actionsFromHandoff(health),
		details: {
			issueCount,
			recommendations: health.recommendations ?? [],
		},
	};
}

function firstRecommendationEvidence(
	recommendations: RecommendationLike[],
): BaseSurfaceEvidence[] {
	const first = recommendations[0];
	if (!first) return [];
	return [
		...(first.summary
			? [{ kind: "state", label: "recommendation", value: first.summary }]
			: []),
		...(first.target
			? [{ kind: "path", label: "target", value: first.target }]
			: []),
	];
}

function actionsFromHandoff(handoff: CommandHandoffLike): BaseSurfaceAction[] {
	const commands = nextCommandsFromHandoff(handoff);
	const actions = nextActionsFromHandoff(handoff);
	return commands.map((command, index) => ({
		label: actions[index] ?? command,
		command,
		...(index === 0 ? { primary: true } : {}),
	}));
}

function nextActionsFromHandoff(handoff?: CommandHandoffLike): string[] {
	if (!handoff) return [];
	return dedupe([
		...(handoff.nextAction ? [handoff.nextAction] : []),
		...(handoff.nextActions ?? []),
	]);
}

function nextCommandsFromHandoff(handoff?: CommandHandoffLike): string[] {
	if (!handoff) return [];
	return dedupe([
		...(handoff.nextCommand ? [handoff.nextCommand] : []),
		...(handoff.nextCommands ?? []),
	]);
}

function dedupe(values: string[]): string[] {
	const result: string[] = [];
	for (const value of values) {
		const trimmed = value.trim();
		if (!trimmed || result.includes(trimmed)) continue;
		result.push(trimmed);
	}
	return result;
}
