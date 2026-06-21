import {
	buildChannelEffort,
	CHANNEL_CONTROL_SURFACE_OPERATION_UNSUPPORTED_ERROR,
	hasChannelControlCapability,
	decodeChannel,
	isChannelEffortPayload,
	resolveChannelControlSurfaceAdapter,
	type ChannelControlSurfaceOperation,
} from "@refarm.dev/dispatch-surface";
import type http from "node:http";
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

function canChannelPerform(
	channel: string,
	action: ChannelControlSurfaceOperation,
): boolean {
	return hasChannelControlCapability(
		resolveChannelControlSurfaceAdapter(channel).adapter,
		action,
	);
}
export function createControlSurfaceRouteHandler(adapter: SidecarAdapter) {
	return (req: http.IncomingMessage, res: http.ServerResponse): boolean => {
		const requestUrl = new URL(req.url ?? "/", "http://127.0.0.1");
		const { pathname } = requestUrl;

		const decodedSegment = (value: string): string => decodeChannel(value);

		const submitMatch = pathname.match(/^\/channels\/([^/]+)\/efforts$/);
		if (submitMatch && req.method === "POST") {
			void (async () => {
				try {
					const channel = decodedSegment(submitMatch[1] ?? "");
					if (!canChannelPerform(channel, "submit")) {
						toJson(res, 405, {
							error: CHANNEL_CONTROL_SURFACE_OPERATION_UNSUPPORTED_ERROR,
						});
						return;
					}
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
					const channel = decodedSegment(logsMatch[1] ?? "");
					if (!canChannelPerform(channel, "logs")) {
						toJson(res, 405, {
							error: CHANNEL_CONTROL_SURFACE_OPERATION_UNSUPPORTED_ERROR,
						});
						return;
					}
					const effortId = decodedSegment(logsMatch[2] ?? "");
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
					const channel = decodedSegment(retryMatch[1] ?? "");
					if (!canChannelPerform(channel, "retry")) {
						toJson(res, 405, {
							error: CHANNEL_CONTROL_SURFACE_OPERATION_UNSUPPORTED_ERROR,
						});
						return;
					}
					const effortId = decodedSegment(retryMatch[2] ?? "");
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
					const channel = decodedSegment(cancelMatch[1] ?? "");
					if (!canChannelPerform(channel, "cancel")) {
						toJson(res, 405, {
							error: CHANNEL_CONTROL_SURFACE_OPERATION_UNSUPPORTED_ERROR,
						});
						return;
					}
					const effortId = decodedSegment(cancelMatch[2] ?? "");
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
					const channel = decodedSegment(statusMatch[1] ?? "");
					if (!canChannelPerform(channel, "query")) {
						toJson(res, 405, {
							error: CHANNEL_CONTROL_SURFACE_OPERATION_UNSUPPORTED_ERROR,
						});
						return;
					}
					const effortId = decodedSegment(statusMatch[2] ?? "");
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
					const channel = decodedSegment(streamMatch[1] ?? "");
					if (!canChannelPerform(channel, "logs")) {
						toJson(res, 405, {
							error: CHANNEL_CONTROL_SURFACE_OPERATION_UNSUPPORTED_ERROR,
						});
						return;
					}
					const effortId = decodedSegment(streamMatch[2] ?? "");
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
					const channel = decodedSegment(evidenceMatch[1] ?? "");
					if (!canChannelPerform(channel, "logs")) {
						toJson(res, 405, {
							error: CHANNEL_CONTROL_SURFACE_OPERATION_UNSUPPORTED_ERROR,
						});
						return;
					}
					const effortId = decodedSegment(evidenceMatch[2] ?? "");
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
					const channel = decodedSegment(statusByIdMatch[1] ?? "");
					if (!canChannelPerform(channel, "query")) {
						toJson(res, 405, {
							error: CHANNEL_CONTROL_SURFACE_OPERATION_UNSUPPORTED_ERROR,
						});
						return;
					}
					const effortId = decodedSegment(statusByIdMatch[2] ?? "");
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
