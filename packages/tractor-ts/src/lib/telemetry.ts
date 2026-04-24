/**
 * @refarm.dev/tractor - Telemetry & Observability
 *
 * Defines the core telemetry events, the event emitter, and the bounded
 * ring buffer used as Tractor's "Black Box Recorder".
 */

export interface TelemetryEvent {
	event: string;
	pluginId?: string;
	durationMs?: number;
	payload?: any;
}

export const RUNTIME_DESCRIPTOR_REVOCATION_EVENTS = [
	"system:descriptor_revocation_config_invalid",
	"system:descriptor_revocation_config_conflict",
	"system:descriptor_revocation_stale_cache_used",
	"system:descriptor_revocation_unavailable",
] as const;

export type RuntimeDescriptorRevocationEventName =
	(typeof RUNTIME_DESCRIPTOR_REVOCATION_EVENTS)[number];

export interface RuntimeDescriptorRevocationTelemetrySummary {
	totalEvents: number;
	byEvent: Record<RuntimeDescriptorRevocationEventName, number>;
	byPolicy: Record<string, number>;
	byPolicySource: Record<string, number>;
	byProfile: Record<string, number>;
	affectedPlugins: string[];
}

export interface RuntimeDescriptorRevocationTelemetrySummaryOptions {
	pluginId?: string;
	policy?: string;
	profile?: string;
	limit?: number;
}

export type RuntimeDescriptorRevocationAlertSeverity =
	| "info"
	| "warn"
	| "critical";

export interface RuntimeDescriptorRevocationAlert {
	id:
		| "revocation-unavailable"
		| "revocation-config-drift"
		| "revocation-stale-cache"
		| "revocation-no-signals";
	severity: RuntimeDescriptorRevocationAlertSeverity;
	title: string;
	message: string;
	count: number;
	event?: RuntimeDescriptorRevocationEventName;
}

export interface RuntimeDescriptorRevocationAlertThresholds {
	unavailableWarnAt?: number;
	unavailableCriticalAt?: number;
	configDriftWarnAt?: number;
	staleCacheWarnAt?: number;
}

export interface RuntimeDescriptorRevocationDiagnostics {
	generatedAt: string;
	summary: RuntimeDescriptorRevocationTelemetrySummary;
	alerts: RuntimeDescriptorRevocationAlert[];
	thresholds: Required<RuntimeDescriptorRevocationAlertThresholds>;
}

const DEFAULT_RUNTIME_DESCRIPTOR_REVOCATION_ALERT_THRESHOLDS: Required<RuntimeDescriptorRevocationAlertThresholds> =
	{
		unavailableWarnAt: 1,
		unavailableCriticalAt: 3,
		configDriftWarnAt: 1,
		staleCacheWarnAt: 1,
	};

function isRuntimeDescriptorRevocationEvent(
	eventName: string,
): eventName is RuntimeDescriptorRevocationEventName {
	return (RUNTIME_DESCRIPTOR_REVOCATION_EVENTS as readonly string[]).includes(
		eventName,
	);
}

function incrementCounter(counter: Record<string, number>, key: string): void {
	if (!key) return;
	counter[key] = (counter[key] ?? 0) + 1;
}

function toPositiveInteger(value: unknown): number | undefined {
	if (typeof value === "number" && Number.isInteger(value) && value > 0)
		return value;
	if (typeof value === "string" && value.trim().length > 0) {
		const parsed = Number.parseInt(value, 10);
		if (Number.isInteger(parsed) && parsed > 0) return parsed;
	}
	return undefined;
}

function resolveRuntimeDescriptorRevocationPolicy(payload: unknown): string {
	if (!payload || typeof payload !== "object") return "";
	const policy = (payload as Record<string, unknown>).policy;
	if (typeof policy === "string" && policy.trim().length > 0) return policy;
	const resolvedPolicy = (payload as Record<string, unknown>).resolvedPolicy;
	if (typeof resolvedPolicy === "string" && resolvedPolicy.trim().length > 0)
		return resolvedPolicy;
	return "";
}

function resolveRuntimeDescriptorRevocationProfile(payload: unknown): string {
	if (!payload || typeof payload !== "object") return "";
	const profile = (payload as Record<string, unknown>).profile;
	return typeof profile === "string" ? profile : "";
}

type RuntimeDescriptorRevocationTelemetryEvent = TelemetryEvent & {
	event: RuntimeDescriptorRevocationEventName;
};

function isRuntimeDescriptorRevocationTelemetryEvent(
	event: TelemetryEvent,
): event is RuntimeDescriptorRevocationTelemetryEvent {
	return isRuntimeDescriptorRevocationEvent(event.event);
}

function selectRuntimeDescriptorRevocationEvents(
	events: TelemetryEvent[],
	options: RuntimeDescriptorRevocationTelemetrySummaryOptions = {},
): RuntimeDescriptorRevocationTelemetryEvent[] {
	const pluginFilter = options.pluginId?.trim();
	const policyFilter = options.policy?.trim();
	const profileFilter = options.profile?.trim();
	const selected = events
		.filter(isRuntimeDescriptorRevocationTelemetryEvent)
		.filter((event) => {
			if (pluginFilter && event.pluginId !== pluginFilter) return false;

			const policy = resolveRuntimeDescriptorRevocationPolicy(event.payload);
			if (policyFilter && policy !== policyFilter) return false;

			const profile = resolveRuntimeDescriptorRevocationProfile(event.payload);
			if (profileFilter && profile !== profileFilter) return false;

			return true;
		});

	const limit = toPositiveInteger(options.limit);
	if (!limit || selected.length <= limit) return selected;
	return selected.slice(-limit);
}

export function resolveRuntimeDescriptorRevocationAlertThresholds(
	thresholds: RuntimeDescriptorRevocationAlertThresholds = {},
): Required<RuntimeDescriptorRevocationAlertThresholds> {
	const unavailableWarnAt =
		toPositiveInteger(thresholds.unavailableWarnAt) ??
		DEFAULT_RUNTIME_DESCRIPTOR_REVOCATION_ALERT_THRESHOLDS.unavailableWarnAt;
	const unavailableCriticalAt = Math.max(
		unavailableWarnAt,
		toPositiveInteger(thresholds.unavailableCriticalAt) ??
			DEFAULT_RUNTIME_DESCRIPTOR_REVOCATION_ALERT_THRESHOLDS.unavailableCriticalAt,
	);

	return {
		unavailableWarnAt,
		unavailableCriticalAt,
		configDriftWarnAt:
			toPositiveInteger(thresholds.configDriftWarnAt) ??
			DEFAULT_RUNTIME_DESCRIPTOR_REVOCATION_ALERT_THRESHOLDS.configDriftWarnAt,
		staleCacheWarnAt:
			toPositiveInteger(thresholds.staleCacheWarnAt) ??
			DEFAULT_RUNTIME_DESCRIPTOR_REVOCATION_ALERT_THRESHOLDS.staleCacheWarnAt,
	};
}

export function summarizeRuntimeDescriptorRevocationTelemetry(
	events: TelemetryEvent[],
	options: RuntimeDescriptorRevocationTelemetrySummaryOptions = {},
): RuntimeDescriptorRevocationTelemetrySummary {
	const byEvent: Record<RuntimeDescriptorRevocationEventName, number> = {
		"system:descriptor_revocation_config_invalid": 0,
		"system:descriptor_revocation_config_conflict": 0,
		"system:descriptor_revocation_stale_cache_used": 0,
		"system:descriptor_revocation_unavailable": 0,
	};

	const byPolicy: Record<string, number> = {};
	const byPolicySource: Record<string, number> = {};
	const byProfile: Record<string, number> = {};
	const affectedPlugins = new Set<string>();

	const selectedEvents = selectRuntimeDescriptorRevocationEvents(
		events,
		options,
	);

	let totalEvents = 0;
	for (const event of selectedEvents) {
		totalEvents += 1;
		byEvent[event.event] += 1;

		if (
			typeof event.pluginId === "string" &&
			event.pluginId.trim().length > 0
		) {
			affectedPlugins.add(event.pluginId);
		}

		const payload = event.payload ?? {};
		if (typeof payload === "object" && payload !== null) {
			incrementCounter(
				byPolicy,
				String(payload.policy ?? payload.resolvedPolicy ?? ""),
			);
			incrementCounter(byPolicySource, String(payload.policySource ?? ""));
			incrementCounter(byProfile, String(payload.profile ?? ""));
		}
	}

	return {
		totalEvents,
		byEvent,
		byPolicy,
		byPolicySource,
		byProfile,
		affectedPlugins: Array.from(affectedPlugins).sort((a, b) =>
			a.localeCompare(b),
		),
	};
}

function revocationAlertSeverityRank(
	severity: RuntimeDescriptorRevocationAlertSeverity,
): number {
	switch (severity) {
		case "critical":
			return 3;
		case "warn":
			return 2;
		default:
			return 1;
	}
}

export function detectRuntimeDescriptorRevocationAlerts(
	summary: RuntimeDescriptorRevocationTelemetrySummary,
	thresholds: RuntimeDescriptorRevocationAlertThresholds = {},
): RuntimeDescriptorRevocationAlert[] {
	const resolvedThresholds =
		resolveRuntimeDescriptorRevocationAlertThresholds(thresholds);
	const alerts: RuntimeDescriptorRevocationAlert[] = [];

	const unavailableCount =
		summary.byEvent["system:descriptor_revocation_unavailable"];
	const failClosedUnavailableCount = summary.byPolicy["fail-closed"] ?? 0;

	if (
		unavailableCount >= resolvedThresholds.unavailableWarnAt ||
		failClosedUnavailableCount > 0
	) {
		const severity: RuntimeDescriptorRevocationAlertSeverity =
			failClosedUnavailableCount > 0 ||
			unavailableCount >= resolvedThresholds.unavailableCriticalAt
				? "critical"
				: "warn";
		alerts.push({
			id: "revocation-unavailable",
			severity,
			title: "Revocation endpoint unavailable",
			message:
				"Runtime revocation checks reported endpoint/cache unavailability; validate release assets and transport availability.",
			count: unavailableCount,
			event: "system:descriptor_revocation_unavailable",
		});
	}

	const configDriftCount =
		summary.byEvent["system:descriptor_revocation_config_invalid"] +
		summary.byEvent["system:descriptor_revocation_config_conflict"];
	if (configDriftCount >= resolvedThresholds.configDriftWarnAt) {
		alerts.push({
			id: "revocation-config-drift",
			severity: "warn",
			title: "Revocation policy configuration drift",
			message:
				"Invalid/conflicting revocation configuration detected. Align explicit policy/profile and environment mapping before next release.",
			count: configDriftCount,
		});
	}

	const staleCacheCount =
		summary.byEvent["system:descriptor_revocation_stale_cache_used"];
	if (staleCacheCount >= resolvedThresholds.staleCacheWarnAt) {
		alerts.push({
			id: "revocation-stale-cache",
			severity: "warn",
			title: "Stale revocation cache fallback in use",
			message:
				"Offline fallback is currently serving stale revocation data. Validate endpoint freshness and cache TTL expectations.",
			count: staleCacheCount,
			event: "system:descriptor_revocation_stale_cache_used",
		});
	}

	if (summary.totalEvents === 0) {
		alerts.push({
			id: "revocation-no-signals",
			severity: "info",
			title: "No revocation telemetry signals",
			message:
				"No revocation-related telemetry events found in the selected window. Validate instrumentation path when investigating an active incident.",
			count: 0,
		});
	}

	alerts.sort((a, b) => {
		const severityDelta =
			revocationAlertSeverityRank(b.severity) -
			revocationAlertSeverityRank(a.severity);
		if (severityDelta !== 0) return severityDelta;
		return a.id.localeCompare(b.id);
	});

	return alerts;
}

export interface RuntimeDescriptorRevocationDiagnosticsOptions {
	summary?: RuntimeDescriptorRevocationTelemetrySummaryOptions;
	thresholds?: RuntimeDescriptorRevocationAlertThresholds;
	generatedAt?: string;
}

export function buildRuntimeDescriptorRevocationDiagnostics(
	events: TelemetryEvent[],
	options: RuntimeDescriptorRevocationDiagnosticsOptions = {},
): RuntimeDescriptorRevocationDiagnostics {
	const summary = summarizeRuntimeDescriptorRevocationTelemetry(
		events,
		options.summary,
	);
	const thresholds = resolveRuntimeDescriptorRevocationAlertThresholds(
		options.thresholds,
	);
	const alerts = detectRuntimeDescriptorRevocationAlerts(summary, thresholds);
	return {
		generatedAt: options.generatedAt ?? new Date().toISOString(),
		summary,
		alerts,
		thresholds,
	};
}

export type TelemetryListener = (data: TelemetryEvent) => void;

export class EventEmitter {
	private listeners: Set<TelemetryListener> = new Set();

	on(listener: TelemetryListener) {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	emit(data: TelemetryEvent) {
		this.listeners.forEach((l) => l(data));
	}
}

export interface TelemetryRingBufferOptions {
	/** Maximum number of events to retain in memory. Defaults to 1000. */
	capacity?: number;
	/** Keys in payloads to mask during diagnostic export. */
	sensitiveKeys?: string[];
	/** Maximum string length for scalar values in diagnostic export. */
	maxValueLength?: number;
}

/**
 * A bounded, in-memory ring buffer for telemetry events.
 * Used for diagnostic exports without permanently storing or polluting stdout.
 */
export class TelemetryRingBuffer {
	private buffer: TelemetryEvent[];
	private capacity: number;
	private head: number = 0;
	private tail: number = 0;
	private count: number = 0;
	private sensitiveKeys: Set<string>;
	private maxValueLength: number;

	constructor(options: TelemetryRingBufferOptions = {}) {
		this.capacity = options.capacity ?? 1000;
		this.buffer = new Array(this.capacity);
		this.sensitiveKeys = new Set(
			options.sensitiveKeys ?? [
				"secretKey",
				"privateKey",
				"token",
				"password",
				"sas",
			],
		);
		this.maxValueLength = options.maxValueLength ?? 500;
	}

	/**
	 * Push a new telemetry event into the ring buffer.
	 * If at capacity, the oldest event is overwritten.
	 */
	push(event: TelemetryEvent): void {
		if (this.capacity === 0) return;

		// We clone the event shallowly to capture a snapshot in time.
		// For payload, we also do a shallow clone to prevent immediate outer-mutation,
		// though deep mutations will still affect it unless deep cloned.
		const snapshot: TelemetryEvent = {
			event: event.event,
			pluginId: event.pluginId,
			durationMs: event.durationMs,
			payload:
				event.payload && typeof event.payload === "object"
					? { ...event.payload }
					: event.payload,
		};

		this.buffer[this.head] = snapshot;
		this.head = (this.head + 1) % this.capacity;

		if (this.count < this.capacity) {
			this.count++;
		} else {
			this.tail = (this.tail + 1) % this.capacity;
		}
	}

	/**
	 * Retrieves all events in chronological order, applying sanitization
	 * rules to protect sensitive data and truncate massive values.
	 */
	dump(): TelemetryEvent[] {
		const result: TelemetryEvent[] = new Array(this.count);
		let current = this.tail;

		for (let i = 0; i < this.count; i++) {
			const ev = this.buffer[current];
			result[i] = {
				...ev,
				payload: this.sanitizePayload(ev.payload),
			};
			current = (current + 1) % this.capacity;
		}

		return result;
	}

	/**
	 * Masks sensitive keys and truncates long strings to ensure diagnostic
	 * safety and readability.
	 */
	private sanitizePayload(payload: any): any {
		if (payload == null) return payload;
		if (typeof payload !== "object") return payload;

		const sanitized: Record<string, any> = {};

		for (const [key, value] of Object.entries(payload)) {
			if (this.sensitiveKeys.has(key)) {
				sanitized[key] = "[REDACTED]";
			} else if (
				typeof value === "string" &&
				value.length > this.maxValueLength
			) {
				sanitized[key] =
					value.substring(0, this.maxValueLength) + "... [TRUNCATED]";
			} else if (value instanceof Uint8Array) {
				sanitized[key] = `[Uint8Array(${value.length})]`;
			} else if (Array.isArray(value)) {
				sanitized[key] = value.length > 50 ? `[Array(${value.length})]` : value;
			} else {
				// Deep clone not strictly required for a basic dump, but we just pass the reference
				// or apply basic masking if it were deeply nested.
				// For performance, we only sanitize the top level of the payload.
				sanitized[key] = value;
			}
		}

		return sanitized;
	}
}

/**
 * Manages the collection and export of telemetry events.
 * Following the Host pattern, it decouples diagnostics from the main Tractor domain.
 */
export class TelemetryHost {
	private ring: TelemetryRingBuffer;

	constructor(options: TelemetryRingBufferOptions = {}) {
		this.ring = new TelemetryRingBuffer(options);
	}

	/**
	 * Pushes an event into the recorder.
	 */
	push(event: TelemetryEvent): void {
		this.ring.push(event);
	}

	/**
	 * Returns the sanitized events.
	 */
	dump(): TelemetryEvent[] {
		return this.ring.dump();
	}

	/**
	 * Registers itself with the engine's event bus and command host.
	 * This is what keeps the main Tractor class clean.
	 */
	register(events: EventEmitter, commands: any): void {
		// Listen to all events and log them in the ring buffer
		events.on((data) => this.push(data));

		// Expose the diagnostic export command
		commands.register({
			id: "system:diagnostics:export",
			title: "Export Diagnostic Telemetry",
			category: "System",
			description:
				"Exports a sanitized slice of recent internal telemetry events.",
			handler: () => {
				return { events: this.dump() };
			},
		});

		commands.register({
			id: "system:diagnostics:descriptor-revocation-summary",
			title: "Export Descriptor Revocation Summary",
			category: "System",
			description:
				"Summarizes runtime descriptor revocation telemetry events from the ring buffer.",
			handler: (args?: RuntimeDescriptorRevocationTelemetrySummaryOptions) => {
				const events = this.dump();
				return {
					summary: summarizeRuntimeDescriptorRevocationTelemetry(events, args),
				};
			},
		});

		commands.register({
			id: "system:diagnostics:descriptor-revocation-alerts",
			title: "Evaluate Descriptor Revocation Alerts",
			category: "System",
			description:
				"Builds revocation telemetry diagnostics with severity-ranked alerts for incident triage.",
			handler: (
				args?: RuntimeDescriptorRevocationTelemetrySummaryOptions &
					RuntimeDescriptorRevocationAlertThresholds,
			) => {
				const events = this.dump();
				return buildRuntimeDescriptorRevocationDiagnostics(events, {
					summary: {
						pluginId: args?.pluginId,
						policy: args?.policy,
						profile: args?.profile,
						limit: args?.limit,
					},
					thresholds: {
						unavailableWarnAt: args?.unavailableWarnAt,
						unavailableCriticalAt: args?.unavailableCriticalAt,
						configDriftWarnAt: args?.configDriftWarnAt,
						staleCacheWarnAt: args?.staleCacheWarnAt,
					},
				});
			},
		});
	}
}
