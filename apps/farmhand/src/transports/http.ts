import type { Effort } from "@refarm.dev/effort-contract-v1";
import http from "node:http";
import type { EffortOperations } from "../effort-operations.js";

export class HttpSidecar {
	private readonly server: http.Server;
	private readonly routeHandlers: Array<
		(req: http.IncomingMessage, res: http.ServerResponse) => boolean
	> = [];

	constructor(
		private readonly port: number,
		private readonly operations: EffortOperations,
		/** Bind address. Loopback by default; 0.0.0.0 exposes the sidecar to other
		 *  devices — an explicit operator decision, mirroring the Rust daemon's
		 *  `--http-host` (and the OPERATOR_PRIMITIVES Docker guidance). */
		private readonly host: string = "127.0.0.1",
	) {
		this.server = http.createServer((req, res) => {
			void this.handle(req, res);
		});
	}

	async start(): Promise<void> {
		return new Promise((resolve) => {
			this.server.listen(this.port, this.host, resolve);
		});
	}

	async stop(): Promise<void> {
		return new Promise((resolve, reject) => {
			this.server.close((error) => (error ? reject(error) : resolve()));
		});
	}

	addRouteHandler(handler: (req: http.IncomingMessage, res: http.ServerResponse) => boolean): void {
		this.routeHandlers.push(handler);
	}

	get httpServer(): http.Server {
		return this.server;
	}

	private async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
		const requestUrl = new URL(req.url ?? "/", "http://127.0.0.1");
		const pathname = requestUrl.pathname;

		try {
			for (const handler of this.routeHandlers) {
				if (handler(req, res)) return;
			}

			if (req.method === "POST" && pathname === "/efforts") {
				const effort = await readJson<Effort>(req);
				const effortId = await this.operations.submit(effort);
				void this.operations.process(effort);
				json(res, 200, { effortId });
				return;
			}

			if (req.method === "GET" && pathname === "/efforts") {
				json(res, 200, await this.operations.list());
				return;
			}

			if (req.method === "GET" && pathname === "/efforts/summary") {
				json(res, 200, await this.operations.summary());
				return;
			}

			if (req.method === "GET" && pathname === "/telemetry") {
				if (!this.operations.telemetry) {
					json(res, 404, { error: "not found" });
					return;
				}
				json(res, 200, await this.operations.telemetry());
				return;
			}

			if (req.method === "GET" && pathname === "/telemetry/window") {
				if (!this.operations.telemetryWindow) {
					json(res, 404, { error: "not found" });
					return;
				}
				const minutes = normalizePositiveInt(requestUrl.searchParams.get("minutes"), 60);
				json(res, 200, await this.operations.telemetryWindow(minutes));
				return;
			}

			const logsMatch = pathname.match(/^\/efforts\/([^/]+)\/logs$/);
			if (req.method === "GET" && logsMatch) {
				const logs = await this.operations.logs(logsMatch[1]!);
				if (!logs) {
					json(res, 404, { error: "not found" });
					return;
				}
				json(res, 200, logs);
				return;
			}

			const retryMatch = pathname.match(/^\/efforts\/([^/]+)\/retry$/);
			if (req.method === "POST" && retryMatch) {
				const accepted = await this.operations.retry(retryMatch[1]!);
				if (!accepted) {
					json(res, 409, { error: "retry not allowed" });
					return;
				}
				json(res, 202, { accepted: true });
				return;
			}

			const cancelMatch = pathname.match(/^\/efforts\/([^/]+)\/cancel$/);
			if (req.method === "POST" && cancelMatch) {
				const accepted = await this.operations.cancel(cancelMatch[1]!);
				if (!accepted) {
					json(res, 409, { error: "cancel not allowed" });
					return;
				}
				json(res, 202, { accepted: true });
				return;
			}

			const getMatch = pathname.match(/^\/efforts\/([^/]+)$/);
			if (req.method === "GET" && getMatch) {
				const result = await this.operations.query(getMatch[1]!);
				if (!result) {
					json(res, 404, { error: "not found" });
					return;
				}
				json(res, 200, result);
				return;
			}

			json(res, 404, { error: "not found" });
		} catch (error: unknown) {
			json(res, 500, {
				error: error instanceof Error ? error.message : String(error),
			});
		}
	}
}

function readJson<T>(req: http.IncomingMessage): Promise<T> {
	return new Promise((resolve, reject) => {
		let data = "";
		req.on("data", (chunk) => {
			data += chunk;
		});
		req.on("end", () => {
			try {
				resolve(JSON.parse(data) as T);
			} catch (error) {
				reject(error);
			}
		});
		req.on("error", reject);
	});
}

function json(res: http.ServerResponse, status: number, body: unknown): void {
	const payload = JSON.stringify(body);
	res.writeHead(status, {
		"content-type": "application/json",
		"content-length": Buffer.byteLength(payload),
	});
	res.end(payload);
}

function normalizePositiveInt(raw: string | null | undefined, fallback: number): number {
	const parsed = Number(raw);
	if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
	return Math.floor(parsed);
}
