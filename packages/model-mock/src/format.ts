import type { IncomingMessage, ServerResponse } from "node:http";
import type { SaysResponse } from "./types.js";

const FAKE_ID = "chatcmpl-mock-0001";
const FAKE_MODEL = "gpt-4o-mini";

/** Non-streaming OpenAI JSON response */
export function writeJsonResponse(res: ServerResponse, response: SaysResponse): void {
	const body = JSON.stringify({
		id: FAKE_ID,
		object: "chat.completion",
		model: FAKE_MODEL,
		choices: [
			{
				index: 0,
				message: { role: "assistant", content: response.text },
				finish_reason: "stop",
			},
		],
		usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
	});
	res.writeHead(200, { "Content-Type": "application/json" });
	res.end(body);
}

/** Streaming SSE OpenAI response — emits content in one chunk then [DONE] */
export function writeSseResponse(res: ServerResponse, response: SaysResponse): void {
	res.writeHead(200, {
		"Content-Type": "text/event-stream",
		"Cache-Control": "no-cache",
		Connection: "keep-alive",
	});

	const delta = JSON.stringify({
		id: FAKE_ID,
		object: "chat.completion.chunk",
		model: FAKE_MODEL,
		choices: [{ index: 0, delta: { role: "assistant", content: response.text }, finish_reason: null }],
	});
	res.write(`data: ${delta}\n\n`);

	const done = JSON.stringify({
		id: FAKE_ID,
		object: "chat.completion.chunk",
		model: FAKE_MODEL,
		choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
	});
	res.write(`data: ${done}\n\n`);
	res.write("data: [DONE]\n\n");
	res.end();
}

export async function readJsonBody(req: IncomingMessage): Promise<unknown> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		req.on("data", (c: Buffer) => chunks.push(c));
		req.on("end", () => {
			try {
				resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
			} catch (e) {
				reject(e);
			}
		});
		req.on("error", reject);
	});
}
