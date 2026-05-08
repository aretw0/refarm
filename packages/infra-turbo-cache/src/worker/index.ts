/**
 * Refarm Sovereign Turbo Cache
 *
 * Implements the Turborepo Remote Cache API v8 backed by Cloudflare R2.
 * Deploy once per project or organization; share across all CI runners and branches.
 *
 * Environment:
 *   AUTH_TOKEN (secret)  — Bearer token validated on every request
 *   TURBO_CACHE (R2)     — R2 bucket binding (see wrangler.toml)
 *
 * Turbo env vars for consumers (set in CI secrets):
 *   TURBO_API   = https://<your-worker>.workers.dev
 *   TURBO_TOKEN = <same value as AUTH_TOKEN>
 *   TURBO_TEAM  = <any slug, used to namespace cache keys>
 */

export interface Env {
	TURBO_CACHE: R2Bucket;
	AUTH_TOKEN: string;
}

const CORS: HeadersInit = {
	"Access-Control-Allow-Origin": "*",
	"Access-Control-Allow-Methods": "GET, PUT, HEAD, OPTIONS",
	"Access-Control-Allow-Headers":
		"Authorization, Content-Type, x-artifact-tag, x-artifact-duration",
};

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		if (request.method === "OPTIONS") {
			return new Response(null, { status: 204, headers: CORS });
		}

		if (!isAuthorized(request, env.AUTH_TOKEN)) {
			return respond({ error: "Unauthorized" }, 401);
		}

		const url = new URL(request.url);

		// Turbo posts analytics events here; we accept and discard them.
		if (url.pathname === "/v8/artifacts/events" && request.method === "POST") {
			return respond({}, 200);
		}

		const match = url.pathname.match(/^\/v8\/artifacts\/([a-f0-9]+)$/);
		if (!match) {
			return respond({ error: "Not Found" }, 404);
		}

		// Namespace by team so one bucket can serve multiple projects safely.
		const team = url.searchParams.get("teamId") ?? url.searchParams.get("slug") ?? "default";
		const key = `${team}/${match[1]!}`;

		switch (request.method) {
			case "HEAD": {
				const obj = await env.TURBO_CACHE.head(key);
				return new Response(null, { status: obj ? 200 : 404, headers: CORS });
			}

			case "GET": {
				const obj = await env.TURBO_CACHE.get(key);
				if (!obj) return respond({ error: "Not Found" }, 404);

				const headers = new Headers(CORS);
				headers.set("Content-Type", "application/octet-stream");
				const tag = obj.customMetadata?.["x-artifact-tag"];
				if (tag) headers.set("x-artifact-tag", tag);

				return new Response(obj.body, { status: 200, headers });
			}

			case "PUT": {
				if (!request.body) return respond({ error: "Empty body" }, 400);

				const tag = request.headers.get("x-artifact-tag") ?? undefined;
				await env.TURBO_CACHE.put(key, request.body, {
					httpMetadata: { contentType: "application/octet-stream" },
					customMetadata: tag ? { "x-artifact-tag": tag } : undefined,
				});

				return respond({ urls: [`${url.origin}/v8/artifacts/${match[1]!}`] }, 200);
			}

			default:
				return respond({ error: "Method Not Allowed" }, 405);
		}
	},
} satisfies ExportedHandler<Env>;

function isAuthorized(request: Request, token: string): boolean {
	return request.headers.get("Authorization") === `Bearer ${token}`;
}

function respond(body: unknown, status: number): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { ...CORS, "Content-Type": "application/json" },
	});
}
