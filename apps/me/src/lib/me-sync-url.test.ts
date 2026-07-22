import { describe, expect, it } from "vitest";
import {
	deriveRefarmMeSyncWsUrl,
	resolveRefarmMeSyncWsUrlFromEnv,
} from "./me-sync-url";

describe("resolveRefarmMeSyncWsUrlFromEnv", () => {
	it("accepts an explicit ws:// URL", () => {
		expect(
			resolveRefarmMeSyncWsUrlFromEnv({ REFARM_ME_SYNC_WS_URL: "ws://192.168.0.10:42000" }),
		).toBe("ws://192.168.0.10:42000");
	});

	it("accepts wss:// for a TLS-terminated daemon", () => {
		expect(
			resolveRefarmMeSyncWsUrlFromEnv({ REFARM_ME_SYNC_WS_URL: "wss://farm.example:42000" }),
		).toBe("wss://farm.example:42000");
	});

	it("rejects non-websocket schemes — the value lands in an inline script", () => {
		expect(
			resolveRefarmMeSyncWsUrlFromEnv({ REFARM_ME_SYNC_WS_URL: "http://192.168.0.10:42000" }),
		).toBeUndefined();
		expect(
			resolveRefarmMeSyncWsUrlFromEnv({
				REFARM_ME_SYNC_WS_URL: "javascript:alert(1)",
			}),
		).toBeUndefined();
	});

	it("rejects malformed values and returns undefined when unset", () => {
		expect(resolveRefarmMeSyncWsUrlFromEnv({ REFARM_ME_SYNC_WS_URL: "not a url" })).toBeUndefined();
		expect(resolveRefarmMeSyncWsUrlFromEnv({})).toBeUndefined();
		expect(resolveRefarmMeSyncWsUrlFromEnv({ REFARM_ME_SYNC_WS_URL: "   " })).toBeUndefined();
	});
});

describe("deriveRefarmMeSyncWsUrl", () => {
	it("derives the daemon URL from the page host — LAN devices reach the serving host", () => {
		expect(
			deriveRefarmMeSyncWsUrl({ hostname: "192.168.0.10", protocol: "http:" }),
		).toBe("ws://192.168.0.10:42000");
	});

	it("stays identical to the historical default on localhost", () => {
		expect(deriveRefarmMeSyncWsUrl({ hostname: "localhost", protocol: "http:" })).toBe(
			"ws://localhost:42000",
		);
	});

	it("upgrades to wss when the page itself is https — mixed content is blocked anyway", () => {
		expect(
			deriveRefarmMeSyncWsUrl({ hostname: "farm.example", protocol: "https:" }),
		).toBe("wss://farm.example:42000");
	});

	it("returns undefined without a hostname (non-browser contexts)", () => {
		expect(deriveRefarmMeSyncWsUrl({ hostname: "", protocol: "http:" })).toBeUndefined();
		expect(deriveRefarmMeSyncWsUrl(undefined)).toBeUndefined();
	});
});
