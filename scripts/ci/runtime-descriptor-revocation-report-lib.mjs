export const REVOCATION_EVENTS = [
	"system:descriptor_revocation_config_invalid",
	"system:descriptor_revocation_config_conflict",
	"system:descriptor_revocation_stale_cache_used",
	"system:descriptor_revocation_unavailable",
];

export const DEFAULT_REVOCATION_REPORT_THRESHOLDS = {
	unavailableWarnAt: 1,
	unavailableCriticalAt: 3,
	configDriftWarnAt: 1,
	staleCacheWarnAt: 1,
};

export function toPositiveInteger(value) {
	if (typeof value === "number" && Number.isInteger(value) && value > 0) {
		return value;
	}
	if (typeof value === "string" && value.trim().length > 0) {
		const parsed = Number.parseInt(value, 10);
		if (Number.isInteger(parsed) && parsed > 0) return parsed;
	}
	return undefined;
}

export function resolveRevocationReportThresholds(args = {}) {
	const unavailableWarnAt =
		toPositiveInteger(args["unavailable-warn-at"] ?? args.unavailableWarnAt) ??
		DEFAULT_REVOCATION_REPORT_THRESHOLDS.unavailableWarnAt;
	const unavailableCriticalAt = Math.max(
		unavailableWarnAt,
		toPositiveInteger(
			args["unavailable-critical-at"] ?? args.unavailableCriticalAt,
		) ?? DEFAULT_REVOCATION_REPORT_THRESHOLDS.unavailableCriticalAt,
	);
	return {
		unavailableWarnAt,
		unavailableCriticalAt,
		configDriftWarnAt:
			toPositiveInteger(
				args["config-drift-warn-at"] ?? args.configDriftWarnAt,
			) ?? DEFAULT_REVOCATION_REPORT_THRESHOLDS.configDriftWarnAt,
		staleCacheWarnAt:
			toPositiveInteger(args["stale-cache-warn-at"] ?? args.staleCacheWarnAt) ??
			DEFAULT_REVOCATION_REPORT_THRESHOLDS.staleCacheWarnAt,
	};
}

export function normalizeRevocationEventsInput(input) {
	if (Array.isArray(input)) return input;
	if (input && Array.isArray(input.events)) return input.events;
	return [];
}

export function summarizeRevocationEvents(events = []) {
	const byEvent = {
		"system:descriptor_revocation_config_invalid": 0,
		"system:descriptor_revocation_config_conflict": 0,
		"system:descriptor_revocation_stale_cache_used": 0,
		"system:descriptor_revocation_unavailable": 0,
	};
	const byPolicy = {};
	const byPolicySource = {};
	const byProfile = {};
	const affectedPlugins = new Set();

	for (const event of events) {
		if (!event || !REVOCATION_EVENTS.includes(event.event)) continue;
		byEvent[event.event] += 1;
		if (
			typeof event.pluginId === "string" &&
			event.pluginId.trim().length > 0
		) {
			affectedPlugins.add(event.pluginId);
		}
		const payload =
			event.payload && typeof event.payload === "object" ? event.payload : {};
		const policy =
			typeof payload.policy === "string" && payload.policy.trim().length > 0
				? payload.policy
				: typeof payload.resolvedPolicy === "string" &&
						payload.resolvedPolicy.trim().length > 0
					? payload.resolvedPolicy
					: "";
		const policySource =
			typeof payload.policySource === "string" ? payload.policySource : "";
		const profile = typeof payload.profile === "string" ? payload.profile : "";

		if (policy) byPolicy[policy] = (byPolicy[policy] ?? 0) + 1;
		if (policySource)
			byPolicySource[policySource] = (byPolicySource[policySource] ?? 0) + 1;
		if (profile) byProfile[profile] = (byProfile[profile] ?? 0) + 1;
	}

	const totalEvents = Object.values(byEvent).reduce(
		(acc, value) => acc + value,
		0,
	);
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

export function detectRevocationAlerts(summary, thresholds) {
	const alerts = [];
	const unavailableCount =
		summary.byEvent["system:descriptor_revocation_unavailable"];
	const failClosedUnavailableCount = summary.byPolicy["fail-closed"] ?? 0;
	if (
		unavailableCount >= thresholds.unavailableWarnAt ||
		failClosedUnavailableCount > 0
	) {
		const severity =
			failClosedUnavailableCount > 0 ||
			unavailableCount >= thresholds.unavailableCriticalAt
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
	if (configDriftCount >= thresholds.configDriftWarnAt) {
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
	if (staleCacheCount >= thresholds.staleCacheWarnAt) {
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

	const rank = { critical: 3, warn: 2, info: 1 };
	alerts.sort((a, b) => {
		const severityDelta = (rank[b.severity] ?? 0) - (rank[a.severity] ?? 0);
		if (severityDelta !== 0) return severityDelta;
		return a.id.localeCompare(b.id);
	});
	return alerts;
}

export function hasAlertAtOrAbove(alerts, minimumSeverity) {
	if (!minimumSeverity) return false;
	const rank = { info: 1, warn: 2, critical: 3 };
	const threshold = rank[minimumSeverity];
	if (!threshold) return false;
	return alerts.some((alert) => (rank[alert.severity] ?? 0) >= threshold);
}

function toMarkdownRows(record) {
	const entries = Object.entries(record || {}).sort(([a], [b]) =>
		a.localeCompare(b),
	);
	if (entries.length === 0) return "| _none_ | 0 |";
	return entries.map(([key, value]) => `| ${key} | ${value} |`).join("\n");
}

export function renderRevocationReportMarkdown(report) {
	const lines = [];
	lines.push("# Runtime Descriptor Revocation Report");
	lines.push("");
	lines.push(`Generated at: ${report.generatedAt}`);
	lines.push(`Input: ${report.inputPath ?? "(none; empty set)"}`);
	lines.push("");
	lines.push("## Summary");
	lines.push("");
	lines.push(`- total revocation events: **${report.summary.totalEvents}**`);
	lines.push(`- affected plugins: ${report.summary.affectedPlugins.length}`);
	lines.push("");
	lines.push("### By event");
	lines.push("");
	lines.push("| Event | Count |");
	lines.push("|---|---:|");
	lines.push(toMarkdownRows(report.summary.byEvent));
	lines.push("");
	lines.push("### By policy");
	lines.push("");
	lines.push("| Policy | Count |");
	lines.push("|---|---:|");
	lines.push(toMarkdownRows(report.summary.byPolicy));
	lines.push("");
	lines.push("### By policy source");
	lines.push("");
	lines.push("| Source | Count |");
	lines.push("|---|---:|");
	lines.push(toMarkdownRows(report.summary.byPolicySource));
	lines.push("");
	lines.push("### By profile");
	lines.push("");
	lines.push("| Profile | Count |");
	lines.push("|---|---:|");
	lines.push(toMarkdownRows(report.summary.byProfile));
	lines.push("");
	lines.push("### Alerts");
	lines.push("");
	if (report.alerts.length === 0) {
		lines.push("No alerts.");
	} else {
		lines.push("| Severity | Alert | Count | Message |");
		lines.push("|---|---|---:|---|");
		for (const alert of report.alerts) {
			lines.push(
				`| ${alert.severity} | ${alert.id} | ${alert.count} | ${alert.message} |`,
			);
		}
	}
	lines.push("");
	lines.push("### Thresholds");
	lines.push("");
	lines.push("| Key | Value |");
	lines.push("|---|---:|");
	lines.push(`| unavailableWarnAt | ${report.thresholds.unavailableWarnAt} |`);
	lines.push(
		`| unavailableCriticalAt | ${report.thresholds.unavailableCriticalAt} |`,
	);
	lines.push(`| configDriftWarnAt | ${report.thresholds.configDriftWarnAt} |`);
	lines.push(`| staleCacheWarnAt | ${report.thresholds.staleCacheWarnAt} |`);
	lines.push("");
	return lines.join("\n");
}

export function buildRuntimeDescriptorRevocationReport({
	generatedAt,
	inputPath,
	events,
	thresholdArgs,
}) {
	const summary = summarizeRevocationEvents(events);
	const thresholds = resolveRevocationReportThresholds(thresholdArgs);
	const alerts = detectRevocationAlerts(summary, thresholds);
	return {
		generatedAt: generatedAt ?? new Date().toISOString(),
		inputPath,
		summary,
		alerts,
		thresholds,
	};
}

function toCounter(input) {
	if (!input || typeof input !== "object") return {};
	const counter = {};
	for (const [key, value] of Object.entries(input)) {
		if (typeof value === "number" && Number.isFinite(value)) {
			counter[key] = value;
		}
	}
	return counter;
}

function toStringArray(input) {
	if (!Array.isArray(input)) return [];
	return input.filter((value) => typeof value === "string");
}

function toAlertArray(input) {
	if (!Array.isArray(input)) return [];
	return input
		.filter((alert) => alert && typeof alert === "object")
		.map((alert) => ({
			id: String(alert.id ?? ""),
			severity: String(alert.severity ?? "info"),
			title: String(alert.title ?? ""),
			message: String(alert.message ?? ""),
			count:
				typeof alert.count === "number" && Number.isFinite(alert.count)
					? alert.count
					: 0,
			event:
				typeof alert.event === "string" && alert.event.trim().length > 0
					? alert.event
					: undefined,
		}));
}

function parseGeneratedAt(generatedAt, fallback) {
	if (typeof generatedAt === "string" && generatedAt.trim().length > 0) {
		const timestamp = Date.parse(generatedAt);
		if (Number.isFinite(timestamp)) {
			return new Date(timestamp).toISOString();
		}
	}
	return fallback;
}

function resolveAlertCountBySeverity(alerts) {
	const bySeverity = {
		info: 0,
		warn: 0,
		critical: 0,
	};
	for (const alert of alerts) {
		if (alert.severity === "critical") {
			bySeverity.critical += 1;
			continue;
		}
		if (alert.severity === "warn") {
			bySeverity.warn += 1;
			continue;
		}
		bySeverity.info += 1;
	}
	return bySeverity;
}

export function normalizeRuntimeDescriptorRevocationReport(input, sourcePath) {
	const generatedAt = parseGeneratedAt(input?.generatedAt, new Date(0).toISOString());
	const fallbackThresholds = resolveRevocationReportThresholds();
	const thresholds = resolveRevocationReportThresholds(input?.thresholds ?? {});
	return {
		generatedAt,
		inputPath:
			typeof input?.inputPath === "string" ? input.inputPath : sourcePath ?? null,
		sourcePath: sourcePath ?? null,
		summary: {
			totalEvents:
				typeof input?.summary?.totalEvents === "number"
					? input.summary.totalEvents
					: 0,
			byEvent: {
				...summarizeRevocationEvents([]).byEvent,
				...toCounter(input?.summary?.byEvent),
			},
			byPolicy: toCounter(input?.summary?.byPolicy),
			byPolicySource: toCounter(input?.summary?.byPolicySource),
			byProfile: toCounter(input?.summary?.byProfile),
			affectedPlugins: toStringArray(input?.summary?.affectedPlugins).sort((a, b) =>
				a.localeCompare(b),
			),
		},
		alerts: toAlertArray(input?.alerts),
		thresholds: {
			unavailableWarnAt:
				thresholds.unavailableWarnAt ?? fallbackThresholds.unavailableWarnAt,
			unavailableCriticalAt:
				thresholds.unavailableCriticalAt ??
				fallbackThresholds.unavailableCriticalAt,
			configDriftWarnAt:
				thresholds.configDriftWarnAt ?? fallbackThresholds.configDriftWarnAt,
			staleCacheWarnAt:
				thresholds.staleCacheWarnAt ?? fallbackThresholds.staleCacheWarnAt,
		},
	};
}

export function summarizeRuntimeDescriptorRevocationReportTimeline(reports) {
	return reports.map((report) => {
		const bySeverity = resolveAlertCountBySeverity(report.alerts);
		return {
			generatedAt: report.generatedAt,
			totalEvents: report.summary.totalEvents,
			unavailable:
				report.summary.byEvent["system:descriptor_revocation_unavailable"] ?? 0,
			configDrift:
				(report.summary.byEvent[
					"system:descriptor_revocation_config_invalid"
				] ?? 0) +
				(report.summary.byEvent[
					"system:descriptor_revocation_config_conflict"
				] ?? 0),
			staleCache:
				report.summary.byEvent[
					"system:descriptor_revocation_stale_cache_used"
				] ?? 0,
			alerts: {
				...bySeverity,
				total: report.alerts.length,
			},
		};
	});
}

export function buildCounterDelta(current = {}, previous = {}) {
	const keys = new Set([...Object.keys(current), ...Object.keys(previous)]);
	const delta = {};
	for (const key of Array.from(keys).sort((a, b) => a.localeCompare(b))) {
		delta[key] = (current[key] ?? 0) - (previous[key] ?? 0);
	}
	return delta;
}

export function buildRuntimeDescriptorRevocationReportDelta(current, previous) {
	if (!current || !previous) return null;

	const currentAlertsById = Object.fromEntries(
		current.alerts.map((alert) => [alert.id, alert]),
	);
	const previousAlertsById = Object.fromEntries(
		previous.alerts.map((alert) => [alert.id, alert]),
	);
	const alertIds = Array.from(
		new Set([
			...Object.keys(currentAlertsById),
			...Object.keys(previousAlertsById),
		]),
	).sort((a, b) => a.localeCompare(b));

	const bySeverityCurrent = resolveAlertCountBySeverity(current.alerts);
	const bySeverityPrevious = resolveAlertCountBySeverity(previous.alerts);

	const currentPlugins = new Set(current.summary.affectedPlugins);
	const previousPlugins = new Set(previous.summary.affectedPlugins);

	return {
		fromGeneratedAt: previous.generatedAt,
		toGeneratedAt: current.generatedAt,
		totalEventsDelta: current.summary.totalEvents - previous.summary.totalEvents,
		byEventDelta: buildCounterDelta(current.summary.byEvent, previous.summary.byEvent),
		byPolicyDelta: buildCounterDelta(
			current.summary.byPolicy,
			previous.summary.byPolicy,
		),
		byPolicySourceDelta: buildCounterDelta(
			current.summary.byPolicySource,
			previous.summary.byPolicySource,
		),
		byProfileDelta: buildCounterDelta(
			current.summary.byProfile,
			previous.summary.byProfile,
		),
		affectedPluginsAdded: Array.from(currentPlugins)
			.filter((pluginId) => !previousPlugins.has(pluginId))
			.sort((a, b) => a.localeCompare(b)),
		affectedPluginsRemoved: Array.from(previousPlugins)
			.filter((pluginId) => !currentPlugins.has(pluginId))
			.sort((a, b) => a.localeCompare(b)),
		alertSeverityDelta: {
			info: bySeverityCurrent.info - bySeverityPrevious.info,
			warn: bySeverityCurrent.warn - bySeverityPrevious.warn,
			critical: bySeverityCurrent.critical - bySeverityPrevious.critical,
		},
		alerts: alertIds.map((id) => {
			const currentAlert = currentAlertsById[id];
			const previousAlert = previousAlertsById[id];
			return {
				id,
				currentCount: currentAlert?.count ?? 0,
				previousCount: previousAlert?.count ?? 0,
				deltaCount: (currentAlert?.count ?? 0) - (previousAlert?.count ?? 0),
				currentSeverity: currentAlert?.severity ?? null,
				previousSeverity: previousAlert?.severity ?? null,
			};
		}),
	};
}

export function buildRuntimeDescriptorRevocationHistorySnapshot(
	reports,
	options = {},
) {
	const normalized = (Array.isArray(reports) ? reports : [])
		.map((report, index) =>
			normalizeRuntimeDescriptorRevocationReport(
				report,
				report?.sourcePath ?? `report-${index + 1}`,
			),
		)
		.sort((a, b) => a.generatedAt.localeCompare(b.generatedAt));

	const maxPoints =
		toPositiveInteger(options.maxPoints) ??
		(options.maxPoints === 0 ? 0 : normalized.length);
	const selected =
		maxPoints > 0 && normalized.length > maxPoints
			? normalized.slice(-maxPoints)
			: normalized;

	const latest = selected.at(-1) ?? null;
	const previous = selected.length > 1 ? selected.at(-2) : null;
	const delta =
		latest && previous
			? buildRuntimeDescriptorRevocationReportDelta(latest, previous)
			: null;

	return {
		generatedAt: options.generatedAt ?? new Date().toISOString(),
		reportsAnalyzed: selected.length,
		timeline: summarizeRuntimeDescriptorRevocationReportTimeline(selected),
		latest,
		previous,
		delta,
	};
}

export function renderRuntimeDescriptorRevocationHistoryMarkdown(snapshot) {
	const lines = [];
	lines.push("# Runtime Descriptor Revocation History");
	lines.push("");
	lines.push(`Generated at: ${snapshot.generatedAt}`);
	lines.push(`Reports analyzed: ${snapshot.reportsAnalyzed}`);
	lines.push("");

	if (snapshot.reportsAnalyzed === 0) {
		lines.push("No reports available.");
		lines.push("");
		return lines.join("\n");
	}

	lines.push("## Timeline");
	lines.push("");
	lines.push(
		"| generatedAt | totalEvents | unavailable | configDrift | staleCache | alerts(critical/warn/info) |",
	);
	lines.push("|---|---:|---:|---:|---:|---|");
	for (const point of snapshot.timeline) {
		lines.push(
			`| ${point.generatedAt} | ${point.totalEvents} | ${point.unavailable} | ${point.configDrift} | ${point.staleCache} | ${point.alerts.critical}/${point.alerts.warn}/${point.alerts.info} |`,
		);
	}
	lines.push("");

	if (!snapshot.delta) {
		lines.push("No previous report available to compute delta.");
		lines.push("");
		return lines.join("\n");
	}

	lines.push("## Latest delta (current vs previous)");
	lines.push("");
	lines.push(`- from: ${snapshot.delta.fromGeneratedAt}`);
	lines.push(`- to: ${snapshot.delta.toGeneratedAt}`);
	lines.push(`- totalEvents delta: **${snapshot.delta.totalEventsDelta}**`);
	lines.push("");

	lines.push("### Event deltas");
	lines.push("");
	lines.push("| Event | Delta |");
	lines.push("|---|---:|");
	for (const [event, delta] of Object.entries(snapshot.delta.byEventDelta)) {
		lines.push(`| ${event} | ${delta} |`);
	}
	lines.push("");

	lines.push("### Alert severity deltas");
	lines.push("");
	lines.push("| Severity | Delta |");
	lines.push("|---|---:|");
	lines.push(`| critical | ${snapshot.delta.alertSeverityDelta.critical} |`);
	lines.push(`| warn | ${snapshot.delta.alertSeverityDelta.warn} |`);
	lines.push(`| info | ${snapshot.delta.alertSeverityDelta.info} |`);
	lines.push("");

	lines.push("### Affected plugin changes");
	lines.push("");
	lines.push(
		`- added: ${snapshot.delta.affectedPluginsAdded.join(", ") || "(none)"}`,
	);
	lines.push(
		`- removed: ${snapshot.delta.affectedPluginsRemoved.join(", ") || "(none)"}`,
	);
	lines.push("");

	return lines.join("\n");
}
