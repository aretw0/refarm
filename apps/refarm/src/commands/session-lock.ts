import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const fallbackSessionLockPath = path.join(
	os.tmpdir(),
	".refarm",
	"session.lock",
);

export const SESSION_LOCK_PATH = path.join(
	os.homedir(),
	".refarm",
	"session.lock",
);

const SESSION_LOCK_PATHS = [SESSION_LOCK_PATH, fallbackSessionLockPath];

function isWritableSessionLockPath(sessionLockPath: string): boolean {
	try {
		fs.mkdirSync(path.dirname(sessionLockPath), { recursive: true });
		fs.accessSync(path.dirname(sessionLockPath), fs.constants.W_OK);
		return true;
	} catch {
		return false;
	}
}

function getWriteCandidatePaths(): string[] {
	return SESSION_LOCK_PATHS.filter(isWritableSessionLockPath);
}

function readWithFallback<T>(
	sessionLockPaths: string[],
	read: (sessionLockPath: string) => T,
): T | undefined {
	for (const sessionLockPath of sessionLockPaths) {
		try {
			const value = read(sessionLockPath);
			return value;
			} catch {
				continue;
			}
	}
	return undefined;
}

function writeWithFallback(write: (sessionLockPath: string) => void): void {
	let writeError: Error | undefined;
	for (const sessionLockPath of getWriteCandidatePaths()) {
		try {
			fs.mkdirSync(path.dirname(sessionLockPath), { recursive: true });
			write(sessionLockPath);
			return;
		} catch (error) {
			writeError = error as Error;
		}
	}
	throw writeError ?? new Error("Unable to write active session lock");
}

function activeSessionLockPathForRead(): string[] {
	const writablePath = getWriteCandidatePaths().at(0);
	if (writablePath) {
		return [writablePath, ...SESSION_LOCK_PATHS.filter((sessionLockPath) => sessionLockPath !== writablePath)];
	}
	return SESSION_LOCK_PATHS;
}

export function readActiveSessionId(): string | null {
	const content = readWithFallback(
		activeSessionLockPathForRead(),
		(sessionLockPath) => fs.readFileSync(sessionLockPath, "utf-8").trim(),
	);
	if (content === undefined) {
		return null;
	}
	return content.length > 0 ? content : null;
}

export interface ActiveSessionPointerWriteResult {
	currentSessionIdBefore: string | null;
	currentSessionIdAfter: string;
	targetSessionId: string;
}

export function writeActiveSessionId(id: string): void {
	if (getWriteCandidatePaths().length === 0) {
		throw new Error("No writable session lock path available");
	}
	writeWithFallback((sessionLockPath) => {
		fs.writeFileSync(sessionLockPath, id, "utf-8");
	});
}

export function writeActiveSessionIdAndVerify(
	targetSessionId: string,
	currentSessionIdBefore = readActiveSessionId(),
): ActiveSessionPointerWriteResult {
	writeActiveSessionId(targetSessionId);
	const currentSessionIdAfter = readActiveSessionId();
	if (currentSessionIdAfter !== targetSessionId) {
		throw new Error(
			`Session switch expected active session "${targetSessionId}", got "${currentSessionIdAfter ?? "none"}".`,
		);
	}
	return {
		currentSessionIdBefore,
		currentSessionIdAfter,
		targetSessionId,
	};
}

export function clearActiveSessionId(): boolean {
	let cleared = false;
	for (const sessionLockPath of SESSION_LOCK_PATHS) {
		try {
			if (fs.existsSync(sessionLockPath)) {
				fs.unlinkSync(sessionLockPath);
				cleared = true;
			}
		} catch {
			continue;
		}
	}
	if (cleared && readActiveSessionId() === null) {
		return true;
	}
	try {
		writeWithFallback((sessionLockPath) => {
			fs.writeFileSync(sessionLockPath, "", "utf-8");
		});
		return readActiveSessionId() === null;
	} catch {
		return false;
	}
}
