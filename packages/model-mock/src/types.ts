export interface SaysResponse {
	type: "says";
	text: string;
}

export interface RawJsonResponse {
	type: "raw-json";
	body: unknown;
}

export type MockResponse = SaysResponse | RawJsonResponse;

export interface CapturedRequest {
	model: string;
	messages: Array<{ role: string; content: string }>;
	stream: boolean;
	tools?: unknown;
}

export interface ModelMockOptions {
	/** Default: queue exhausted → throw. Set to reuse last response when queue is empty. */
	repeatLast?: boolean;
}
