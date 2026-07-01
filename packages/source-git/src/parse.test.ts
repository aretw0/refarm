import { describe, expect, it } from "vitest";

import { cachePathFor, parseSourceRef } from "./parse.js";

describe("parseSourceRef", () => {
	it("defaults owner/repo to github.com", () => {
		expect(parseSourceRef("aretw0/agents-lab")).toEqual({
			kind: "git",
			host: "github.com",
			org: "aretw0",
			repo: "agents-lab",
		});
	});

	it("parses host/org/repo", () => {
		expect(parseSourceRef("gitlab.com/acme/widget")).toEqual({
			kind: "git",
			host: "gitlab.com",
			org: "acme",
			repo: "widget",
		});
	});

	it("parses https URLs and strips .git", () => {
		expect(parseSourceRef("https://github.com/mitsuhiko/minijinja")).toEqual({
			kind: "git",
			host: "github.com",
			org: "mitsuhiko",
			repo: "minijinja",
		});
		expect(parseSourceRef("https://github.com/mitsuhiko/minijinja.git")).toEqual({
			kind: "git",
			host: "github.com",
			org: "mitsuhiko",
			repo: "minijinja",
		});
	});

	it("parses scp-like git@ syntax", () => {
		expect(parseSourceRef("git@github.com:mitsuhiko/minijinja.git")).toEqual({
			kind: "git",
			host: "github.com",
			org: "mitsuhiko",
			repo: "minijinja",
		});
	});

	it("treats local: prefix as kind local", () => {
		expect(parseSourceRef("local:/home/me/repo")).toEqual({
			kind: "local",
			repo: "repo",
			sourcePath: "/home/me/repo",
		});
	});

	it("treats a filesystem path ending in .git as a local git remote", () => {
		expect(parseSourceRef("/tmp/sample.git")).toEqual({
			kind: "git",
			host: "local",
			org: "_",
			repo: "sample",
		});
	});

	it("throws INVALID_REF marker on empty input", () => {
		expect(() => parseSourceRef("")).toThrow(/INVALID_REF/);
	});

	it("builds a deterministic git cache path", () => {
		const parsed = parseSourceRef("aretw0/agents-lab");
		expect(cachePathFor(parsed, "/cache")).toBe("/cache/github.com/aretw0/agents-lab");
	});

	it("returns the path itself for local kind", () => {
		const parsed = parseSourceRef("local:/home/me/repo");
		expect(cachePathFor(parsed, "/cache")).toBe("/home/me/repo");
	});
});
