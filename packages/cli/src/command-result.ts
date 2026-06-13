import { normalizeHandoffValues } from "./command-handoff.js";

export function parseCommandJsonPayload(stdout: string): unknown {
	const trimmed = stdout.trim();
	if (!trimmed) return undefined;
	const direct = parseJson(trimmed);
	if (direct !== undefined) return direct;

	const objectStart = trimmed.indexOf("{");
	const objectEnd = trimmed.lastIndexOf("}");
	if (objectStart === -1 || objectEnd <= objectStart) return undefined;
	return parseJson(trimmed.slice(objectStart, objectEnd + 1));
}

function parseJson(value: string): unknown {
	try {
		return JSON.parse(value);
	} catch {
		return undefined;
	}
}

export function commandPayloadOk(payload: unknown): boolean | undefined {
	if (!payload || typeof payload !== "object" || !("ok" in payload)) {
		return undefined;
	}
	const value = (payload as { ok?: unknown }).ok;
	return typeof value === "boolean" ? value : undefined;
}

export function commandPayloadNextActions(payload: unknown): string[] | undefined {
	return commandPayloadStringList(payload, "nextAction", "nextActions");
}

export function commandPayloadNextCommands(payload: unknown): string[] | undefined {
	return commandPayloadStringList(payload, "nextCommand", "nextCommands");
}

export function commandPayloadRecommendations(payload: unknown): unknown[] | undefined {
	if (!payload || typeof payload !== "object") return undefined;
	const value = (payload as Record<string, unknown>).recommendations;
	return Array.isArray(value) ? value : undefined;
}

function commandPayloadStringList(
	payload: unknown,
	singularKey: "nextAction" | "nextCommand",
	pluralKey: "nextActions" | "nextCommands",
): string[] | undefined {
	if (!payload || typeof payload !== "object") return undefined;
	const record = payload as Record<string, unknown>;
	const value = record[pluralKey];
	if (Array.isArray(value)) {
		const strings = normalizeHandoffValues(
			value.filter((item): item is string => typeof item === "string"),
		);
		if (strings.length > 0) return strings;
	}
	const singular = record[singularKey];
	const trimmed = typeof singular === "string" ? singular.trim() : "";
	return trimmed.length > 0
		? [trimmed]
		: undefined;
}
