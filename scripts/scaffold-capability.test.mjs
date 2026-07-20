import assert from "node:assert/strict";
import { test } from "node:test";

import { parseScaffoldArgs } from "./scaffold-capability.mjs";

test("parses name + typed arg + option into a spec", () => {
	const { dir, spec } = parseScaffoldArgs([
		"search",
		"--dir",
		"examples/x/src",
		"--arg",
		"query:string:required",
		"--option",
		"limit:integer",
	]);
	assert.equal(dir, "examples/x/src");
	assert.equal(spec.name, "search");
	assert.deepEqual(spec.args, [{ name: "query", type: "string", required: true }]);
	assert.deepEqual(spec.options, [{ name: "limit", kind: "integer", summary: "The limit option" }]);
});

test("parses an enum option", () => {
	const { spec } = parseScaffoldArgs(["sort", "--option", "order:string:enum=asc,desc"]);
	assert.deepEqual(spec.options, [
		{ name: "order", kind: "string", summary: "The order option", enum: ["asc", "desc"] },
	]);
});

test("defaults dir to cwd and omits empty arg/option arrays", () => {
	const { dir, spec } = parseScaffoldArgs(["ping"]);
	assert.equal(dir, ".");
	assert.deepEqual(spec, { name: "ping" });
});

test("rejects an unknown arg type", () => {
	assert.throws(() => parseScaffoldArgs(["x", "--arg", "n:blob"]), /unknown token "blob"/);
});

test("rejects an unknown option kind", () => {
	assert.throws(() => parseScaffoldArgs(["x", "--option", "n:blob"]), /unknown kind "blob"/);
});

test("requires a name", () => {
	assert.throws(() => parseScaffoldArgs(["--dir", "x"]), /usage: scaffold:capability/);
});

test("rejects an unknown flag", () => {
	assert.throws(() => parseScaffoldArgs(["x", "--nope"]), /unknown flag "--nope"/);
});
