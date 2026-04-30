import { describe, expect, it } from "vitest";
import {
	createStudioRuntimeIdentity,
	resolveStudioRuntimeDatabaseName,
	STUDIO_DEFAULT_ENV_METADATA,
} from "../src/sdk/runtime";

describe("studio runtime helpers", () => {
	it("uses the persistent database for citizen mode", () => {
		expect(
			resolveStudioRuntimeDatabaseName({
				mode: "citizen",
				persistentName: "refarm-main",
				temporaryPrefix: "refarm-temp",
				now: () => 123,
			}),
		).toBe("refarm-main");
	});

	it("creates timestamped temporary databases for visitor-style runtimes", () => {
		expect(
			resolveStudioRuntimeDatabaseName({
				mode: "visitor",
				persistentName: "refarm-main",
				temporaryPrefix: "refarm-temp",
				now: () => 456,
			}),
		).toBe("refarm-temp-456");
		expect(
			resolveStudioRuntimeDatabaseName({
				temporaryPrefix: "refarm-surfaces",
				now: () => 789,
			}),
		).toBe("refarm-surfaces-789");
	});

	it("creates deterministic local identities", async () => {
		const identity = createStudioRuntimeIdentity("studio", "root");

		expect(identity.id).toBe("studio");
		expect(await identity.getPublicKey()).toBe("root");
		expect(await identity.sign("payload")).toBe("payload");
	});

	it("exposes shared Studio environment metadata", () => {
		expect(STUDIO_DEFAULT_ENV_METADATA).toEqual({
			version: "0.1.0-solo-fertil",
			commit: "dev",
		});
	});
});
