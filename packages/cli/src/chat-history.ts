import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const MAX_CHAT_HISTORY_LINES = 500;

export function resolveChatHistoryPath(homeDir = os.homedir()): string {
	return path.join(homeDir, ".refarm", "chat-history");
}

export function loadChatHistory(historyPath = resolveChatHistoryPath()): string[] {
	if (!fs.existsSync(historyPath)) return [];
	return fs
		.readFileSync(historyPath, "utf-8")
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean)
		.slice(0, MAX_CHAT_HISTORY_LINES);
}

export function rememberChatHistoryLine(
	history: string[],
	line: string,
): string[] {
	const trimmed = line.trim();
	if (!trimmed || trimmed.startsWith("/")) return history;

	if (history.length === 0) return [trimmed];
	if (history[0] === trimmed) return history;

	const existingIndex = history.indexOf(trimmed);
	if (existingIndex === -1) {
		return [trimmed, ...history].slice(0, MAX_CHAT_HISTORY_LINES);
	}

	const next = history.slice();
	next.splice(existingIndex, 1);
	next.unshift(trimmed);
	return next.slice(0, MAX_CHAT_HISTORY_LINES);
}

export function saveChatHistory(
	history: readonly string[],
	historyPath = resolveChatHistoryPath(),
): void {
	fs.mkdirSync(path.dirname(historyPath), { recursive: true });
	fs.writeFileSync(
		historyPath,
		`${history.slice(0, MAX_CHAT_HISTORY_LINES).join("\n")}\n`,
		"utf-8",
	);
}
