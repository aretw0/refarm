import type { ManagedArtefact, ArtefactStatus } from "@refarm.dev/artefact-contract-v1";
import type { Effort } from "@refarm.dev/effort-contract-v1";

export const AUTOMATION_CAPABILITY = "automation:v1" as const;

// Re-export for consumers who only import from this package
export type { ArtefactStatus };

// ── Body types ────────────────────────────────────────────────────────────────

/** Minimal JSON Schema for input validation. Semantics are adapter-defined. */
export type JsonSchema = Record<string, unknown>;

/** Effort fields provided by the automation author (id and submittedAt are runtime-generated). */
export type EffortTemplate = Omit<Effort, "id" | "submittedAt">;

/** Fixed Effort template — identical shape every run, no interpolation. */
export interface StaticBody {
	type: "static";
	effort: EffortTemplate;
}

/**
 * String-interpolated template — `direction` supports `{{varName}}` placeholders
 * that the adapter substitutes from the trigger `input`.
 */
export interface TemplateBody {
	type: "template";
	effort: EffortTemplate;
	inputSchema?: JsonSchema;
}

/**
 * Delegates Effort construction to a loaded plugin function.
 * The adapter calls `pluginId.fn(input)` which returns an Effort or null.
 */
export interface PluginBody {
	type: "plugin";
	pluginId: string;
	fn: string;
	inputSchema?: JsonSchema;
}

export type AutomationBody = StaticBody | TemplateBody | PluginBody;

// ── Trigger types ─────────────────────────────────────────────────────────────

export interface ManualTrigger {
	type: "manual";
}

export interface CronTrigger {
	type: "cron";
	/** Standard cron expression, e.g. "0 9 * * 1-5" */
	schedule: string;
	/** IANA timezone, e.g. "America/Sao_Paulo". Defaults to UTC. */
	timezone?: string;
}

export interface EventTrigger {
	type: "event";
	/** e.g. "effort.completed", "node.created" */
	eventType: string;
	/** Opaque predicate — the runtime interprets the filter language. */
	filter?: Record<string, unknown>;
}

export type AutomationTrigger = ManualTrigger | CronTrigger | EventTrigger;

// ── Core artefact type ────────────────────────────────────────────────────────

export interface Automation extends ManagedArtefact {
	name: string;
	description?: string;
	body: AutomationBody;
	/** At least one trigger must be declared. The adapter stores all; each runtime connects what it supports. */
	triggers: AutomationTrigger[];
}

// ── Adapter surface ───────────────────────────────────────────────────────────

export interface AutomationFilter {
	status?: ArtefactStatus | ArtefactStatus[];
	tags?: string[];
}

export interface AutomationSummary {
	total: number;
	draft: number;
	ready: number;
	active: number;
	archived: number;
}

export interface AutomationConformanceResult {
	pass: boolean;
	total: number;
	failed: number;
	failures: string[];
}

export interface AutomationAdapter {
	// ── CRUD ──────────────────────────────────────────────────────────────────
	/** Always creates with status "draft". */
	create(
		automation: Omit<Automation, "id" | "createdAt" | "updatedAt" | "status">,
	): Promise<Automation>;

	get(id: string): Promise<Automation | null>;

	/** Status changes are only allowed via the transition methods below. updatedAt is managed by the adapter. */
	update(
		id: string,
		patch: Partial<Omit<Automation, "id" | "createdAt" | "updatedAt" | "status">>,
	): Promise<Automation>;

	delete(id: string): Promise<void>;

	query?(filter?: AutomationFilter): Promise<Automation[]>;

	// ── Status transitions ────────────────────────────────────────────────────
	validate(id: string): Promise<Automation>;    // draft   → ready
	activate(id: string): Promise<Automation>;    // ready   → active
	deactivate(id: string): Promise<Automation>;  // active  → ready
	archive(id: string): Promise<Automation>;     // any     → archived  (terminal)
	revert(id: string): Promise<Automation>;      // ready   → draft

	// ── Trigger ──────────────────────────────────────────────────────────────
	/**
	 * Returns a ready-to-submit Effort, or null when:
	 * - automation not found
	 * - automation is not active
	 * - plugin body function returns null
	 *
	 * Does NOT submit to an effort adapter — the caller is responsible.
	 */
	trigger(id: string, input?: unknown): Promise<Effort | null>;

	// ── Optional ──────────────────────────────────────────────────────────────
	summary?(): Promise<AutomationSummary>;
}
