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
