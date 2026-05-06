import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const SESSION_LOCK_PATH = path.join(
	os.homedir(),
	".refarm",
	"session.lock",
);

export function readActiveSessionId(): string | null {
	try {
		const content = fs.readFileSync(SESSION_LOCK_PATH, "utf-8").trim();
		return content.length > 0 ? content : null;
	} catch {
		return null;
	}
}

export function writeActiveSessionId(id: string): void {
	fs.mkdirSync(path.dirname(SESSION_LOCK_PATH), { recursive: true });
	fs.writeFileSync(SESSION_LOCK_PATH, id, "utf-8");
}

export function clearActiveSessionId(): boolean {
	try {
		fs.unlinkSync(SESSION_LOCK_PATH);
		return true;
	} catch {
		return false;
	}
}
