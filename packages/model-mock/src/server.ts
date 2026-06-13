import http from "node:http";
import {
	MODEL_MOCK_DEFAULT_MODEL,
	readJsonBody,
	writeJsonResponse,
	writeSseResponse,
} from "./format.js";
import type { CapturedRequest, MockResponse, ModelMockOptions } from "./types.js";

export class ModelMockServer {
	private readonly server: http.Server;
	private readonly responseQueue: MockResponse[] = [];
	private lastResponse: MockResponse | null = null;
	readonly requests: CapturedRequest[] = [];

	constructor(private readonly opts: ModelMockOptions = {}) {
		this.server = http.createServer((req, res) => {
			void this.handle(req, res);
		});
	}

	queue(response: MockResponse): this {
		this.responseQueue.push(response);
		return this;
	}

	/** Environment variables to inject into farmhand/tractor subprocess. */
	get env(): Record<string, string> {
		return {
			MODEL_PROVIDER: "openai",
			MODEL_BASE_URL: `http://127.0.0.1:${this.port}`,
			MODEL_ID: MODEL_MOCK_DEFAULT_MODEL,
			// suppress real API key checks
			OPENAI_API_KEY: "mock-key",
		};
	}

	get port(): number {
		const addr = this.server.address();
		if (!addr || typeof addr === "string") throw new Error("Server not started");
		return addr.port;
	}

	async start(): Promise<this> {
		await new Promise<void>((resolve) =>
			this.server.listen(0, "127.0.0.1", resolve),
		);
		return this;
	}

	async stop(): Promise<void> {
		await new Promise<void>((resolve, reject) =>
			this.server.close((err) => (err ? reject(err) : resolve())),
		);
	}

	private dequeue(): MockResponse {
		const next = this.responseQueue.shift();
		if (next) {
			this.lastResponse = next;
			return next;
		}
		if (this.opts.repeatLast && this.lastResponse) return this.lastResponse;
		throw new Error(
			`[model-mock] Queue exhausted after ${this.requests.length} request(s). ` +
				`Queue more responses with mock.queue(says("...")).`,
		);
	}

	private async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
		if (req.method !== "POST" || !req.url?.includes("chat/completions")) {
			res.writeHead(404).end();
			return;
		}

		try {
			const body = (await readJsonBody(req)) as Record<string, unknown>;
			const captured: CapturedRequest = {
				model: String(body.model ?? ""),
				messages: (body.messages as CapturedRequest["messages"]) ?? [],
				stream: body.stream === true,
				tools: body.tools,
			};
			this.requests.push(captured);

			const response = this.dequeue();
			if (captured.stream) {
				writeSseResponse(res, response);
			} else {
				writeJsonResponse(res, response);
			}
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			res.writeHead(500, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ error: { message: msg, type: "mock_error" } }));
		}
	}
}
