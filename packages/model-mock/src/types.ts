export interface SaysResponse {
	type: "says";
	text: string;
}

export type MockResponse = SaysResponse;

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
