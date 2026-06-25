import {
	REQUIRED_TOKENS,
	type DsTheme,
	type DsThemeConformanceResult,
	type DsToken,
} from "./contract.js";

export function runDsThemeConformance(theme: Partial<DsTheme>): DsThemeConformanceResult {
	const missing = REQUIRED_TOKENS.filter(
		(token) => typeof theme[token] !== "string" || theme[token]!.trim().length === 0,
	) as DsToken[];
	return {
		pass: missing.length === 0,
		total: REQUIRED_TOKENS.length,
		failed: missing.length,
		missing,
	};
}
