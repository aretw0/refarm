import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	loadChatHistory,
	rememberChatHistoryLine,
	resolveChatHistoryPath,
	saveChatHistory,
} from "../../src/commands/chat.js";

let rootDir: string;

describe("chat history persistence", () => {
	beforeEach(() => {
		rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "refarm-chat-history-"));
	});

	afterEach(() => {
		fs.rmSync(rootDir, { recursive: true, force: true });
	});

	it("resolves the global refarm chat history path", () => {
		expect(resolveChatHistoryPath(rootDir)).toBe(
			path.join(rootDir, ".refarm", "chat-history"),
		);
	});

	it("loads, saves, and trims empty history lines", () => {
		const historyPath = path.join(rootDir, ".refarm", "chat-history");
		saveChatHistory(["latest prompt", "", "older prompt"], historyPath);

		expect(loadChatHistory(historyPath)).toEqual([
			"latest prompt",
			"older prompt",
		]);
	});

	it("remembers message lines newest-first and ignores slash commands", () => {
		let history = ["old prompt"];
		history = rememberChatHistoryLine(history, "/reload");
		history = rememberChatHistoryLine(history, "new prompt");
		history = rememberChatHistoryLine(history, "old prompt");

		expect(history).toEqual(["old prompt", "new prompt"]);
	});

	it("keeps at most 500 history entries", () => {
		let history: string[] = [];
		for (let index = 0; index < 505; index++) {
			history = rememberChatHistoryLine(history, `prompt ${index}`);
		}

		expect(history).toHaveLength(500);
		expect(history[0]).toBe("prompt 504");
		expect(history.at(-1)).toBe("prompt 5");
	});
});
