export const DIAGNOSTIC_BUNDLE_WIRE = "diagnostic-bundle.v1" as const;
export const REDACTED = "<redacted>" as const;

export type DiagnosticValue =
	| null
	| boolean
	| number
	| string
	| DiagnosticValue[]
	| { [key: string]: DiagnosticValue };

export interface DiagnosticSection {
	id: string;
	source: string;
	data: DiagnosticValue;
}

export interface DiagnosticRedaction {
	path: string;
	reason: "sensitive-key" | "known-secret" | "credential-pattern" | "private-path";
}

export interface DiagnosticBundleV1 {
	wire: typeof DIAGNOSTIC_BUNDLE_WIRE;
	createdAt: string;
	producer: { name: string; version: string };
	sections: DiagnosticSection[];
	redaction: { applied: true; count: number; fields: DiagnosticRedaction[] };
}

export interface DiagnosticRedactionPolicy {
	knownSecrets?: readonly string[];
	privatePaths?: readonly string[];
	additionalSensitiveKeys?: readonly string[];
}

export interface DiagnosticBundleInput {
	createdAt: string;
	producer: { name: string; version: string };
	sections: readonly DiagnosticSection[];
}

const BEARER = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;
const CREDENTIALED_URL = /\b(https?:\/\/)[^\s/@:]+:[^\s/@]+@/gi;
const PRIVATE_KEY = /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSensitiveKey(key: string): boolean {
	const normalized = key.replaceAll(/[-_]/g, "").toLowerCase();
	return /(authorization|cookie|credential|password|passwd|privatekey|secret|setcookie|token|apikey)s?$/.test(
		normalized,
	);
}

function redactString(
	value: string,
	path: string,
	policy: DiagnosticRedactionPolicy,
	redactions: DiagnosticRedaction[],
): string {
	let output = value;
	for (const secret of policy.knownSecrets ?? []) {
		if (!secret || !output.includes(secret)) continue;
		output = output.split(secret).join(REDACTED);
		redactions.push({ path, reason: "known-secret" });
	}
	for (const privatePath of policy.privatePaths ?? []) {
		if (!privatePath || !output.includes(privatePath)) continue;
		output = output.split(privatePath).join("<private-path>");
		redactions.push({ path, reason: "private-path" });
	}
	for (const pattern of [BEARER, CREDENTIALED_URL, PRIVATE_KEY]) {
		pattern.lastIndex = 0;
		if (!pattern.test(output)) continue;
		pattern.lastIndex = 0;
		output = output.replace(pattern, (match) =>
			match.startsWith("http") ? `${match.slice(0, match.indexOf("//") + 2)}${REDACTED}@` : REDACTED,
		);
		redactions.push({ path, reason: "credential-pattern" });
	}
	return output;
}

function sanitizeValue(
	value: unknown,
	path: string,
	policy: DiagnosticRedactionPolicy,
	redactions: DiagnosticRedaction[],
): DiagnosticValue {
	if (value === null || typeof value === "boolean" || typeof value === "number") return value;
	if (typeof value === "string") return redactString(value, path, policy, redactions);
	if (Array.isArray(value)) {
		return value.map((entry, index) => sanitizeValue(entry, `${path}[${index}]`, policy, redactions));
	}
	if (!isRecord(value)) return String(value);
	const output: Record<string, DiagnosticValue> = {};
	for (const [key, entry] of Object.entries(value)) {
		const entryPath = path ? `${path}.${key}` : key;
		const additional = policy.additionalSensitiveKeys?.some(
			(candidate) => candidate.toLowerCase() === key.toLowerCase(),
		);
		if (isSensitiveKey(key) || additional) {
			output[key] = REDACTED;
			redactions.push({ path: entryPath, reason: "sensitive-key" });
			continue;
		}
		output[key] = sanitizeValue(entry, entryPath, policy, redactions);
	}
	return output;
}

export function createDiagnosticBundle(
	input: DiagnosticBundleInput,
	policy: DiagnosticRedactionPolicy = {},
): DiagnosticBundleV1 {
	const redactions: DiagnosticRedaction[] = [];
	const sections = input.sections.map((section, index) => ({
		id: section.id,
		source: section.source,
		data: sanitizeValue(section.data, `sections[${index}].data`, policy, redactions),
	}));
	return {
		wire: DIAGNOSTIC_BUNDLE_WIRE,
		createdAt: input.createdAt,
		producer: { ...input.producer },
		sections,
		redaction: { applied: true, count: redactions.length, fields: redactions },
	};
}

export interface DiagnosticBundleVerification {
	ok: boolean;
	issues: string[];
}

export function verifyDiagnosticBundle(
	bundle: unknown,
	policy: Pick<DiagnosticRedactionPolicy, "knownSecrets" | "privatePaths"> = {},
): DiagnosticBundleVerification {
	const issues: string[] = [];
	if (!isRecord(bundle) || bundle.wire !== DIAGNOSTIC_BUNDLE_WIRE) {
		return { ok: false, issues: ["unsupported diagnostic bundle wire"] };
	}
	if (typeof bundle.createdAt !== "string" || !Array.isArray(bundle.sections)) {
		issues.push("invalid diagnostic bundle shape");
	}
	const serialized = JSON.stringify(bundle);
	for (const secret of policy.knownSecrets ?? []) {
		if (secret && serialized.includes(secret)) issues.push("known secret remains in bundle");
	}
	for (const privatePath of policy.privatePaths ?? []) {
		if (privatePath && serialized.includes(privatePath)) issues.push("private path remains in bundle");
	}
	if (BEARER.test(serialized)) issues.push("bearer credential remains in bundle");
	BEARER.lastIndex = 0;
	if (CREDENTIALED_URL.test(serialized)) issues.push("credentialed URL remains in bundle");
	CREDENTIALED_URL.lastIndex = 0;
	if (PRIVATE_KEY.test(serialized)) issues.push("private key remains in bundle");
	PRIVATE_KEY.lastIndex = 0;
	return { ok: issues.length === 0, issues: [...new Set(issues)] };
}
