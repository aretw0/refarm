/**
 * Refarm Turbo Cache Worker
 *
 * Implements the Turborepo Remote Cache API v8 backed by Cloudflare R2.
 *
 * Environment (secrets — set via wrangler secret put):
 *   AUTH_TOKEN            — Bearer token validated on every request
 *
 * Environment (vars — set via wrangler.toml [vars] or dashboard):
 *   MAX_ARTIFACT_BYTES    — Reject PUT requests larger than this (default: 50 MB)
 *   ARTIFACT_TTL_SECONDS  — Delete artifacts older than this on cleanup (default: 30 days).
 *                           Set to 0 to disable TTL-based deletion.
 *   CLEANUP_DRY_RUN       — Set to "true" to log what would be deleted without deleting (default: false)
 *
 * R2 binding:
 *   TURBO_CACHE           — R2 bucket (see wrangler.toml)
 *
 * Scheduled cleanup:
 *   The worker runs a daily Cron Trigger (see wrangler.toml [triggers]) that
 *   lists all objects and deletes those whose uploaded-at metadata exceeds TTL.
 *   R2 does not support native object expiration, so this is the authoritative
 *   cleanup mechanism.
 *
 * Turbo env vars for consumers (set in CI):
 *   TURBO_API   = https://<your-worker>.workers.dev
 *   TURBO_TOKEN = <same value as AUTH_TOKEN>
 *   TURBO_TEAM  = <any slug, used to namespace cache keys>
 */

export interface Env {
	TURBO_CACHE: R2Bucket;
	AUTH_TOKEN: string;
	MAX_ARTIFACT_BYTES: string;
	ARTIFACT_TTL_SECONDS: string;
	CLEANUP_DRY_RUN: string;
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
		const maxBytes = Number(env.MAX_ARTIFACT_BYTES) || 52_428_800;
		const ttlSeconds = Number(env.ARTIFACT_TTL_SECONDS) || 2_592_000;

		// Turbo posts analytics events here; we accept and discard them.
		if (url.pathname === "/v8/artifacts/events" && request.method === "POST") {
			return respond({}, 200);
		}

		// Manual cleanup trigger — authenticated, returns a dry-run or real report.
		// Useful for testing the retention policy without waiting for the cron schedule.
		if (url.pathname === "/v8/artifacts/cleanup" && request.method === "POST") {
			const dryRun = url.searchParams.get("dry_run") === "true" || env.CLEANUP_DRY_RUN === "true";
			const report = await runCleanup(env.TURBO_CACHE, ttlSeconds, dryRun);
			return respond(report, 200);
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
				if (!obj) return new Response(null, { status: 404, headers: CORS });
				const headers = new Headers(CORS);
				if (isStale(obj, ttlSeconds)) headers.set("x-artifact-stale", "1");
				return new Response(null, { status: 200, headers });
			}

			case "GET": {
				const obj = await env.TURBO_CACHE.get(key);
				if (!obj) return respond({ error: "Not Found" }, 404);

				const headers = new Headers(CORS);
				headers.set("Content-Type", "application/octet-stream");
				const tag = obj.customMetadata?.["x-artifact-tag"];
				if (tag) headers.set("x-artifact-tag", tag);
				if (isStale(obj, ttlSeconds)) headers.set("x-artifact-stale", "1");

				return new Response(obj.body, { status: 200, headers });
			}

			case "PUT": {
				if (!request.body) return respond({ error: "Empty body" }, 400);

				const contentLength = Number(request.headers.get("content-length") ?? 0);
				if (contentLength > maxBytes) {
					return respond(
						{ error: `Artifact exceeds size limit (${formatBytes(maxBytes)})` },
						413,
					);
				}

				const tag = request.headers.get("x-artifact-tag") ?? undefined;

				await env.TURBO_CACHE.put(key, request.body, {
					httpMetadata: { contentType: "application/octet-stream" },
					customMetadata: {
						...(tag ? { "x-artifact-tag": tag } : {}),
						"uploaded-at": new Date().toISOString(),
					},
				});

				return respond({ urls: [`${url.origin}/v8/artifacts/${match[1]!}`] }, 200);
			}

			default:
				return respond({ error: "Method Not Allowed" }, 405);
		}
	},

	// Cloudflare Cron Trigger — runs on schedule defined in wrangler.toml [triggers].
	// Deletes all R2 objects whose uploaded-at metadata exceeds ARTIFACT_TTL_SECONDS.
	async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
		const ttlSeconds = Number(env.ARTIFACT_TTL_SECONDS) || 2_592_000;
		if (ttlSeconds === 0) return; // TTL=0 means retain forever — skip cleanup.

		const dryRun = env.CLEANUP_DRY_RUN === "true";
		ctx.waitUntil(
			runCleanup(env.TURBO_CACHE, ttlSeconds, dryRun).then((report) => {
				console.log(`[turbo-cache] cleanup: ${JSON.stringify(report)}`);
			}),
		);
	},
} satisfies ExportedHandler<Env>;

interface CleanupReport {
	scanned: number;
	deleted: number;
	dryRun: boolean;
	ttlSeconds: number;
}

async function runCleanup(bucket: R2Bucket, ttlSeconds: number, dryRun: boolean): Promise<CleanupReport> {
	let scanned = 0;
	let deleted = 0;
	let cursor: string | undefined;

	do {
		const listed = await bucket.list({ cursor, limit: 1000 });
		cursor = listed.truncated ? listed.cursor : undefined;

		const toDelete = listed.objects.filter((obj) => isStale(obj, ttlSeconds));
		scanned += listed.objects.length;

		if (!dryRun && toDelete.length > 0) {
			await Promise.all(toDelete.map((obj) => bucket.delete(obj.key)));
		}
		deleted += toDelete.length;
	} while (cursor);

	return { scanned, deleted, dryRun, ttlSeconds };
}

function isAuthorized(request: Request, token: string): boolean {
	return request.headers.get("Authorization") === `Bearer ${token}`;
}

function isStale(obj: R2Object, ttlSeconds: number): boolean {
	if (ttlSeconds === 0) return false;
	const uploadedAt = obj.customMetadata?.["uploaded-at"];
	if (!uploadedAt) return false;
	const age = (Date.now() - new Date(uploadedAt).getTime()) / 1000;
	return age > ttlSeconds;
}

function formatBytes(bytes: number): string {
	return bytes >= 1_048_576
		? `${Math.round(bytes / 1_048_576)} MB`
		: `${Math.round(bytes / 1024)} KB`;
}

function respond(body: unknown, status: number): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { ...CORS, "Content-Type": "application/json" },
	});
}
