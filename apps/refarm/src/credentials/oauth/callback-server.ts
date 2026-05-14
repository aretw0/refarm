import http from "node:http";
import { oauthSuccessHtml, oauthErrorHtml } from "./oauth-page.js";

export interface CallbackServer {
	waitForCode(): Promise<{ code: string; state: string } | null>;
	cancelWait(): void;
	close(): void;
}

export async function startCallbackServer(options: {
	port: number;
	path: string;
	expectedState: string;
}): Promise<CallbackServer> {
	const { port, path: callbackPath, expectedState } = options;

	let settle: ((v: { code: string; state: string } | null) => void) | undefined;
	const codePromise = new Promise<{ code: string; state: string } | null>((resolve) => {
		let settled = false;
		settle = (v) => {
			if (settled) return;
			settled = true;
			resolve(v);
		};
	});

	const server = http.createServer((req, res) => {
		try {
			const url = new URL(req.url ?? "/", "http://127.0.0.1");
			if (url.pathname !== callbackPath) {
				res.writeHead(404, { "content-type": "text/html; charset=utf-8" });
				res.end(oauthErrorHtml("Callback route not found."));
				return;
			}
			const code = url.searchParams.get("code");
			const state = url.searchParams.get("state");
			const error = url.searchParams.get("error");

			if (error) {
				res.writeHead(400, { "content-type": "text/html; charset=utf-8" });
				res.end(oauthErrorHtml("Authentication did not complete.", `Error: ${error}`));
				settle?.(null);
				return;
			}
			if (!code || !state || state !== expectedState) {
				res.writeHead(400, { "content-type": "text/html; charset=utf-8" });
				res.end(oauthErrorHtml("Invalid callback parameters."));
				settle?.(null);
				return;
			}
			res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
			res.end(oauthSuccessHtml("Authentication completed. You can close this window."));
			settle?.({ code, state });
		} catch {
			res.writeHead(500, { "content-type": "text/plain" });
			res.end("Internal error");
		}
	});

	return new Promise((resolve, reject) => {
		server.on("error", reject);
		server.listen(port, "127.0.0.1", () => {
			resolve({
				waitForCode: () => codePromise,
				cancelWait: () => settle?.(null),
				close: () => server.close(),
			});
		});
	});
}
