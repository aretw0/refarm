export type DiagnosticRecommendationSeverity = "failure" | "warning" | "info";

export interface DiagnosticRecommendation {
	diagnostic: string;
	summary: string;
	action: string;
	severity?: DiagnosticRecommendationSeverity;
	target?: string;
}
