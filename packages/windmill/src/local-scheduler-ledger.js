import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";

export const LOCAL_SCHEDULER_LEDGER_SCHEMA =
	"refarm.local-scheduler-ledger.v1";
export const DEFAULT_LOCAL_SCHEDULER_LEDGER_PATH =
	".refarm/scheduler/ledger.json";

// The ledger lives under .refarm/ (operator-local runtime state). Match the
// silo's restrictive modes for that tree (packages/silo/src/index.js): the
// ledger is not secret, but keeping .refarm/ owner-only is the house rule.
const LEDGER_DIRECTORY_MODE = 0o700;
const LEDGER_FILE_MODE = 0o600;

function assertNonEmptyString(value, name) {
	if (typeof value !== "string" || value.trim().length === 0) {
		throw new TypeError(`${name} must be a non-empty string`);
	}
	return value;
}

function resolveLedgerPath(options = {}) {
	const cwd = options.cwd ?? process.cwd();
	assertNonEmptyString(cwd, "cwd");
	const filePath = options.filePath ?? DEFAULT_LOCAL_SCHEDULER_LEDGER_PATH;
	assertNonEmptyString(filePath, "filePath");
	return isAbsolute(filePath) ? filePath : resolve(cwd, filePath);
}

function emptyLedger() {
	return {
		schema: LOCAL_SCHEDULER_LEDGER_SCHEMA,
		schemaVersion: 1,
		updatedAt: null,
		entries: {},
	};
}

function assertLedgerShape(value, filePath) {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error(`Invalid local scheduler ledger at ${filePath}: expected object`);
	}
	if (value.schema && value.schema !== LOCAL_SCHEDULER_LEDGER_SCHEMA) {
		throw new Error(
			`Invalid local scheduler ledger at ${filePath}: unsupported schema ${value.schema}`,
		);
	}
	if (!value.entries || typeof value.entries !== "object" || Array.isArray(value.entries)) {
		throw new Error(
			`Invalid local scheduler ledger at ${filePath}: expected entries object`,
		);
	}
	return {
		...value,
		schema: LOCAL_SCHEDULER_LEDGER_SCHEMA,
		schemaVersion: 1,
		entries: { ...value.entries },
	};
}

async function readLedgerFile(filePath) {
	try {
		const content = await readFile(filePath, "utf8");
		return assertLedgerShape(JSON.parse(content), filePath);
	} catch (error) {
		if (error && error.code === "ENOENT") return emptyLedger();
		if (error instanceof SyntaxError) {
			throw new Error(`Invalid local scheduler ledger at ${filePath}: ${error.message}`);
		}
		throw error;
	}
}

async function writeLedgerFile(filePath, ledger) {
	// Atomic replace: write a sibling temp file, then rename over the target so a
	// crash mid-write can never leave a half-written (and thus "re-fire the
	// world") ledger. NOTE: recordFired is read-modify-write on the whole file,
	// so concurrent writers race last-write-wins on the file. That is acceptable
	// for the single local daemon that ticks jobs sequentially; a multi-writer
	// setup would need file locking.
	await mkdir(dirname(filePath), { recursive: true, mode: LEDGER_DIRECTORY_MODE });
	const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
	await writeFile(`${tempPath}`, `${JSON.stringify(ledger, null, "\t")}\n`, {
		encoding: "utf8",
		mode: LEDGER_FILE_MODE,
	});
	await rename(tempPath, filePath);
}

export function resolveLocalSchedulerLedgerPath(options = {}) {
	return resolveLedgerPath(options);
}

export async function readLocalSchedulerLedger(options = {}) {
	return readLedgerFile(resolveLedgerPath(options));
}

export function createLocalSchedulerLedger(options = {}) {
	const filePath = resolveLedgerPath(options);
	return {
		filePath,
		async hasFired(key) {
			assertNonEmptyString(key, "key");
			const ledger = await readLedgerFile(filePath);
			return Object.hasOwn(ledger.entries, key);
		},
		async recordFired(key, receipt) {
			assertNonEmptyString(key, "key");
			const now = new Date().toISOString();
			const ledger = await readLedgerFile(filePath);
			ledger.entries[key] = {
				recordedAt: now,
				...receipt,
			};
			ledger.updatedAt = now;
			await writeLedgerFile(filePath, ledger);
		},
		async read() {
			return readLedgerFile(filePath);
		},
	};
}
