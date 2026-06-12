export function validateTextQualityConfig(config, configPath = null) {
	const issues = [];
	if (!config || typeof config !== "object" || Array.isArray(config)) {
		issues.push("config must be a JSON object");
	} else {
		if (
			config.longSentenceWords !== undefined &&
			!isNonNegativeNumber(config.longSentenceWords)
		) {
			issues.push("longSentenceWords must be a non-negative number");
		}
		validateRiskPatterns(config.riskPatterns, issues);
		validateNamedObject(config.profiles, "profiles", issues);
		validateNamedObject(config.audiences, "audiences", issues);
		validateParagraphStarterConfig(
			config.repetitionHeuristics?.paragraphStarter,
			issues,
			"repetitionHeuristics.paragraphStarter",
		);
		validateRubricConfig(config.rubric, issues, "rubric");
	}
	if (issues.length === 0) return;
	const location = configPath ? `: ${configPath}` : "";
	const error = new Error(
		`Invalid text quality config${location}: ${issues.join("; ")}`,
	);
	error.code = "ERR_TEXT_QUALITY_CONFIG_SCHEMA";
	error.configPath = configPath;
	error.issues = issues;
	throw error;
}

function validateRiskPatterns(patterns, issues) {
	if (patterns === undefined) return;
	if (!Array.isArray(patterns)) {
		issues.push("riskPatterns must be an array");
		return;
	}
	for (const [index, pattern] of patterns.entries()) {
		const prefix = `riskPatterns[${index}]`;
		if (!pattern || typeof pattern !== "object" || Array.isArray(pattern)) {
			issues.push(`${prefix} must be an object`);
			continue;
		}
		if (!isNonEmptyString(pattern.id)) {
			issues.push(`${prefix}.id must be a non-empty string`);
		}
		if (!["fail", "warn", "info", undefined].includes(pattern.severity)) {
			issues.push(`${prefix}.severity must be fail, warn, or info`);
		}
		if (!isNonEmptyString(pattern.regex)) {
			issues.push(`${prefix}.regex must be a non-empty string`);
		} else {
			try {
				new RegExp(pattern.regex, "u");
			} catch {
				issues.push(`${prefix}.regex must be a valid regular expression`);
			}
		}
	}
}

function validateNamedObject(value, field, issues) {
	if (value === undefined) return;
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		issues.push(`${field} must be an object`);
		return;
	}
	for (const [name, entry] of Object.entries(value)) {
		if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
			issues.push(`${field}.${name} must be an object`);
			continue;
		}
		if (
			entry.longSentenceWords !== undefined &&
			!isNonNegativeNumber(entry.longSentenceWords)
		) {
			issues.push(`${field}.${name}.longSentenceWords must be a non-negative number`);
		}
		validateParagraphStarterConfig(
			entry.repetitionHeuristics?.paragraphStarter,
			issues,
			`${field}.${name}.repetitionHeuristics.paragraphStarter`,
		);
		validateRubricConfig(entry.rubric, issues, `${field}.${name}.rubric`);
	}
}

function validateParagraphStarterConfig(config, issues, field) {
	if (config === undefined) return;
	if (!config || typeof config !== "object" || Array.isArray(config)) {
		issues.push(`${field} must be an object`);
		return;
	}
	for (const key of [
		"ngramWords",
		"windowParagraphs",
		"minOccurrencesInWindow",
		"minWordLength",
	]) {
		if (config[key] !== undefined && !isPositiveInteger(config[key])) {
			issues.push(`${field}.${key} must be a positive integer`);
		}
	}
	if (config.enabled !== undefined && typeof config.enabled !== "boolean") {
		issues.push(`${field}.enabled must be a boolean`);
	}
	if (
		config.ignoreStarters !== undefined &&
		(!Array.isArray(config.ignoreStarters) ||
			config.ignoreStarters.some((starter) => typeof starter !== "string"))
	) {
		issues.push(`${field}.ignoreStarters must be an array of strings`);
	}
}

function validateRubricConfig(config, issues, field) {
	if (config === undefined) return;
	if (!config || typeof config !== "object" || Array.isArray(config)) {
		issues.push(`${field} must be an object`);
		return;
	}
	if (config.enabled !== undefined && typeof config.enabled !== "boolean") {
		issues.push(`${field}.enabled must be a boolean`);
	}
	if (config.scale !== undefined && !isPositiveNumber(config.scale)) {
		issues.push(`${field}.scale must be a positive number`);
	}
	if (config.criteria === undefined) return;
	if (!Array.isArray(config.criteria)) {
		issues.push(`${field}.criteria must be an array`);
		return;
	}
	for (const [index, criterion] of config.criteria.entries()) {
		const prefix = `${field}.criteria[${index}]`;
		if (!criterion || typeof criterion !== "object" || Array.isArray(criterion)) {
			issues.push(`${prefix} must be an object`);
			continue;
		}
		if (!isNonEmptyString(criterion.id)) {
			issues.push(`${prefix}.id must be a non-empty string`);
		}
		if (criterion.label !== undefined && !isNonEmptyString(criterion.label)) {
			issues.push(`${prefix}.label must be a non-empty string`);
		}
		if (criterion.weight !== undefined && !isNonNegativeNumber(criterion.weight)) {
			issues.push(`${prefix}.weight must be a non-negative number`);
		}
		if (!["fail", "warn", "info", undefined].includes(criterion.severity)) {
			issues.push(`${prefix}.severity must be fail, warn, or info`);
		}
		validateRubricPatterns(
			criterion.requiredPatterns,
			issues,
			`${prefix}.requiredPatterns`,
		);
		validateRubricPatterns(
			criterion.forbiddenPatterns,
			issues,
			`${prefix}.forbiddenPatterns`,
		);
	}
}

function validateRubricPatterns(patterns, issues, field) {
	if (patterns === undefined) return;
	if (!Array.isArray(patterns)) {
		issues.push(`${field} must be an array`);
		return;
	}
	for (const [index, pattern] of patterns.entries()) {
		const prefix = `${field}[${index}]`;
		if (!pattern || typeof pattern !== "object" || Array.isArray(pattern)) {
			issues.push(`${prefix} must be an object`);
			continue;
		}
		if (!isNonEmptyString(pattern.id)) {
			issues.push(`${prefix}.id must be a non-empty string`);
		}
		if (
			pattern.description !== undefined &&
			!isNonEmptyString(pattern.description)
		) {
			issues.push(`${prefix}.description must be a non-empty string`);
		}
		if (!isNonEmptyString(pattern.regex)) {
			issues.push(`${prefix}.regex must be a non-empty string`);
		} else {
			try {
				new RegExp(pattern.regex, "u");
			} catch {
				issues.push(`${prefix}.regex must be a valid regular expression`);
			}
		}
	}
}

function isNonEmptyString(value) {
	return typeof value === "string" && value.trim().length > 0;
}

function isNonNegativeNumber(value) {
	return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isPositiveNumber(value) {
	return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function isPositiveInteger(value) {
	return Number.isInteger(value) && value > 0;
}
