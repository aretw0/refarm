import { createHash } from "node:crypto";

import {
	type SkillEngineBindingEnvelope,
	type SkillIoEnvelope,
	type SkillManifestIssue,
	type SkillManifestParseOptions,
	type SkillPolicyEnvelope,
	type SkillSourceRef,
} from "./types.js";

const CAPABILITY_ID_PATTERN = /^[a-z][a-z0-9]*(?:[.:/-][a-z0-9]+)*$/;
const ENGINE_BINDING_ID_PATTERN = /^[a-z][a-z0-9]*(?:[.:/-][a-z0-9]+)*$/;

export function slugify(value: string): string {
	const slug = value
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "");
	return slug || "unnamed";
}

export function stripQuotes(value: string): string {
	if (
		(value.startsWith('"') && value.endsWith('"')) ||
		(value.startsWith("'") && value.endsWith("'"))
	) {
		return value.slice(1, -1);
	}
	return value;
}

export function sha256(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

export function getString(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

export function getBoolean(value: unknown, fallback: boolean): boolean {
	if (typeof value !== "string") return fallback;
	const normalized = value.trim().toLowerCase();
	if (normalized === "true" || normalized === "yes") return true;
	if (normalized === "false" || normalized === "no") return false;
	return fallback;
}

export function isCapabilityId(value: unknown): value is string {
	return typeof value === "string" && CAPABILITY_ID_PATTERN.test(value);
}

export function isEngineBindingId(value: unknown): value is string {
	return typeof value === "string" && ENGINE_BINDING_ID_PATTERN.test(value);
}

export function isSha256(value: unknown): value is string {
	return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function issue(code: string, path: string, message: string): SkillManifestIssue {
	return { code, path, message };
}

export function requireExact(
	value: unknown,
	expected: string,
	path: string,
	issues: SkillManifestIssue[],
): void {
	if (value !== expected) {
		issues.push(issue("VALUE_INVALID", path, `Expected ${expected}.`));
	}
}

export function requireNonEmptyString(
	value: unknown,
	path: string,
	issues: SkillManifestIssue[],
): void {
	if (typeof value !== "string" || value.length === 0) {
		issues.push(issue("STRING_EMPTY", path, "Expected a non-empty string."));
	}
}

export function validateIsoTimestamp(
	value: unknown,
	path: string,
	issues: SkillManifestIssue[],
): void {
	requireNonEmptyString(value, path, issues);
	if (typeof value !== "string") return;
	const timestamp = Date.parse(value);
	if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== value) {
		issues.push(issue("TIMESTAMP_INVALID", path, "Expected an ISO-8601 timestamp."));
	}
}

export function engineBindingsEqual(left: unknown, right: unknown): boolean {
	if (!isRecord(left) || !isRecord(right)) return false;
	return (
		stringArraysEqual(left.requires, right.requires) &&
		stringArraysEqual(left.optional, right.optional)
	);
}

export function stringArraysEqual(left: unknown, right: unknown): boolean {
	if (left === undefined && right === undefined) return true;
	if (!Array.isArray(left) || !Array.isArray(right)) return false;
	if (left.length !== right.length) return false;
	return left.every((item, index) => item === right[index]);
}

export function normalizeCapabilityList(value: unknown): readonly string[] {
	if (Array.isArray(value)) {
		return value
			.map(String)
			.map((item) => item.trim())
			.filter(Boolean);
	}
	if (typeof value !== "string") return [];
	const trimmed = value.trim();
	if (!trimmed) return [];
	const withoutBrackets =
		trimmed.startsWith("[") && trimmed.endsWith("]") ? trimmed.slice(1, -1) : trimmed;
	return withoutBrackets
		.split(",")
		.map((item) => stripQuotes(item.trim()))
		.filter(Boolean);
}

export function normalizeEngineBindingList(value: unknown): readonly string[] {
	if (Array.isArray(value)) {
		return value
			.map(String)
			.map((item) => item.trim())
			.filter(Boolean);
	}
	if (typeof value !== "string") return [];
	const trimmed = value.trim();
	if (!trimmed) return [];
	const withoutBrackets =
		trimmed.startsWith("[") && trimmed.endsWith("]") ? trimmed.slice(1, -1) : trimmed;
	return withoutBrackets
		.split(",")
		.map((item) => stripQuotes(item.trim()))
		.filter(Boolean);
}

export function createSkillManifestId(name: string, hash: string): string {
	return `urn:sovereign:skill:v1:${slugify(name)}:${hash.slice(0, 12)}`;
}

export function parseFrontmatter(source: string): {
	frontmatter: Readonly<Record<string, string | readonly string[]>> | null;
	body: string;
	issues: SkillManifestIssue[];
} {
	const issues: SkillManifestIssue[] = [];
	if (!source.startsWith("---\n")) {
		issues.push(issue("FRONTMATTER_MISSING", "$", "Expected SKILL.md frontmatter."));
		return { frontmatter: null, body: source, issues };
	}
	const end = source.indexOf("\n---", 4);
	if (end === -1) {
		issues.push(issue("FRONTMATTER_UNCLOSED", "$", "Expected closing frontmatter marker."));
		return { frontmatter: null, body: source, issues };
	}

	const frontmatterLines = source.slice(4, end).split("\n");
	const bodyStart = source.indexOf("\n", end + 4);
	const body = bodyStart === -1 ? "" : source.slice(bodyStart + 1);
	const frontmatter: Record<string, string | readonly string[]> = {};

	for (let index = 0; index < frontmatterLines.length; index++) {
		const line = frontmatterLines[index] ?? "";
		if (!line.trim()) continue;
		const match = /^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/.exec(line);
		if (!match) {
			issues.push(
				issue("FRONTMATTER_LINE_INVALID", `$.frontmatter.${index}`, "Expected key: value."),
			);
			continue;
		}

		const key = match[1]!;
		const value = match[2]!.trim();
		if (value === ">" || value === "|") {
			const block: string[] = [];
			while (frontmatterLines[index + 1]?.startsWith(" ")) {
				index++;
				block.push((frontmatterLines[index] ?? "").trim());
			}
			frontmatter[key] = block.join(value === ">" ? " " : "\n").trim();
			continue;
		}

		if (value === "") {
			const list: string[] = [];
			while (/^\s*-\s+/.test(frontmatterLines[index + 1] ?? "")) {
				index++;
				list.push(stripQuotes((frontmatterLines[index] ?? "").replace(/^\s*-\s+/, "").trim()));
			}
			frontmatter[key] = list.length > 0 ? list : "";
			continue;
		}

		frontmatter[key] = stripQuotes(value);
	}

	return { frontmatter, body, issues };
}

export function createSkillSourceRef(
	source: string,
	options: SkillManifestParseOptions = {},
): SkillSourceRef {
	return {
		format: "SKILL.md",
		uri: options.sourceUri ?? "inline:skill",
		sha256: sha256(source),
		bytes: Buffer.byteLength(source),
	};
}

export function validateSource(value: unknown, path: string, issues: SkillManifestIssue[]): void {
	if (!isRecord(value)) {
		issues.push(issue("SOURCE_NOT_OBJECT", path, "Expected source object."));
		return;
	}
	requireExact(value.format, "SKILL.md", `${path}.format`, issues);
	requireNonEmptyString(value.uri, `${path}.uri`, issues);
	if (!isSha256(value.sha256)) {
		issues.push(
			issue("SOURCE_SHA256_INVALID", `${path}.sha256`, "Expected lowercase SHA-256 hex."),
		);
	}
	if (!Number.isInteger(value.bytes) || (value.bytes as number) <= 0) {
		issues.push(issue("SOURCE_BYTES_INVALID", `${path}.bytes`, "Expected a positive byte count."));
	}
}

export function validateCapabilities(
	value: unknown,
	path: string,
	issues: SkillManifestIssue[],
): void {
	if (!isRecord(value)) {
		issues.push(issue("CAPABILITIES_NOT_OBJECT", path, "Expected capabilities object."));
		return;
	}
	// `requires` may be empty: a permissive/adhoc skill (name + description +
	// body, e.g. a pi/claude-code SKILL.md) is a valid manifest. Declaring
	// capabilities graduates it to `complete` maturity and enables the capability
	// gate; the activation preflight simply skips an empty requires list. Shape is
	// still validated (must be an array of valid capability ids).
	validateCapabilityArray(value.requires, `${path}.requires`, issues);
	if (value.optional !== undefined) {
		validateCapabilityArray(value.optional, `${path}.optional`, issues);
	}
	if (value.provides !== undefined) {
		validateCapabilityArray(value.provides, `${path}.provides`, issues);
	}
}

export function validateEngineBindings(
	value: unknown,
	path: string,
	issues: SkillManifestIssue[],
): void {
	if (!isRecord(value)) {
		issues.push(issue("ENGINE_BINDINGS_NOT_OBJECT", path, "Expected engine binding object."));
		return;
	}
	validateEngineBindingArray(value.requires, `${path}.requires`, issues);
	if (value.optional !== undefined) {
		validateEngineBindingArray(value.optional, `${path}.optional`, issues);
	}
}

export function validatePolicy(value: unknown, path: string, issues: SkillManifestIssue[]): void {
	if (!isRecord(value)) {
		issues.push(issue("POLICY_NOT_OBJECT", path, "Expected policy object."));
		return;
	}
	const policy = value as Partial<SkillPolicyEnvelope>;
	if (policy.executionMode !== "plan-only" && policy.executionMode !== "host-invoked") {
		issues.push(
			issue(
				"POLICY_EXECUTION_MODE_INVALID",
				`${path}.executionMode`,
				"Expected a known execution mode.",
			),
		);
	}
	if (policy.toolAccess !== "declared-capabilities-only") {
		issues.push(
			issue(
				"POLICY_TOOL_ACCESS_INVALID",
				`${path}.toolAccess`,
				"Expected declared-capabilities-only.",
			),
		);
	}
}

export function validateIo(value: unknown, path: string, issues: SkillManifestIssue[]): void {
	if (!isRecord(value)) {
		issues.push(issue("IO_NOT_OBJECT", path, "Expected input/output envelope object."));
		return;
	}
	validateInputEnvelope(value.input, `${path}.input`, issues);
	validateOutputEnvelope(value.output, `${path}.output`, issues);
}

export function validateInputEnvelope(
	value: unknown,
	path: string,
	issues: SkillManifestIssue[],
): void {
	if (!isRecord(value)) {
		issues.push(issue("INPUT_NOT_OBJECT", path, "Expected input envelope object."));
		return;
	}
	requireExact(value.format, "text/markdown", `${path}.format`, issues);
	if (typeof value.required !== "boolean") {
		issues.push(issue("INPUT_REQUIRED_INVALID", `${path}.required`, "Expected boolean."));
	}
	if (value.description !== undefined) {
		requireNonEmptyString(value.description, `${path}.description`, issues);
	}
}

export function validateOutputEnvelope(
	value: unknown,
	path: string,
	issues: SkillManifestIssue[],
): void {
	if (!isRecord(value)) {
		issues.push(issue("OUTPUT_NOT_OBJECT", path, "Expected output envelope object."));
		return;
	}
	requireExact(value.format, "text/markdown", `${path}.format`, issues);
	if (value.description !== undefined) {
		requireNonEmptyString(value.description, `${path}.description`, issues);
	}
}

export function validateCapabilityArray(
	value: unknown,
	path: string,
	issues: SkillManifestIssue[],
	options: { requireNonEmpty?: boolean } = {},
): void {
	if (!Array.isArray(value)) {
		issues.push(issue("CAPABILITY_LIST_INVALID", path, "Expected an array of capability ids."));
		return;
	}
	if (options.requireNonEmpty && value.length === 0) {
		issues.push(issue("CAPABILITY_LIST_EMPTY", path, "Expected at least one required capability."));
	}
	value.forEach((item, index) => {
		if (!isCapabilityId(item)) {
			issues.push(
				issue("CAPABILITY_ID_INVALID", `${path}.${index}`, "Expected a valid capability id."),
			);
		}
	});
}

export function validateEngineBindingArray(
	value: unknown,
	path: string,
	issues: SkillManifestIssue[],
): void {
	if (!Array.isArray(value)) {
		issues.push(
			issue("ENGINE_BINDING_LIST_INVALID", path, "Expected an array of engine binding ids."),
		);
		return;
	}
	value.forEach((item, index) => {
		if (!isEngineBindingId(item)) {
			issues.push(
				issue(
					"ENGINE_BINDING_ID_INVALID",
					`${path}.${index}`,
					"Expected a valid engine binding id.",
				),
			);
		}
	});
}

export function createSkillIoEnvelope(
	frontmatter: Readonly<Record<string, string | readonly string[]>>,
): SkillIoEnvelope {
	const inputDescription = getString(frontmatter.input);
	const outputDescription = getString(frontmatter.output);
	return {
		input: {
			format: "text/markdown",
			required: getBoolean(frontmatter.inputRequired, false),
			...(inputDescription ? { description: inputDescription } : {}),
		},
		output: {
			format: "text/markdown",
			...(outputDescription ? { description: outputDescription } : {}),
		},
	};
}

export function createSkillEngineBindingEnvelope(
	frontmatter: Readonly<Record<string, string | readonly string[]>>,
): SkillEngineBindingEnvelope {
	const required = normalizeEngineBindingList(
		frontmatter.engineBindings ?? frontmatter.requiredEngineBindings ?? frontmatter.requiresEngines,
	);
	const optional = normalizeEngineBindingList(
		frontmatter.optionalEngineBindings ?? frontmatter.optionalEngines,
	);
	return {
		requires: required,
		...(optional.length > 0 ? { optional } : {}),
	};
}

export function validateSurfaceAssets(
	value: unknown,
	path: string,
	issues: SkillManifestIssue[],
): void {
	if (!Array.isArray(value)) {
		issues.push(
			issue("SURFACE_ASSETS_INVALID", path, "Expected an array of relative asset paths."),
		);
		return;
	}
	if (value.length === 0) {
		issues.push(issue("SURFACE_ASSETS_EMPTY", path, "Expected at least one skill asset path."));
	}
	value.forEach((item, index) => {
		validateSurfaceAssetPath(item, `${path}.${index}`, issues);
	});
}

export function validateSurfaceAssetPath(
	value: unknown,
	path: string,
	issues: SkillManifestIssue[],
): void {
	requireNonEmptyString(value, path, issues);
	if (typeof value !== "string") return;
	const trimmed = value.trim();
	if (trimmed.startsWith("/") || /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)) {
		issues.push(
			issue("SURFACE_ASSET_PATH_INVALID", path, "Expected a relative package asset path."),
		);
	}
}

export function validateSurfaceId(
	value: unknown,
	path: string,
	issues: SkillManifestIssue[],
): void {
	requireNonEmptyString(value, path, issues);
	if (typeof value !== "string") return;
	if (slugify(value) !== value) {
		issues.push(issue("SURFACE_ID_INVALID", path, "Expected a lowercase slug id."));
	}
}
