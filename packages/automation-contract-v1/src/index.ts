export { AUTOMATION_CAPABILITY } from "./types.js";
export type {
	ArtifactStatus,
	Automation,
	AutomationAdapter,
	AutomationBody,
	AutomationConformanceResult,
	AutomationFilter,
	AutomationSummary,
	AutomationTrigger,
	CronTrigger,
	EffortTemplate,
	EventTrigger,
	JsonSchema,
	ManualTrigger,
	PluginBody,
	StaticBody,
	TemplateBody,
} from "./types.js";
export { createInMemoryAutomationAdapter } from "./in-memory.js";
export type { InMemoryAutomationOptions } from "./in-memory.js";
export { runAutomationV1Conformance } from "./conformance.js";
