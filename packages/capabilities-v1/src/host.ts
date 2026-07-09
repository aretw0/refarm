import {
	createCapabilityRegistry,
	isCapabilityGroup,
	type CapabilityDescriptor,
	type CapabilityEntry,
	type CapabilityEnvelope,
	type CapabilityHooksResolver,
	type CapabilityInput,
	type CapabilityRegistry,
} from "@refarm.dev/cli/capabilities";
import { applicationCommand } from "@refarm.dev/cli/command-handoff";
import { buildJsonSuccessEnvelope } from "@refarm.dev/cli/json-output";
import {
	buildBaseSurfaceModel,
	buildCapabilitySurfaceUnit,
	buildReviewQueueSurfaceUnit,
	createBaseSurfaceActionRequest,
	createBaseSurfaceActionRows,
	type BaseSurfaceAction,
	type BaseSurfaceActionRow,
	type BaseSurfaceModel,
	type BaseSurfaceUnit,
	type CapabilitySurfaceUnitOptions,
	type ReviewQueueSurfaceUnitOptions,
} from "@refarm.dev/operator-state";
import { Command } from "commander";

import type { CapabilityDeps } from "./builtin-capabilities.js";
import {
	mountCapabilities,
	mountedCliCommands,
	serveCapabilities,
} from "./mount.js";
import { createBaseStatusCapability } from "./operator-state-capability.js";
import type {
	PluginDescriptorDeps,
	SurfaceableManifest,
} from "./plugin-bridge.js";
import type { RecordsCommandDeps } from "./records-capability.js";

export interface CapabilityHostCapabilities {
	deps: CapabilityDeps;
	extensions?: CapabilityEntry[];
	manifests?: SurfaceableManifest[];
	pluginDeps?: PluginDescriptorDeps;
	reservedNames?: Iterable<string>;
}

export type CapabilityHostCapabilitiesFactory = () => CapabilityHostCapabilities;

export type CapabilityHostCapabilityUnitOptions = Omit<
	CapabilitySurfaceUnitOptions,
	"owner"
> & { owner?: string };

export type CapabilityHostReviewQueueUnitOptions = Omit<
	ReviewQueueSurfaceUnitOptions,
	"owner"
> & { owner?: string };

export type CapabilityHostRecordReviewQueueUnitOptions = Omit<
	CapabilityHostReviewQueueUnitOptions,
	"total" | "pending"
> & {
	reviewedState: string;
	records?: RecordsCommandDeps;
	pendingCorrection?: CapabilityHostRecordReviewCorrectionOptions;
};

export type CapabilityHostCommandBuilder = (args: string[]) => string;
export type CapabilityHostCapabilityUnitFactory = (
	context: CapabilityHostStatusContext,
) => CapabilityHostCapabilityUnitOptions;

export interface CapabilityHostRecordReviewCorrectionOptions {
	targetState: string;
	actionId?: string;
	label: string;
	intent?: string;
	apply?: boolean;
	primary?: boolean;
	payload?: Record<string, unknown>;
}

export interface CapabilityHostPrimaryVerbOptions
	extends Omit<CapabilityHostCapabilityUnitOptions, "action"> {
	name: string;
	args?: string[];
	actionId?: string;
	actionLabel?: string;
	intent?: string;
	primary?: boolean;
	payload?: Record<string, unknown>;
}

export interface CapabilityHostStatusContext {
	id: string;
	command: string;
	hostCommand: CapabilityHostCommandBuilder;
	registry: CapabilityRegistry;
	capabilities: CapabilityHostCapabilities;
	capabilityUnit(options: CapabilityHostCapabilityUnitOptions): BaseSurfaceUnit;
	reviewQueueUnit(options: CapabilityHostReviewQueueUnitOptions): BaseSurfaceUnit;
	recordReviewQueueUnit(
		options: CapabilityHostRecordReviewQueueUnitOptions,
	): BaseSurfaceUnit;
}

export interface CapabilityHostOperatorStatus {
	name?: string;
	summary?: string;
	httpPath?: string;
	agentToolName?: string;
	primaryVerb?: CapabilityHostPrimaryVerbOptions;
	primaryVerbs?: CapabilityHostPrimaryVerbOptions[];
	capabilityUnit?:
		| false
		| CapabilityHostCapabilityUnitOptions
		| CapabilityHostCapabilityUnitFactory;
	units?: (context: CapabilityHostStatusContext) => BaseSurfaceUnit[];
}

export interface CapabilityHostServeOptions {
	commandName?: string;
	description?: string;
	defaultPort?: number;
	prefix?: string;
	requestTimeoutMs?: number;
}

export interface CapabilityHostSurfaceActionsOptions {
	name?: string;
	summary?: string;
	httpPath?: string;
	agentToolName?: string;
}

export interface CapabilityHostDefinition {
	id: string;
	command: string;
	description: string;
	version?: string;
	capabilities: CapabilityHostCapabilities | CapabilityHostCapabilitiesFactory;
	operatorStatus?: CapabilityHostOperatorStatus;
	hooksFor?: CapabilityHooksResolver;
	serve?: false | CapabilityHostServeOptions;
	surfaceActions?: false | CapabilityHostSurfaceActionsOptions;
}

export interface CapabilityHostServeCallOptions {
	port?: number;
	prefix?: string;
	requestTimeoutMs?: number;
}

export interface CapabilityHost {
	registry(): CapabilityRegistry;
	baseModel(): BaseSurfaceModel;
	surfaceActions(): CapabilityHostSurfaceAction[];
	surfaceActionRows(): CapabilityHostSurfaceActionRow[];
	surfaceContext(): CapabilityHostSurfaceContext;
	program(): Command;
	serve(options?: CapabilityHostServeCallOptions): ReturnType<typeof serveCapabilities>;
}

export interface CapabilityHostSurfaceAction {
	id: string;
	label: string;
	intent?: string;
	payload: {
		command: string;
		hostId: string;
		unitId: string;
		unitLabel: string;
		primary: boolean;
		[key: string]: unknown;
	};
}

export type CapabilityHostSurfaceActionRow = BaseSurfaceActionRow;

export interface CapabilityHostSurfaceContext {
	hostId: string;
	data: {
		command: string;
		description: string;
	};
	actions: CapabilityHostSurfaceAction[];
}

interface CapabilityHostBundle {
	capabilities: CapabilityHostCapabilities;
	registry: CapabilityRegistry;
}

export function defineCapabilityHost(
	definition: CapabilityHostDefinition,
): CapabilityHost {
	const createBundle = (): CapabilityHostBundle => {
		const capabilities = resolveCapabilities(definition.capabilities);
		const mounted: { registry?: CapabilityRegistry } = {};
		const statusCapability = definition.operatorStatus
			? createBaseStatusCapability({
				name: definition.operatorStatus.name,
				summary: definition.operatorStatus.summary,
				httpPath: definition.operatorStatus.httpPath,
				agentToolName: definition.operatorStatus.agentToolName,
				model: () =>
					buildHostBaseModel(definition, capabilities, ensureRegistry(mounted.registry)),
			})
			: null;
		const actionsCapability = definition.surfaceActions === false
			? null
			: createHostSurfaceActionsCapability(definition, () =>
				hostSurfaceActionsFromModel(
					definition,
					buildHostBaseModel(definition, capabilities, ensureRegistry(mounted.registry)),
				),
			);
		const registry = contextualizeRegistryHandoffs(
			mountCapabilities({
				deps: capabilities.deps,
				verbs: [
					...(capabilities.extensions ?? []),
					...(statusCapability ? [statusCapability] : []),
					...(actionsCapability ? [actionsCapability] : []),
				],
				manifests: capabilities.manifests,
				pluginDeps: capabilities.pluginDeps,
				reservedNames: capabilities.reservedNames,
			}),
			definition.command,
		);
		mounted.registry = registry;
		return { capabilities, registry };
	};

	return {
		registry() {
			return createBundle().registry;
		},
		baseModel() {
			const bundle = createBundle();
			return buildHostBaseModel(definition, bundle.capabilities, bundle.registry);
		},
		surfaceActions() {
			const bundle = createBundle();
			return hostSurfaceActionsFromModel(
				definition,
				buildHostBaseModel(definition, bundle.capabilities, bundle.registry),
			);
		},
		surfaceActionRows() {
			return createCapabilityHostSurfaceActionRows(this.surfaceActions());
		},
		surfaceContext() {
			return {
				hostId: definition.id,
				data: {
					command: definition.command,
					description: definition.description,
				},
				actions: this.surfaceActions(),
			};
		},
		program() {
			const bundle = createBundle();
			const program = new Command()
				.name(definition.command)
				.description(definition.description);
			if (definition.version) program.version(definition.version);
			for (const command of mountedCliCommands(
				bundle.registry,
				definition.hooksFor ?? (() => ({})),
			)) {
				program.addCommand(command);
			}
			addServeCommand(program, definition, bundle.registry);
			return program;
		},
		serve(options: CapabilityHostServeCallOptions = {}) {
			const bundle = createBundle();
			const serveOptions = normalizedServeOptions(definition.serve);
			return serveCapabilities(bundle.registry, {
				port: options.port ?? serveOptions.defaultPort,
				prefix: options.prefix ?? serveOptions.prefix,
				requestTimeoutMs: options.requestTimeoutMs ?? serveOptions.requestTimeoutMs,
			});
		},
	};
}

function createHostSurfaceActionsCapability(
	definition: CapabilityHostDefinition,
	resolveActions: () => CapabilityHostSurfaceAction[],
): CapabilityDescriptor {
	const options = normalizedSurfaceActionsOptions(definition.surfaceActions);
	const name = options.name ?? "actions";
	return {
		name,
		summary: options.summary ?? "List available host surface actions",
		options: [
			{
				name: "renderer",
				kind: "string",
				summary: "Renderer requesting action rows: web, tui, or headless",
				defaultValue: "headless",
			},
			{
				name: "select",
				kind: "string",
				summary: "Select an action by id or row index without executing it",
			},
		],
		transports: {
			cli: {},
			repl: {},
			http: { method: "GET", path: options.httpPath ?? `/${name}` },
			agent: { tool: true, toolName: options.agentToolName ?? name },
		},
		renderers: { tui: { section: "host" }, web: { route: `/${name}` } },
		run(input) {
			return createSurfaceActionsEnvelope(
				definition,
				name,
				resolveActions(),
				input,
			);
		},
	};
}

function createSurfaceActionsEnvelope(
	definition: CapabilityHostDefinition,
	name: string,
	actions: CapabilityHostSurfaceAction[],
	input: CapabilityInput,
): CapabilityEnvelope {
	const rows = createCapabilityHostSurfaceActionRows(actions);
	const actionRequest = typeof input.options.select === "string"
		? createBaseSurfaceActionRequest(
			actions.map((action) => ({
				...action,
				command: action.payload.command,
			})),
			input.options.select,
		)
		: undefined;
	const selection = actionRequest
		? {
			...actionRequest.selection,
			...(actionRequest.selectedRow ? { selected: actionRequest.selectedRow } : {}),
			reason: actionRequest.reason,
		}
		: undefined;
	return buildJsonSuccessEnvelope({
		command: name,
		operation: "surface-actions",
		nextCommand: actionRequest?.nextCommand,
		nextCommands: actionRequest?.nextCommands,
		extra: {
			hostId: definition.id,
			renderer: typeof input.options.renderer === "string"
				? input.options.renderer
				: "headless",
			actions,
			actionRows: rows,
			...(selection ? { selection } : {}),
			...(actionRequest ? { actionRequest } : {}),
		},
	});
}

function normalizedSurfaceActionsOptions(
	options: CapabilityHostDefinition["surfaceActions"],
): CapabilityHostSurfaceActionsOptions {
	return options === false || options === undefined ? {} : options;
}

function contextualizeRegistryHandoffs(
	registry: CapabilityRegistry,
	hostCommand: string,
): CapabilityRegistry {
	const entries = registry.list();
	const commandNames = new Set(entries.map((entry) => entry.name));
	return createCapabilityRegistry(
		entries.map((entry) =>
			contextualizeCapabilityEntryHandoffs(entry, hostCommand, commandNames)
		),
	);
}

function contextualizeCapabilityEntryHandoffs(
	entry: CapabilityEntry,
	hostCommand: string,
	commandNames: ReadonlySet<string>,
): CapabilityEntry {
	if (!isCapabilityGroup(entry)) {
		return contextualizeCapabilityDescriptorHandoffs(entry, hostCommand, commandNames);
	}
	const actions: Record<string, CapabilityDescriptor> = {};
	for (const [key, action] of Object.entries(entry.actions)) {
		actions[key] = contextualizeCapabilityDescriptorHandoffs(
			action,
			hostCommand,
			commandNames,
		);
	}
	return { ...entry, actions };
}

function contextualizeCapabilityDescriptorHandoffs(
	descriptor: CapabilityDescriptor,
	hostCommand: string,
	commandNames: ReadonlySet<string>,
): CapabilityDescriptor {
	return {
		...descriptor,
		async run(input) {
			return contextualizeCapabilityEnvelopeHandoffs(
				await descriptor.run(input),
				hostCommand,
				commandNames,
			);
		},
	};
}

function contextualizeCapabilityEnvelopeHandoffs(
	envelope: CapabilityEnvelope,
	hostCommand: string,
	commandNames: ReadonlySet<string>,
): CapabilityEnvelope {
	const nextCommands = envelope.nextCommands.map((command) =>
		prefixHostCommand(command, hostCommand, commandNames)
	);
	return {
		...envelope,
		nextCommand: envelope.nextCommand
			? prefixHostCommand(envelope.nextCommand, hostCommand, commandNames)
			: nextCommands[0] ?? null,
		nextCommands,
	};
}

function prefixHostCommand(
	command: string,
	hostCommand: string,
	commandNames: ReadonlySet<string>,
): string {
	const trimmed = command.trim();
	const [firstToken] = trimmed.split(/\s+/, 1);
	if (!firstToken || firstToken === hostCommand || !commandNames.has(firstToken)) {
		return trimmed;
	}
	return `${hostCommand} ${trimmed}`;
}

function resolveCapabilities(
	capabilities: CapabilityHostDefinition["capabilities"],
): CapabilityHostCapabilities {
	return typeof capabilities === "function" ? capabilities() : capabilities;
}

function ensureRegistry(registry: CapabilityRegistry | undefined): CapabilityRegistry {
	if (!registry) {
		throw new Error("Capability host registry was requested before mounting completed.");
	}
	return registry;
}

function buildHostBaseModel(
	definition: CapabilityHostDefinition,
	capabilities: CapabilityHostCapabilities,
	registry: CapabilityRegistry,
): BaseSurfaceModel {
	const status = definition.operatorStatus;
	const units: BaseSurfaceUnit[] = [];
	const context = createCapabilityHostStatusContext(definition, capabilities, registry);
	if (status?.primaryVerb) {
		units.push(buildPrimaryVerbSurfaceUnit(status.primaryVerb, context));
	}
	for (const primaryVerb of status?.primaryVerbs ?? []) {
		units.push(buildPrimaryVerbSurfaceUnit(primaryVerb, context));
	}
	if (status?.capabilityUnit) {
		const capabilityUnit = resolveCapabilityHostCapabilityUnit(
			status.capabilityUnit,
			context,
		);
		units.push(
			buildCapabilitySurfaceUnit(
				registry,
				withDefaultOwner(capabilityUnit, definition.id),
			),
		);
	}
	if (status?.units) {
		units.push(...status.units(context));
	}
	return buildBaseSurfaceModel(
		{ units },
		{ command: definition.command, operation: "base" },
	);
}

function createCapabilityHostStatusContext(
	definition: CapabilityHostDefinition,
	capabilities: CapabilityHostCapabilities,
	registry: CapabilityRegistry,
): CapabilityHostStatusContext {
	return {
		id: definition.id,
		command: definition.command,
		hostCommand: (args) => applicationCommand(definition.command, args),
		registry,
		capabilities,
		capabilityUnit: (options) =>
			buildCapabilitySurfaceUnit(
				registry,
				withDefaultOwner(options, definition.id),
			),
		reviewQueueUnit: (options) =>
			buildReviewQueueSurfaceUnit(
				withDefaultOwner(options, definition.id),
			),
		recordReviewQueueUnit: (options) =>
			buildRecordReviewQueueSurfaceUnit(
				withDefaultOwner(options, definition.id),
				capabilities,
				(args) => applicationCommand(definition.command, args),
			),
	};
}

function resolveCapabilityHostCapabilityUnit(
	capabilityUnit:
		| CapabilityHostCapabilityUnitOptions
		| CapabilityHostCapabilityUnitFactory,
	context: CapabilityHostStatusContext,
): CapabilityHostCapabilityUnitOptions {
	return typeof capabilityUnit === "function" ? capabilityUnit(context) : capabilityUnit;
}

function buildPrimaryVerbSurfaceUnit(
	options: CapabilityHostPrimaryVerbOptions,
	context: CapabilityHostStatusContext,
): BaseSurfaceUnit {
	const command = context.hostCommand(options.args ?? [options.name, "--json"]);
	return context.capabilityUnit({
		id: options.id,
		label: options.label,
		subject: options.subject,
		noun: options.noun,
		details: options.details,
		owner: options.owner,
		action: {
			id: options.actionId ?? `open-${options.name}`,
			label: options.actionLabel ?? command,
			intent: options.intent ?? `${options.name}:open`,
			command,
			primary: options.primary ?? true,
			...(options.payload ? { payload: options.payload } : {}),
		},
	});
}

function buildRecordReviewQueueSurfaceUnit(
	options: CapabilityHostRecordReviewQueueUnitOptions & { owner: string },
	capabilities: CapabilityHostCapabilities,
	hostCommand: CapabilityHostCommandBuilder,
): BaseSurfaceUnit {
	const records = options.records ?? capabilities.deps.records;
	if (!records) {
		throw new Error(
			"Capability host recordReviewQueueUnit requires records deps.",
		);
	}
	const manifest = records.loadManifest();
	const pendingRecords = manifest.records.filter(
		(record) => record.review?.state !== options.reviewedState,
	);
	const recordIds = manifest.records.map((record) => record.id);
	const pendingRecordIds = pendingRecords.map((record) => record.id);
	return buildReviewQueueSurfaceUnit({
		id: options.id,
		label: options.label,
		owner: options.owner,
		totalLabel: options.totalLabel,
		pendingLabel: options.pendingLabel,
		readySummary: options.readySummary,
		pendingSummary: options.pendingSummary,
		pendingAction: options.pendingAction ??
			buildRecordCorrectionAction(
				options.pendingCorrection,
				pendingRecordIds[0],
				hostCommand,
			),
		total: manifest.records.length,
		pending: pendingRecords.length,
		details: {
			recordIds,
			pendingRecordIds,
			draftRecordIds: pendingRecordIds,
			reviewedState: options.reviewedState,
			...(options.details ?? {}),
		},
	});
}

function buildRecordCorrectionAction(
	options: CapabilityHostRecordReviewCorrectionOptions | undefined,
	recordId: string | undefined,
	hostCommand: CapabilityHostCommandBuilder,
): BaseSurfaceAction | undefined {
	if (!options || !recordId) return undefined;
	const args = ["records", "correct", recordId, options.targetState];
	if (options.apply ?? true) args.push("--apply");
	return {
		id: options.actionId,
		label: options.label,
		...(options.intent ? { intent: options.intent } : {}),
		command: hostCommand(args),
		primary: options.primary ?? true,
		...(options.payload ? { payload: options.payload } : {}),
	};
}

function hostSurfaceActionsFromModel(
	definition: CapabilityHostDefinition,
	model: BaseSurfaceModel,
): CapabilityHostSurfaceAction[] {
	const seen = new Set<string>();
	const actions: CapabilityHostSurfaceAction[] = [];
	for (const unit of model.units) {
		for (const action of unit.actions) {
			const surfaceAction = hostSurfaceActionFromBaseAction(
				definition,
				unit,
				action,
			);
			if (seen.has(surfaceAction.id)) {
				throw new Error(
					`Capability host surface action id "${surfaceAction.id}" is declared more than once.`,
				);
			}
			seen.add(surfaceAction.id);
			actions.push(surfaceAction);
		}
	}
	return actions;
}

function hostSurfaceActionFromBaseAction(
	definition: CapabilityHostDefinition,
	unit: BaseSurfaceUnit,
	action: BaseSurfaceAction,
): CapabilityHostSurfaceAction {
	return {
		id: action.id ?? slugActionId(action.command || action.label),
		label: action.label,
		...(action.intent ? { intent: action.intent } : {}),
		payload: {
			...(action.payload ?? {}),
			command: action.command,
			hostId: definition.id,
			unitId: unit.id,
			unitLabel: unit.label,
			primary: action.primary === true,
		},
	};
}

function createCapabilityHostSurfaceActionRows(
	actions: readonly CapabilityHostSurfaceAction[],
): CapabilityHostSurfaceActionRow[] {
	return createBaseSurfaceActionRows(actions);
}

function slugActionId(value: string): string {
	const slug = value
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
	return slug || "action";
}

function withDefaultOwner<T extends { owner?: string }>(
	options: T,
	owner: string,
): Omit<T, "owner"> & { owner: string } {
	const { owner: explicitOwner, ...rest } = options;
	return { ...rest, owner: explicitOwner ?? owner };
}

function normalizedServeOptions(
	options: CapabilityHostDefinition["serve"],
): CapabilityHostServeOptions {
	return options === false || options === undefined ? {} : options;
}

function addServeCommand(
	program: Command,
	definition: CapabilityHostDefinition,
	registry: CapabilityRegistry,
): void {
	if (definition.serve === false) return;
	const options = normalizedServeOptions(definition.serve);
	program
		.command(options.commandName ?? "serve")
		.description(options.description ?? `Serve ${definition.command}'s capability routes over HTTP`)
		.option("--port <port>", "TCP port (0 = pick free)", String(options.defaultPort ?? 0))
		.action(async (opts: { port: string }) => {
			const { listening } = serveCapabilities(registry, {
				port: Number(opts.port),
				prefix: options.prefix,
				requestTimeoutMs: options.requestTimeoutMs,
			});
			const { port } = await listening;
			console.log(JSON.stringify({ ok: true, url: `http://127.0.0.1:${port}` }));
		});
}
