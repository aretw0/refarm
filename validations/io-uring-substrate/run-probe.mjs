#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const VALID_STATUSES = new Set(["available", "blocked", "unsupported"]);

export function parseArgs(argv = []) {
	const options = {
		json: false,
		out: null,
		keepTemp: false,
	};

	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === "--json") {
			options.json = true;
			continue;
		}
		if (arg === "--out") {
			options.out = requireValue(argv, index, arg);
			index += 1;
			continue;
		}
		if (arg === "--keep-temp") {
			options.keepTemp = true;
			continue;
		}
		throw new Error(`Unknown io-uring probe argument: ${arg}`);
	}

	return options;
}

function requireValue(argv, index, flag) {
	const value = argv[index + 1];
	if (!value || value.startsWith("--")) {
		throw new Error(`${flag} requires a value`);
	}
	return value;
}

function repoRoot() {
	return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
}

function unsupportedPayload(reason, details = {}) {
	return {
		ok: true,
		schema: "refarm.io_uring_probe.v1",
		status: "unsupported",
		errno: null,
		reason,
		syscall: "io_uring_setup",
		kernelRelease: readKernelRelease(),
		arch: process.arch,
		container: isContainer(),
		fallback: "standard-file-io",
		publicApi: "async-io:native-linux",
		...details,
	};
}

function readKernelRelease() {
	try {
		return readFileSync("/proc/sys/kernel/osrelease", "utf8").trim();
	} catch {
		return "unknown";
	}
}

function isContainer() {
	try {
		readFileSync("/.dockerenv");
		return true;
	} catch {
		return false;
	}
}

function ensureProbePayload(payload) {
	if (!payload || typeof payload !== "object") {
		throw new Error("io-uring probe did not return a JSON object");
	}
	if (payload.ok !== true) {
		throw new Error("io-uring probe payload must set ok: true");
	}
	if (!VALID_STATUSES.has(payload.status)) {
		throw new Error(`io-uring probe returned invalid status: ${payload.status}`);
	}
	return payload;
}

export function runProbe({ keepTemp = false } = {}) {
	const root = repoRoot();
	const source = path.join(root, "validations/io-uring-substrate/probe.rs");
	const tmp = mkdtempSync(path.join(os.tmpdir(), "refarm-io-uring-probe-"));
	const bin = path.join(tmp, process.platform === "win32" ? "probe.exe" : "probe");

	try {
		const compile = spawnSync("rustc", [source, "-O", "-o", bin], {
			cwd: root,
			encoding: "utf8",
		});

		if (compile.error?.code === "ENOENT") {
			return unsupportedPayload("rustc is not available; cannot run native io_uring probe");
		}
		if (compile.status !== 0) {
			return unsupportedPayload("rustc failed to compile native io_uring probe", {
				compileStatus: compile.status,
				compileStderr: compile.stderr.trim(),
			});
		}

		const result = spawnSync(bin, [], {
			cwd: root,
			encoding: "utf8",
		});
		if (result.status !== 0) {
			return unsupportedPayload("native io_uring probe failed to execute", {
				probeStatus: result.status,
				probeStderr: result.stderr.trim(),
			});
		}

		return ensureProbePayload(JSON.parse(result.stdout));
	} finally {
		if (!keepTemp) {
			rmSync(tmp, { recursive: true, force: true });
		}
	}
}

function writeOutput(outPath, payload) {
	mkdirSync(path.dirname(outPath), { recursive: true });
	writeFileSync(outPath, `${JSON.stringify(payload, null, 2)}\n`);
}

function isMain() {
	return process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
}

if (isMain()) {
	try {
		const options = parseArgs(process.argv.slice(2));
		const payload = runProbe({ keepTemp: options.keepTemp });
		const output = `${JSON.stringify(payload, null, 2)}\n`;

		if (options.out) {
			writeOutput(path.resolve(options.out), payload);
		}

		if (options.json || !options.out) {
			process.stdout.write(output);
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		console.error(`[io-uring-probe] ${message}`);
		process.exit(1);
	}
}
