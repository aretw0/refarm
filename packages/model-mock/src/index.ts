export { ModelMockServer } from "./server.js";
export type { CapturedRequest, MockResponse, ModelMockOptions, SaysResponse } from "./types.js";
import { ModelMockServer } from "./server.js";
import type { ModelMockOptions, SaysResponse } from "./types.js";

/** Script a plain-text model response. */
export function says(text: string): SaysResponse {
	return { type: "says", text };
}

/** Start a mock OpenAI-compatible server on a random port. */
export async function createModelMock(opts?: ModelMockOptions): Promise<ModelMockServer> {
	return new ModelMockServer(opts).start();
}
