import type http from "node:http";
import {
	buildChannelEffort,
	isChannelEffortPayload,
} from "@refarm.dev/dispatch-surface";
import type { SidecarAdapter } from "./http.js";

function readJson<T>(req: http.IncomingMessage): Promise<T> {
	return new Promise((resolve, reject) => {
		let data = "";
		req.on("data", (chunk) => {
			data += chunk;
		});
		req.on("error", reject);
		req.on("end", () => {
			try {
				resolve(data ? (JSON.parse(data) as T) : ({} as T));
			} catch (error) {
				reject(error);
			}
		});
	});
}

function toJson(res: http.ServerResponse, status: number, body: unknown): void {
	const payload = JSON.stringify(body);
	res.writeHead(status, {
		"content-type": "application/json",
		"content-length": Buffer.byteLength(payload),
	});
	res.end(payload);
}

export function createControlSurfaceRouteHandler(adapter: SidecarAdapter) {
	return (req: http.IncomingMessage, res: http.ServerResponse): boolean => {
		const requestUrl = new URL(req.url ?? "/", "http://127.0.0.1");
		const { pathname } = requestUrl;

		const submitMatch = pathname.match(/^\/channels\/([^/]+)\/efforts$/);
		if (submitMatch && req.method === "POST") {
			void (async () => {
				try {
					const channel = decodeURIComponent(submitMatch[1] ?? "");
					const body = await readJson<unknown>(req);

					if (!isChannelEffortPayload(body)) {
						toJson(res, 400, {
							error: "invalid-effort-payload",
							message: "Effort payload must include direction and tasks.",
						});
						return;
					}

					const effort = buildChannelEffort(body, channel);
					const effortId = await adapter.submit(effort);
					void adapter.process(effort);
					toJson(res, 200, {
						effortId,
						source: effort.source,
						channel,
					});
				} catch (error) {
					toJson(res, 500, {
						error: error instanceof Error ? error.message : String(error),
					});
				}
			})();

			return true;
		}

		const logsMatch = pathname.match(
			/^\/channels\/([^/]+)\/efforts\/([^/]+)\/logs$/,
		);
		if (logsMatch && req.method === "GET") {
			void (async () => {
				try {
					const effortId = decodeURIComponent(logsMatch[2] ?? "");
					const result = await adapter.logs(effortId);
					if (!result) {
						toJson(res, 404, { error: "not found" });
						return;
					}
					toJson(res, 200, result);
				} catch (error) {
					toJson(res, 500, {
						error: error instanceof Error ? error.message : String(error),
					});
				}
			})();
			return true;
		}

		const retryMatch = pathname.match(
			/^\/channels\/([^/]+)\/efforts\/([^/]+)\/retry$/,
		);
		if (retryMatch && req.method === "POST") {
			void (async () => {
				try {
					const effortId = decodeURIComponent(retryMatch[2] ?? "");
					const accepted = await adapter.retry(effortId);
					if (!accepted) {
						toJson(res, 409, { error: "retry not allowed" });
						return;
					}
					toJson(res, 202, { accepted: true });
				} catch (error) {
					toJson(res, 500, {
						error: error instanceof Error ? error.message : String(error),
					});
				}
			})();
			return true;
		}

		const cancelMatch = pathname.match(
			/^\/channels\/([^/]+)\/efforts\/([^/]+)\/cancel$/,
		);
		if (cancelMatch && req.method === "POST") {
			void (async () => {
				try {
					const effortId = decodeURIComponent(cancelMatch[2] ?? "");
					const accepted = await adapter.cancel(effortId);
					if (!accepted) {
						toJson(res, 409, { error: "cancel not allowed" });
						return;
					}
					toJson(res, 202, { accepted: true });
				} catch (error) {
					toJson(res, 500, {
						error: error instanceof Error ? error.message : String(error),
					});
				}
			})();
			return true;
		}

		const statusMatch = pathname.match(
			/^\/channels\/([^/]+)\/efforts\/([^/]+)\/status$/,
		);
		if (statusMatch && req.method === "GET") {
			void (async () => {
				try {
					const effortId = decodeURIComponent(statusMatch[2] ?? "");
					const result = await adapter.query(effortId);
					if (!result) {
						toJson(res, 404, { error: "not found" });
						return;
					}
					toJson(res, 200, result);
				} catch (error) {
					toJson(res, 500, {
						error: error instanceof Error ? error.message : String(error),
					});
				}
			})();
			return true;
		}

		const streamMatch = pathname.match(
			/^\/channels\/([^/]+)\/efforts\/([^/]+)\/stream$/,
		);
		if (streamMatch && req.method === "GET") {
			void (async () => {
				try {
					const effortId = decodeURIComponent(streamMatch[2] ?? "");
					const result = await adapter.logs(effortId);
					if (!result) {
						toJson(res, 404, { error: "not found" });
						return;
					}
					toJson(res, 200, result);
				} catch (error) {
					toJson(res, 500, {
						error: error instanceof Error ? error.message : String(error),
					});
				}
			})();
			return true;
		}

		const evidenceMatch = pathname.match(
			/^\/channels\/([^/]+)\/efforts\/([^/]+)\/evidence$/,
		);
		if (evidenceMatch && req.method === "GET") {
			void (async () => {
				try {
					const effortId = decodeURIComponent(evidenceMatch[2] ?? "");
					const result = await adapter.logs(effortId);
					if (!result) {
						toJson(res, 404, { error: "not found" });
						return;
					}
					toJson(res, 200, result);
				} catch (error) {
					toJson(res, 500, {
						error: error instanceof Error ? error.message : String(error),
					});
				}
			})();
			return true;
		}

		const statusByIdMatch = pathname.match(
			/^\/channels\/([^/]+)\/efforts\/([^/]+)$/,
		);
		if (statusByIdMatch && req.method === "GET") {
			void (async () => {
				try {
					const effortId = decodeURIComponent(statusByIdMatch[2] ?? "");
					const result = await adapter.query(effortId);
					if (!result) {
						toJson(res, 404, { error: "not found" });
						return;
					}
					toJson(res, 200, result);
				} catch (error) {
					toJson(res, 500, {
						error: error instanceof Error ? error.message : String(error),
					});
				}
			})();
			return true;
		}

		return false;
	};
}
