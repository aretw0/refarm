export function parseCommandJsonPayload(stdout: string): unknown {
	const trimmed = stdout.trim();
	if (!trimmed) return undefined;
	try {
		return JSON.parse(trimmed);
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
	return commandPayloadStringArray(payload, "nextActions");
}

export function commandPayloadNextCommands(payload: unknown): string[] | undefined {
	return commandPayloadStringArray(payload, "nextCommands");
}

function commandPayloadStringArray(
	payload: unknown,
	key: "nextActions" | "nextCommands",
): string[] | undefined {
	if (!payload || typeof payload !== "object") return undefined;
	const value = (payload as Record<string, unknown>)[key];
	if (!Array.isArray(value)) return undefined;
	const strings = value.filter((item): item is string => typeof item === "string");
	return strings.length > 0 ? strings : undefined;
}
