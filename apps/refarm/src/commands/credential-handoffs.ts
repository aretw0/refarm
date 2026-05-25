import { defaultProviderModelRef } from "../model-routing.js";

export const OPENAI_DEFAULT_REF = defaultProviderModelRef("openai");
export const OLLAMA_DEFAULT_REF = defaultProviderModelRef("ollama");

export const SOW_INTERACTIVE_COMMAND = "refarm sow";
export const SOW_JSON_COMMAND = "refarm sow --json";
export const MODEL_CURRENT_JSON_COMMAND = "refarm model current --json";
export const MODEL_PROVIDERS_JSON_COMMAND = "refarm model providers --json";
export const OPERATOR_LINKS_CONFIG_COMMAND =
	"refarm config get operator.openExternalLinks --json";
export const LOCAL_MODEL_JSON_COMMAND =
	`refarm sow --model ${OLLAMA_DEFAULT_REF} --json`;
export const OPENAI_MODEL_JSON_COMMAND =
	`refarm model ${OPENAI_DEFAULT_REF} --json`;
