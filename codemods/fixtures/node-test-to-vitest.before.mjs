import assert from "node:assert/strict";
import { after, beforeEach, describe, it, mock } from "node:test";

describe("sample", () => {
	beforeEach(() => {
		mock.fn();
	});

	after(() => {
		assert.ok(true, "cleanup ran");
	});

	it("rewrites common assertions", async () => {
		assert.equal("a", "a");
		assert.notEqual("a", "b");
		assert.deepEqual({ a: 1 }, { a: 1 });
		assert.ok("value", "value should be truthy");
		assert.match("hello", /ell/, "hello should match");
		assert.match(
			"multiline",
			/line/,
			"multiline match should work",
		);
		assert.doesNotMatch("hello", /xyz/);
		await assert.rejects(async () => {
			throw new Error("boom");
		}, /boom/);
		await assert.doesNotReject(async () => {
			return "ok";
		}, "does not reject");
		assert.fail("explicit failure");
	});
});
