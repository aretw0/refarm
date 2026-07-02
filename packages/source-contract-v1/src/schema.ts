import type { MaterializeAction, MaterializeResult, SourceLocation } from "./types.js";

const ACTIONS: ReadonlySet<MaterializeAction> = new Set([
	"cloned",
	"reused",
	"fetched",
	"fast-forwarded",
	"linked",
	"noop",
]);

export function isSourceLocation(value: unknown): value is SourceLocation {
	if (typeof value !== "object" || value === null) return false;
	const candidate = value as Record<string, unknown>;
	return (
		(candidate.kind === "git" || candidate.kind === "tarball" || candidate.kind === "local") &&
		typeof candidate.path === "string" &&
		candidate.path.length > 0
	);
}

export function isMaterializeResult(value: unknown): value is MaterializeResult {
	if (typeof value !== "object" || value === null) return false;
	const candidate = value as Record<string, unknown>;
	return (
		isSourceLocation(candidate.location) &&
		typeof candidate.action === "string" &&
		ACTIONS.has(candidate.action as MaterializeAction) &&
		typeof candidate.stale === "boolean"
	);
}
