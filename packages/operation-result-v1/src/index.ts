import {
	createDiagnosticBundle,
	type DiagnosticRedactionPolicy,
	type DiagnosticValue,
} from "@refarm.dev/diagnostic-bundle-v1";

export const OPERATION_RESULT_WIRE = "operation-result.v1" as const;
export const MAX_OPERATION_RESULT_BYTES = 16_384;
export const MAX_OPERATION_SUMMARY_CHARS = 512;
export const MAX_OPERATION_METRICS = 32;
export const MAX_OPERATION_FINDINGS = 50;
export const MAX_OPERATION_FIELD_CHARS = 512;

export type OperationResultStatus = "succeeded" | "issues" | "failed";

export interface OperationMetricV1 {
	name: string;
	value: number;
	unit?: string;
}

export interface OperationFindingV1 {
	code: string;
	summary: string;
	location?: string;
}

export interface OperationResultV1 {
	wire: typeof OPERATION_RESULT_WIRE;
	status: OperationResultStatus;
	summary: string;
	metrics: OperationMetricV1[];
	findings: OperationFindingV1[];
	truncated: boolean;
	redactionCount: number;
}

export interface OperationResultInput {
	status: OperationResultStatus;
	summary: string;
	metrics?: readonly OperationMetricV1[];
	findings?: readonly OperationFindingV1[];
}

function bounded(value: string, max = MAX_OPERATION_FIELD_CHARS): [string, boolean] {
	return value.length <= max ? [value, false] : [value.slice(0, max), true];
}

function utf8ByteLength(value: string): number {
	let bytes = 0;
	for (const character of value) {
		const point = character.codePointAt(0)!;
		bytes += point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
	}
	return bytes;
}

function redactedStrings(
	input: OperationResultInput,
	policy: DiagnosticRedactionPolicy,
): { value: OperationResultInput; count: number } {
	const bundle = createDiagnosticBundle(
		{
			createdAt: "1970-01-01T00:00:00.000Z",
			producer: { name: "operation-result-v1", version: "1" },
			sections: [{ id: "result", source: "operation", data: input as unknown as DiagnosticValue }],
		},
		policy,
	);
	return {
		value: bundle.sections[0]!.data as DiagnosticValue as unknown as OperationResultInput,
		count: bundle.redaction.count,
	};
}

export function createOperationResult(
	input: OperationResultInput,
	policy: DiagnosticRedactionPolicy = {},
): OperationResultV1 {
	const sanitized = redactedStrings(input, policy);
	let truncated = false;
	const [summary, summaryTruncated] = bounded(String(sanitized.value.summary), MAX_OPERATION_SUMMARY_CHARS);
	truncated ||= summaryTruncated;
	const metrics = (sanitized.value.metrics ?? []).slice(0, MAX_OPERATION_METRICS).map((metric) => {
		const [name, nameTruncated] = bounded(String(metric.name));
		const [unit, unitTruncated] = bounded(String(metric.unit ?? ""), 64);
		truncated ||= nameTruncated || unitTruncated;
		const value = Number(metric.value);
		if (!Number.isFinite(value)) throw new TypeError(`operation metric ${name} must be finite`);
		return { name, value, ...(unit ? { unit } : {}) };
	});
	truncated ||= (sanitized.value.metrics?.length ?? 0) > MAX_OPERATION_METRICS;
	const findings = (sanitized.value.findings ?? []).slice(0, MAX_OPERATION_FINDINGS).map((finding) => {
		const [code, codeTruncated] = bounded(String(finding.code), 128);
		const [findingSummary, findingTruncated] = bounded(String(finding.summary));
		const [location, locationTruncated] = bounded(String(finding.location ?? ""));
		truncated ||= codeTruncated || findingTruncated || locationTruncated;
		return { code, summary: findingSummary, ...(location ? { location } : {}) };
	});
	truncated ||= (sanitized.value.findings?.length ?? 0) > MAX_OPERATION_FINDINGS;
	const result: OperationResultV1 = {
		wire: OPERATION_RESULT_WIRE,
		status: sanitized.value.status,
		summary,
		metrics,
		findings,
		truncated,
		redactionCount: sanitized.count,
	};
	while (
		utf8ByteLength(JSON.stringify(result)) > MAX_OPERATION_RESULT_BYTES &&
		(result.findings.length > 0 || result.metrics.length > 0)
	) {
		if (result.findings.length > 0) result.findings.pop();
		else result.metrics.pop();
		result.truncated = true;
	}
	if (utf8ByteLength(JSON.stringify(result)) > MAX_OPERATION_RESULT_BYTES)
		throw new Error(`operation result base envelope exceeds ${MAX_OPERATION_RESULT_BYTES} bytes`);
	return result;
}

export function verifyOperationResult(value: unknown): value is OperationResultV1 {
	if (typeof value !== "object" || value === null) return false;
	const result = value as Partial<OperationResultV1>;
	if (result.wire !== OPERATION_RESULT_WIRE) return false;
	if (!(["succeeded", "issues", "failed"] as unknown[]).includes(result.status)) return false;
	if (typeof result.summary !== "string" || result.summary.length > MAX_OPERATION_SUMMARY_CHARS) return false;
	if (!Array.isArray(result.metrics) || result.metrics.length > MAX_OPERATION_METRICS) return false;
	if (!Array.isArray(result.findings) || result.findings.length > MAX_OPERATION_FINDINGS) return false;
	if (typeof result.truncated !== "boolean" || typeof result.redactionCount !== "number") return false;
	if (
		!result.metrics.every(
			(metric) =>
				typeof metric === "object" &&
				metric !== null &&
				typeof metric.name === "string" &&
				metric.name.length <= MAX_OPERATION_FIELD_CHARS &&
				typeof metric.value === "number" &&
				Number.isFinite(metric.value) &&
				(metric.unit === undefined || (typeof metric.unit === "string" && metric.unit.length <= 64)),
		)
	)
		return false;
	if (
		!result.findings.every(
			(finding) =>
				typeof finding === "object" &&
				finding !== null &&
				typeof finding.code === "string" &&
				finding.code.length <= 128 &&
				typeof finding.summary === "string" &&
				finding.summary.length <= MAX_OPERATION_FIELD_CHARS &&
				(finding.location === undefined ||
					(typeof finding.location === "string" &&
						finding.location.length <= MAX_OPERATION_FIELD_CHARS)),
		)
	)
		return false;
	return utf8ByteLength(JSON.stringify(value)) <= MAX_OPERATION_RESULT_BYTES;
}
