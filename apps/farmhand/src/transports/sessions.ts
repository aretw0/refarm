import crypto from "node:crypto";
import type http from "node:http";

interface SessionNode {
	"@type": "Session";
	"@id": string;
	name: string | null;
	leaf_entry_id: null;
	parent_session_id: null;
	created_at_ns: number;
}

interface SessionStore {
	queryNodes(type: string): Promise<Record<string, unknown>[]>;
	storeNode(node: Record<string, unknown>): Promise<void>;
}

function json(res: http.ServerResponse, status: number, body: unknown): void {
	const payload = JSON.stringify(body);
	res.writeHead(status, {
		"content-type": "application/json",
		"content-length": Buffer.byteLength(payload),
	});
	res.end(payload);
}

function readJson<T>(req: http.IncomingMessage): Promise<T> {
	return new Promise((resolve, reject) => {
		let data = "";
		req.on("data", (chunk) => {
			data += chunk;
		});
		req.on("end", () => {
			try {
				resolve((data ? JSON.parse(data) : {}) as T);
			} catch (error) {
				reject(error);
			}
		});
		req.on("error", reject);
	});
}

function normalizeSession(node: Record<string, unknown>): SessionNode | null {
	if (node["@type"] !== "Session") return null;
	const id = node["@id"];
	if (typeof id !== "string" || id.length === 0) return null;

	const createdAt = node["created_at_ns"];
	return {
		"@type": "Session",
		"@id": id,
		name: typeof node.name === "string" ? node.name : null,
		leaf_entry_id: null,
		parent_session_id: null,
		created_at_ns:
			typeof createdAt === "number" ? createdAt : Date.now() * 1_000_000,
	};
}

export function createSessionsRouteHandler(store: SessionStore) {
	return (req: http.IncomingMessage, res: http.ServerResponse): boolean => {
		const requestUrl = new URL(req.url ?? "/", "http://127.0.0.1");
		if (requestUrl.pathname !== "/sessions") return false;

		void (async () => {
			try {
				if (req.method === "GET") {
					const rawLimit = requestUrl.searchParams.get("limit");
					let limit: number | undefined;
					if (rawLimit !== null) {
						const parsedLimit = Number.parseInt(rawLimit, 10);
						if (
							!/^\d+$/u.test(rawLimit) ||
							!Number.isInteger(parsedLimit) ||
							parsedLimit < 1 ||
							parsedLimit > 200
						) {
							json(res, 400, { error: "invalid limit" });
							return;
						}
						limit = parsedLimit;
					}
					const rows = await store.queryNodes("Session");
					const sessions = rows
						.map((row) => normalizeSession(row))
						.filter((row): row is SessionNode => row !== null)
						.sort((a, b) => b.created_at_ns - a.created_at_ns)
						.slice(0, limit);
					json(res, 200, { sessions });
					return;
				}

				if (req.method === "POST") {
					const body = await readJson<{ name?: unknown }>(req).catch(
						() => null,
					);
					if (body === null) {
						json(res, 400, { error: "invalid json" });
						return;
					}

					const rawName = body.name;
					const name =
						typeof rawName === "string" && rawName.trim().length > 0
							? rawName.trim()
							: null;
					const session: SessionNode = {
						"@type": "Session",
						"@id": `urn:refarm:session:v1:${crypto.randomUUID().replace(/-/g, "")}`,
						name,
						leaf_entry_id: null,
						parent_session_id: null,
						created_at_ns: Date.now() * 1_000_000,
					};

					await store.storeNode(session as unknown as Record<string, unknown>);
					json(res, 200, { session });
					return;
				}

				json(res, 405, { error: "method not allowed" });
			} catch (error) {
				json(res, 500, {
					error: error instanceof Error ? error.message : String(error),
				});
			}
		})();

		return true;
	};
}
