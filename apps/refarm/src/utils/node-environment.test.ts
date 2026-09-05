import { describe, expect, it } from "vitest";
import { parseProcEnviron, resolveNodeEnvironment } from "./node-environment.js";

describe("parseProcEnviron", () => {
	it("parses the NUL-separated shape /proc actually produces", () => {
		expect(parseProcEnviron("REFARM_HOME=/home/op/.refarm\0SOVEREIGN_DIR=.refarm\0")).toEqual({
			REFARM_HOME: "/home/op/.refarm",
			SOVEREIGN_DIR: ".refarm",
		});
	});

	it("keeps a value containing '=' whole", () => {
		expect(parseProcEnviron("K=a=b\0")).toEqual({ K: "a=b" });
	});

	it("ignores an entry with no '=' rather than inventing an empty value", () => {
		expect(parseProcEnviron("BROKEN\0K=v\0")).toEqual({ K: "v" });
	});

	it("returns an empty object for empty input", () => {
		expect(parseProcEnviron("")).toEqual({});
	});
});

describe("resolveNodeEnvironment", () => {
	const deps = {
		readEnviron: () => "REFARM_HOME=/home/op/.refarm\0SOVEREIGN_DIR=.refarm\0",
		readCwd: () => "/home/op/github/refarm",
	};

	it("reports what the node declares", () => {
		const env = resolveNodeEnvironment(42, deps);
		expect(env?.home).toBe("/home/op/.refarm");
		expect(env?.sovereignDir).toBe(".refarm");
		expect(env?.cwd).toBe("/home/op/github/refarm");
	});

	it("an undeclared variable is null — the node fell back, which is a finding", () => {
		const env = resolveNodeEnvironment(42, deps);
		expect(env?.base).toBeNull();
		expect(env?.namespace).toBeNull();
	});

	it("returns null when the process cannot be read at all — different from a null field", () => {
		expect(resolveNodeEnvironment(42, { ...deps, readEnviron: () => null })).toBeNull();
	});

	it("an unreadable cwd leaves cwd null without discarding the environ", () => {
		const env = resolveNodeEnvironment(42, { ...deps, readCwd: () => null });
		expect(env).not.toBeNull();
		expect(env?.cwd).toBeNull();
		expect(env?.home).toBe("/home/op/.refarm");
	});
});
