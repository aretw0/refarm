import {
	defaultProviderModelRef,
	defaultScopedModelRef,
} from "../model-routing.js";
import { refarmCommand } from "./command-handoff.js";

export const OPENAI_DEFAULT_REF = defaultProviderModelRef("openai");
export const OPENAI_WORKER_REF = defaultScopedModelRef("worker", "openai");
export const OPENAI_MONITOR_REF = defaultScopedModelRef("monitor", "openai");
export const OLLAMA_DEFAULT_REF = defaultProviderModelRef("ollama");

export const RESUME_JSON_COMMAND = refarmCommand(["resume", "--json"]);
export const AGENT_FINISH_AFTER_EDIT_RUN_JSON_COMMAND = refarmCommand([
	"agent",
	"finish",
	"--lane",
	"after-edit",
	"--run",
	"--json",
]);

export const SOW_INTERACTIVE_COMMAND = refarmCommand(["sow"]);
export const SOW_JSON_COMMAND = refarmCommand(["sow", "--json"]);
export const MODEL_CURRENT_JSON_COMMAND = refarmCommand([
	"model",
	"current",
	"--json",
]);
export const MODEL_PROVIDERS_JSON_COMMAND = refarmCommand([
	"model",
	"providers",
	"--json",
]);
export const OPERATOR_LINKS_CONFIG_COMMAND =
	refarmCommand(["config", "get", "operator.openExternalLinks", "--json"]);
export const LOCAL_MODEL_JSON_COMMAND =
	refarmCommand(["sow", "--model", OLLAMA_DEFAULT_REF, "--json"]);
export const OPENAI_MODEL_JSON_COMMAND =
	refarmCommand(["model", OPENAI_DEFAULT_REF, "--json"]);
export const OPENAI_WORKER_MODEL_JSON_COMMAND =
	refarmCommand([
		"model",
		"set",
		"--scope",
		"worker",
		OPENAI_WORKER_REF,
		"--json",
	]);
export const OPENAI_MONITOR_MODEL_JSON_COMMAND =
	refarmCommand([
		"model",
		"set",
		"--scope",
		"monitor",
		OPENAI_MONITOR_REF,
		"--json",
	]);
