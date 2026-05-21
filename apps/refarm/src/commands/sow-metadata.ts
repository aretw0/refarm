import {
	defaultProviderModelId,
	defaultProviderModelRef,
} from "../model-routing.js";

const OPENAI_DEFAULT_REF = defaultProviderModelRef("openai");
const OPENAI_DEFAULT_MODEL_ID = defaultProviderModelId("openai");
const ANTHROPIC_DEFAULT_REF = defaultProviderModelRef("anthropic");
const OLLAMA_DEFAULT_REF = defaultProviderModelRef("ollama");

export const SOW_COMMAND_DESCRIPTION =
	"Configure refarm credentials (default: model provider only)";

export const SOW_MODEL_OPTION_DESCRIPTION =
	"Set the default model as provider/model, or model for the current provider";

export const SOW_HELP_TEXT = `

Examples:
  $ refarm sow
  $ refarm sow --cloudflare
  $ refarm sow --model ${OPENAI_DEFAULT_REF}
  $ refarm sow --model ${ANTHROPIC_DEFAULT_REF}
  $ refarm sow --model ${OLLAMA_DEFAULT_REF}
  $ refarm sow --model ${OPENAI_DEFAULT_MODEL_ID}

Notes:
  --model changes the saved provider/model routing. It does not collect a new
  API key or OAuth login; run plain refarm sow to configure credentials.
  A slash means provider/model, so custom or self-hosted providers can be saved
  directly, e.g. refarm sow --model vllm/Qwen3-Coder-480B-A35B-Instruct.
  Inside the refarm REPL, use /login or /sow to reconfigure without leaving the
  session. The Refarm runtime reloads Silo credentials before each task.
`;
