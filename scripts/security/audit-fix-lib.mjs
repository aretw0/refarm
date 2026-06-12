export function quoteYamlScalar(value) {
	const text = String(value);
	if (/^[A-Za-z0-9_.-]+$/.test(text)) return text;
	return JSON.stringify(text);
}

function unquoteYamlScalar(value) {
	const text = String(value).trim();
	if (text.startsWith('"')) {
		try {
			return JSON.parse(text);
		} catch {
			return text.replace(/^"|"$/g, "");
		}
	}
	return text.replace(/^'|'$/g, "");
}

export function parseWorkspaceOverridesText(text) {
	const lines = text.split(/\r?\n/);
	const start = lines.findIndex((line) => line.trim() === "overrides:");
	if (start === -1) return { text, lines, start: -1, end: -1, overrides: {} };

	let end = lines.length;
	for (let i = start + 1; i < lines.length; i += 1) {
		const line = lines[i];
		if (/^\S/.test(line) && line.trim() !== "") {
			end = i;
			break;
		}
	}

	const overrides = {};
	for (const line of lines.slice(start + 1, end)) {
		const match = line.match(/^  (?<key>"(?:\\.|[^"])*"|'[^']*'|[^:]+):\s*(?<value>.+?)\s*$/);
		if (!match?.groups) continue;
		const key = unquoteYamlScalar(match.groups.key);
		const value = unquoteYamlScalar(match.groups.value);
		overrides[key] = value;
	}

	return { text, lines, start, end, overrides };
}

export function renderWorkspaceOverridesText(state) {
	const entries = Object.entries(state.overrides).sort(([a], [b]) => a.localeCompare(b));
	const block = ["overrides:", ...entries.map(([key, value]) => `  ${quoteYamlScalar(key)}: ${quoteYamlScalar(value)}`)];

	const lines =
		state.start === -1
			? [...state.lines.filter((line, index) => index !== state.lines.length - 1 || line !== ""), ...block, ""]
			: [...state.lines.slice(0, state.start), ...block, ...state.lines.slice(state.end)];

	return lines.join("\n");
}

export function normalizeAuditVulnerabilities(report) {
	if (report.vulnerabilities && Object.keys(report.vulnerabilities).length > 0) {
		return report.vulnerabilities;
	}

	const advisories = report.advisories ?? {};
	const byPackage = {};
	for (const advisory of Object.values(advisories)) {
		const name = advisory.module_name;
		if (!name || byPackage[name]) continue;
		byPackage[name] = {
			range: advisory.vulnerable_versions ?? "",
			patchedVersions: advisory.patched_versions ?? "",
			fixAvailable: Boolean(advisory.patched_versions),
		};
	}
	return byPackage;
}

export function patchedMinimumVersion(vuln) {
	const patchedVersions = vuln.patchedVersions ?? vuln.patched_versions ?? "";
	return patchedVersions.match(/^>=\s*(\S+)/)?.[1] ?? null;
}

export function planAuditFixes({ vulnerabilities, workspacePackages, workspaceOverrides, safeVersionFor }) {
	const overrideUpdates = { ...workspaceOverrides };
	const packageUpdates = [];
	const messages = [];
	let changed = false;

	for (const [name, vuln] of Object.entries(vulnerabilities)) {
		const range = vuln.range ?? vuln.vulnerable_versions ?? "";
		if (!range || vuln.fixAvailable === false) {
			messages.push({ level: "warn", text: `${name}: no automatic fix available - review manually.` });
			continue;
		}

		const safe = safeVersionFor(name, vuln);
		if (!safe) {
			messages.push({ level: "warn", text: `${name}: could not determine safe version for range "${range}".` });
			continue;
		}

		messages.push({ level: "info", text: `${name} vulnerable: ${range} -> safe: ${safe}` });

		if (overrideUpdates[name]) {
			messages.push({ level: "info", text: `override ${overrideUpdates[name]} -> ${safe}` });
			overrideUpdates[name] = safe;
			changed = true;
		}

		let directDependencyChanged = false;
		for (const workspacePackage of workspacePackages) {
			const data = workspacePackage.data;
			for (const depField of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
				if (!data[depField]?.[name]) continue;

				const current = data[depField][name];
				if (current.startsWith("catalog:")) {
					messages.push({
						level: "info",
						text: `${workspacePackage.name} ${depField}.${name}: ${current} (kept; catalog policy stays centralized)`,
					});
					continue;
				}

				const next = `^${safe}`;
				if (current === next) continue;
				messages.push({ level: "info", text: `${workspacePackage.name} ${depField}.${name}: ${current} -> ${next}` });
				data[depField][name] = next;
				packageUpdates.push(workspacePackage);
				changed = true;
				directDependencyChanged = true;
			}
		}

		if (!directDependencyChanged && !overrideUpdates[name]) {
			messages.push({ level: "info", text: `adding workspace override: ${name} -> ${safe}` });
			overrideUpdates[name] = safe;
			changed = true;
		}
	}

	return {
		changed,
		messages,
		packageUpdates: [...new Set(packageUpdates)],
		workspaceOverrides: overrideUpdates,
	};
}
