import { describe, expect, it } from "vitest";
import {
	SESSION_ID_URN_PREFIX,
	findSessionIdPrefixMatches,
	formatSessionId,
	isFullSessionId,
	resolveSessionIdPrefix,
} from "../../src/commands/session-ids.js";

const sessions = [
	{ "@id": `${SESSION_ID_URN_PREFIX}aaaabbbbcccc1111` },
	{ "@id": `${SESSION_ID_URN_PREFIX}aaaabbbbcccc2222` },
	{ "@id": `${SESSION_ID_URN_PREFIX}ddddbbbbcccc3333` },
];

describe("session ID helpers", () => {
	it("formats session IDs as stable short suffixes", () => {
		expect(formatSessionId(`${SESSION_ID_URN_PREFIX}0123456789abcdef`)).toBe(
			"456789abcdef",
		);
	});

	it("detects full Refarm session IDs", () => {
		expect(isFullSessionId(`${SESSION_ID_URN_PREFIX}0123`)).toBe(true);
		expect(isFullSessionId("0123")).toBe(false);
	});

	it("prefers exact ID matches over broad prefix matches", () => {
		const exact = `${SESSION_ID_URN_PREFIX}aaaabbbbcccc1111`;
		expect(findSessionIdPrefixMatches(exact, sessions)).toEqual([
			{ "@id": exact },
		]);
		expect(resolveSessionIdPrefix(exact, sessions)).toBe(exact);
	});

	it("resolves unique suffix or substring prefixes", () => {
		expect(resolveSessionIdPrefix("3333", sessions)).toBe(
			`${SESSION_ID_URN_PREFIX}ddddbbbbcccc3333`,
		);
		expect(resolveSessionIdPrefix("cccc2222", sessions)).toBe(
			`${SESSION_ID_URN_PREFIX}aaaabbbbcccc2222`,
		);
	});

	it("throws stable errors for missing and ambiguous prefixes", () => {
		expect(() => resolveSessionIdPrefix("missing", sessions)).toThrow(
			'No session matching "missing"',
		);
		expect(() => resolveSessionIdPrefix("aaaabbbb", sessions)).toThrow(
			'Ambiguous session prefix "aaaabbbb" (2 matches)',
		);
	});
});
