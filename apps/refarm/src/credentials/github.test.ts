import { ambientActivitySink, type ProcessActivity } from "@refarm.dev/capabilities";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { renderActivityOnCli } from "../utils/activity-cli.js";
import type { CollectContext } from "./types.js";

vi.mock("@refarm.dev/config", () => ({
	loadConfig: vi.fn().mockReturnValue({}),
}));

import { githubCredentialProvider } from "./github.js";

function jsonResponse(data: unknown, ok = true): Response {
	return { ok, json: async () => data } as Response;
}

function deviceCodePayload(overrides: Partial<Record<string, unknown>> = {}) {
	return {
		device_code: "dev-123",
		user_code: "ABCD-EFGH",
		verification_uri: "https://github.com/login/device",
		expires_in: 900,
		// A zero interval collapses `pollForToken`'s `setTimeout` delay to 0ms, so the
		// device-flow poll loop resolves promptly in tests without fake timers.
		interval: 0,
		...overrides,
	};
}

function makeCtx(): CollectContext {
	return { tryOpenUrl: vi.fn() };
}

/** A fake non-TTY write stream that records everything written — mirrors the pattern
 * in activity-cli.test.ts so the CLI renderer degrades to printed lines. */
function fakeStream(): NodeJS.WriteStream & { written: string[] } {
	const written: string[] = [];
	const stream = {
		isTTY: false,
		write(chunk: string) {
			written.push(chunk);
			return true;
		},
		written,
	};
	return stream as unknown as NodeJS.WriteStream & { written: string[] };
}

describe("githubCredentialProvider", () => {
	let fetchMock: ReturnType<typeof vi.fn>;
	let activity: { events: ProcessActivity[]; stop: () => void };

	beforeEach(() => {
		fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);
		const events: ProcessActivity[] = [];
		const unsubscribe = ambientActivitySink.subscribe((e) => events.push(e));
		activity = { events, stop: unsubscribe };
	});

	afterEach(() => {
		activity.stop();
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it("emits activity started → finished{ok:true} around the device-code poll, and returns the token", async () => {
		fetchMock
			.mockImplementationOnce(async () => jsonResponse(deviceCodePayload()))
			.mockImplementationOnce(async () => jsonResponse({ access_token: "gho_test123" }))
			.mockImplementationOnce(async () => jsonResponse({ login: "octocat" }));

		const token = await githubCredentialProvider.collect(makeCtx());

		expect(token).toBe("gho_test123");
		expect(activity.events.map((e) => e.phase)).toEqual(["started", "finished"]);
		expect(activity.events[0]).toMatchObject({
			kind: "auth",
			label: "Waiting for GitHub authorization",
		});
		expect(activity.events[1]).toMatchObject({ phase: "finished", ok: true });
		// Every event of one login correlates to the same unit of work.
		expect(activity.events[0]!.activityRef).toBe(activity.events[1]!.activityRef);
	});

	it("emits finished{ok:false} and rethrows when the operator declines authorization (cancellation)", async () => {
		fetchMock
			.mockImplementationOnce(async () => jsonResponse(deviceCodePayload()))
			.mockImplementationOnce(async () => jsonResponse({ error: "access_denied" }));

		await expect(githubCredentialProvider.collect(makeCtx())).rejects.toThrow(
			"Authorization declined.",
		);

		// The activity must still FINISH on a declined/cancelled authorization — an
		// activity that never finishes leaves every subscriber (CLI spinner, TUI line,
		// a future mesh pill) spinning forever.
		expect(activity.events.map((e) => e.phase)).toEqual(["started", "finished"]);
		expect(activity.events[1]).toMatchObject({ phase: "finished", ok: false });
	});

	it("emits finished{ok:false} and rethrows when the device-code request itself fails", async () => {
		const failure = new Error("network unreachable");
		fetchMock.mockImplementationOnce(async () => {
			throw failure;
		});

		await expect(githubCredentialProvider.collect(makeCtx())).rejects.toThrow(failure);

		// The device-code request happens BEFORE the activity is opened (it has not
		// failed "during" the wait yet), so no activity should have been emitted at all —
		// there is nothing to leave hanging.
		expect(activity.events).toEqual([]);
	});

	it("renders the terminal spinner via the CLI activity subscriber — no regression for the direct-CLI path", async () => {
		fetchMock
			.mockImplementationOnce(async () => jsonResponse(deviceCodePayload()))
			.mockImplementationOnce(async () => jsonResponse({ access_token: "gho_test123" }))
			.mockImplementationOnce(async () => jsonResponse({ login: "octocat" }));

		const stream = fakeStream();
		const handle = renderActivityOnCli({ sink: ambientActivitySink, stream });

		await githubCredentialProvider.collect(makeCtx());

		const out = stream.written.join("");
		expect(out).toContain("Waiting for GitHub authorization");
		handle.stop();
	});
});
