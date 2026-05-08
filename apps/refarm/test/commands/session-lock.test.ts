import fs from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	SESSION_LOCK_PATH,
	clearActiveSessionId,
	readActiveSessionId,
	writeActiveSessionId,
	writeActiveSessionIdAndVerify,
} from "../../src/commands/session-lock.js";

describe("active session pointer helpers", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("reads trimmed active session IDs", () => {
		vi.spyOn(fs, "readFileSync").mockReturnValue(
			" urn:refarm:session:v1:abc123 \n",
		);

		expect(readActiveSessionId()).toBe("urn:refarm:session:v1:abc123");
		expect(fs.readFileSync).toHaveBeenCalledWith(SESSION_LOCK_PATH, "utf-8");
	});

	it("treats missing or empty active session locks as absent", () => {
		const readSpy = vi.spyOn(fs, "readFileSync");
		readSpy.mockReturnValueOnce("  \n");
		expect(readActiveSessionId()).toBeNull();

		readSpy.mockImplementationOnce(() => {
			throw new Error("missing");
		});
		expect(readActiveSessionId()).toBeNull();
	});

	it("writes active session IDs through the canonical lock path", () => {
		const mkdirSpy = vi
			.spyOn(fs, "mkdirSync")
			.mockImplementation(() => undefined as string | undefined);
		const writeSpy = vi
			.spyOn(fs, "writeFileSync")
			.mockImplementation(() => undefined);

		writeActiveSessionId("urn:refarm:session:v1:abc123");

		expect(mkdirSpy).toHaveBeenCalledWith(expect.stringContaining(".refarm"), {
			recursive: true,
		});
		expect(writeSpy).toHaveBeenCalledWith(
			SESSION_LOCK_PATH,
			"urn:refarm:session:v1:abc123",
			"utf-8",
		);
	});

	it("writes and verifies active session IDs", () => {
		vi.spyOn(fs, "readFileSync").mockReturnValueOnce(
			"urn:refarm:session:v1:target",
		);
		vi.spyOn(fs, "mkdirSync").mockImplementation(() => undefined as string | undefined);
		vi.spyOn(fs, "writeFileSync").mockImplementation(() => undefined);

		expect(
			writeActiveSessionIdAndVerify(
				"urn:refarm:session:v1:target",
				"urn:refarm:session:v1:before",
			),
		).toEqual({
			currentSessionIdBefore: "urn:refarm:session:v1:before",
			currentSessionIdAfter: "urn:refarm:session:v1:target",
			targetSessionId: "urn:refarm:session:v1:target",
		});
	});

	it("fails closed when active session ID verification reads back a different value", () => {
		vi.spyOn(fs, "readFileSync").mockReturnValueOnce(
			"urn:refarm:session:v1:other",
		);
		vi.spyOn(fs, "mkdirSync").mockImplementation(() => undefined as string | undefined);
		vi.spyOn(fs, "writeFileSync").mockImplementation(() => undefined);

		expect(() =>
			writeActiveSessionIdAndVerify("urn:refarm:session:v1:target", null),
		).toThrow(
			'Session switch expected active session "urn:refarm:session:v1:target", got "urn:refarm:session:v1:other".',
		);
	});

	it("reports whether clearing the active session lock succeeded", () => {
		const unlinkSpy = vi.spyOn(fs, "unlinkSync");
		unlinkSpy.mockImplementationOnce(() => undefined);
		expect(clearActiveSessionId()).toBe(true);
		expect(unlinkSpy).toHaveBeenCalledWith(SESSION_LOCK_PATH);

		unlinkSpy.mockImplementationOnce(() => {
			throw new Error("missing");
		});
		expect(clearActiveSessionId()).toBe(false);
	});
});
