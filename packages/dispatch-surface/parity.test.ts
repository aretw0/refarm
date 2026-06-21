import { dirname, resolve } from "path";
import { execFileSync } from "child_process";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";

/** @type {import('vitest').ExpectStatic} */
const packageDir = dirname(fileURLToPath(import.meta.url));
const runnerPath = resolve(packageDir, "parity-runner.mjs");

function runWithEnv(env) {
	const output = execFileSync(process.execPath, [runnerPath], {
		encoding: "utf8",
		env: {
			...process.env,
			...env,
		},
		cwd: packageDir,
	});
	return JSON.parse(output);
}

describe("dispatch-surface Rust parity harness", () => {
	it("matches typed outputs between skip-native and native-backed modes", () => {
		const skipNative = runWithEnv({ DISPATCH_SURFACE_SKIP_RUST: "1" });
		const maybeNative = runWithEnv({});

		expect(maybeNative.parse).toEqual(skipNative.parse);
		expect(maybeNative.resolveChannelFromTransport).toEqual(
			skipNative.resolveChannelFromTransport,
		);
		expect(maybeNative.isChannelEffortPayload).toEqual(
			skipNative.isChannelEffortPayload,
		);
		expect(maybeNative.normalizedSource).toEqual(skipNative.normalizedSource);
		expect(maybeNative.normalizedContext).toEqual(skipNative.normalizedContext);
		expect(maybeNative.roundTripChannel).toEqual(skipNative.roundTripChannel);
		expect(maybeNative.buildPaths).toEqual(skipNative.buildPaths);
		expect(maybeNative.effort).toEqual(skipNative.effort);
	});

	it("reports stable parser error messages", () => {
		const skipNative = runWithEnv({ DISPATCH_SURFACE_SKIP_RUST: "1" });
		expect(skipNative.parse.invalid.ok).toBe(false);
		expect(skipNative.parse.invalid.error).toContain(
			`Invalid task transport "grpc". Use: file, http, channel:<name>`,
		);
	});
});
