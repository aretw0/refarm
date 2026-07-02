import { MODEL_MOCK_DEFAULT_MODEL } from "./format.js";
import { ModelMockServer } from "./server.js";
import type {
	CapturedRequest,
	MockResponse,
	ModelMockOptions,
	RawJsonResponse,
	SaysResponse,
} from "./types.js";

export { MODEL_MOCK_DEFAULT_MODEL, ModelMockServer };
export type {
	CapturedRequest,
	MockResponse,
	ModelMockOptions,
	RawJsonResponse,
	SaysResponse,
	};

	/** Script a plain-text model response. */
	export function says(text: string): SaysResponse {
	return { type: "says", text };
	}

	/** Script an exact JSON response for OpenAI-compatible endpoints. */
	export function rawJson(body: unknown): RawJsonResponse {
	return { type: "raw-json", body };
	}

	/** Script an OpenAI chat tool-call response. Queue a final response after this. */
	export function toolCall(
	name: string,
	argumentsJson: Record<string, unknown>,
	opts: { id?: string; usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number } } = {},
	): RawJsonResponse {
	const id = opts.id ?? `call_${name}`;
	return rawJson({
		id: "chatcmpl-mock-tool-0001",
		object: "chat.completion",
		model: "gpt-5.5",
		choices: [
			{
				index: 0,
				message: {
					role: "assistant",
					content: null,
					tool_calls: [
						{
							id,
							type: "function",
							function: {
								name,
								arguments: JSON.stringify(argumentsJson),
							},
						},
					],
				},
				finish_reason: "tool_calls",
			},
		],
		usage: opts.usage ?? { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
	});
	}

	/** Start a mock OpenAI-compatible server on a random port. */
	export async function createModelMock(opts?: ModelMockOptions): Promise<ModelMockServer> {
	return new ModelMockServer(opts).start();
	}
