import http from "node:http";
import type {
	Effort,
	EffortLogEntry,
	EffortResult,
	EffortSummary,
} from "@refarm.dev/effort-contract-v1";

export interface SidecarAdapter {
	submit(effort: Effort): Promise<string>;
	query(effortId: string): Promise<EffortResult | null>;
	list(): Promise<EffortResult[]>;
	logs(effortId: string): Promise<EffortLogEntry[] | null>;
	retry(effortId: string): Promise<boolean>;
	cancel(effortId: string): Promise<boolean>;
	summary(): Promise<EffortSummary>;
	process(effort: Effort): Promise<void>;
}

export class HttpSidecar {
	private readonly server: http.Server;
	private readonly routeHandlers: Array<
		(req: http.IncomingMessage, res: http.ServerResponse) => boolean
	> = [];

	constructor(
		private readonly port: number,
		private readonly adapter: SidecarAdapter,
	) {
		this.server = http.createServer((req, res) => {
			void this.handle(req, res);
		});
	}

	async start(): Promise<void> {
		return new Promise((resolve) => {
			this.server.listen(this.port, "127.0.0.1", resolve);
		});
	}

	async stop(): Promise<void> {
		return new Promise((resolve, reject) => {
			this.server.close((error) => (error ? reject(error) : resolve()));
		});
	}

	addRouteHandler(
		handler: (req: http.IncomingMessage, res: http.ServerResponse) => boolean,
	): void {
		this.routeHandlers.push(handler);
	}

	get httpServer(): http.Server {
		return this.server;
	}

	private async handle(
		req: http.IncomingMessage,
		res: http.ServerResponse,
	): Promise<void> {
		const url = req.url ?? "/";

		try {
			for (const handler of this.routeHandlers) {
				if (handler(req, res)) return;
			}

			if (req.method === "POST" && url === "/efforts") {
				const effort = await readJson<Effort>(req);
				const effortId = await this.adapter.submit(effort);
				void this.adapter.process(effort);
				json(res, 200, { effortId });
				return;
			}

			if (req.method === "GET" && url === "/efforts") {
				json(res, 200, await this.adapter.list());
				return;
			}

			if (req.method === "GET" && url === "/efforts/summary") {
				json(res, 200, await this.adapter.summary());
				return;
			}

			const logsMatch = url.match(/^\/efforts\/([^/]+)\/logs$/);
			if (req.method === "GET" && logsMatch) {
				const logs = await this.adapter.logs(logsMatch[1]);
				if (!logs) {
					json(res, 404, { error: "not found" });
					return;
				}
				json(res, 200, logs);
				return;
			}

			const retryMatch = url.match(/^\/efforts\/([^/]+)\/retry$/);
			if (req.method === "POST" && retryMatch) {
				const accepted = await this.adapter.retry(retryMatch[1]);
				if (!accepted) {
					json(res, 409, { error: "retry not allowed" });
					return;
				}
				json(res, 202, { accepted: true });
				return;
			}

			const cancelMatch = url.match(/^\/efforts\/([^/]+)\/cancel$/);
			if (req.method === "POST" && cancelMatch) {
				const accepted = await this.adapter.cancel(cancelMatch[1]);
				if (!accepted) {
					json(res, 409, { error: "cancel not allowed" });
					return;
				}
				json(res, 202, { accepted: true });
				return;
			}

			const getMatch = url.match(/^\/efforts\/([^/]+)$/);
			if (req.method === "GET" && getMatch) {
				const result = await this.adapter.query(getMatch[1]);
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
