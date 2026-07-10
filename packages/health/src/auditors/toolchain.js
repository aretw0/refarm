import fs from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { spawnSync as defaultSpawnSync } from "node:child_process";

const DEFAULT_COMMAND_ARGS = ["--version"];
const DEFAULT_DEVCONTAINER_MOUNT_CHECK = {
	id: "devcontainer_node_modules_mount",
	label: "devcontainer node_modules volume mount",
	nodeModulesPath: "node_modules",
	devcontainerPath: ".devcontainer/devcontainer.json",
	required: true,
};

/**
 * ToolchainAuditor: generic tool/path substrate checks for local workspaces.
 * Consumers own the concrete check list and recovery wording.
 */
export class ToolchainAuditor {
	#title;
	#commandChecks;
	#anyCommandChecks;
	#pathChecks;
	#devcontainerNodeModulesMount;
	#spawnSync;
	#platform;
	#mountInfoReader;

	constructor(options = {}) {
		this.#title = options.title || "Toolchain Environment Health";
		this.#commandChecks = options.commandChecks || [];
		this.#anyCommandChecks = options.anyCommandChecks || [];
		this.#pathChecks = options.pathChecks || [];
		this.#devcontainerNodeModulesMount = normalizeDevcontainerMountCheck(
			options.devcontainerNodeModulesMount,
		);
		this.#spawnSync = options.spawnSync || defaultSpawnSync;
		this.#platform = options.platform || process.platform;
		this.#mountInfoReader = options.mountInfoReader || defaultMountInfoReader;
	}

	get id() {
		return "toolchain";
	}
	get title() {
		return this.#title;
	}

	async audit(context = {}) {
		const rootDir = context.rootDir || process.cwd();
		const checks = [];

		for (const check of this.#pathChecks) {
			checks.push(await this.#runPathCheck(rootDir, check));
		}

		const mountCheck = await this.#runDevcontainerNodeModulesMountCheck(rootDir, context);
		if (mountCheck) checks.push(mountCheck);

		for (const check of this.#commandChecks) {
			checks.push(this.#runCommandCheck(rootDir, check));
		}

		for (const check of this.#anyCommandChecks) {
			checks.push(this.#runAnyCommandCheck(rootDir, check));
		}

		const missing = checks.filter((check) => check.required !== false && !check.ok);
		return {
			ok: missing.length === 0,
			checks,
			missing: missing.map((check) => check.id),
			mountIssues: missing
				.filter((check) => check.id === this.#devcontainerNodeModulesMount?.id)
				.map((check) => ({
					id: check.id,
					path: check.path,
					target: check.target,
				})),
		};
	}

	async #runPathCheck(rootDir, check = {}) {
		const checkPath = path.resolve(rootDir, check.path || ".");
		const required = check.required !== false;
		const mode = check.executable && this.#platform !== "win32" ? constants.X_OK : constants.F_OK;
		return {
			id: check.id,
			label: check.label || check.id,
			ok: await pathExists(checkPath, mode),
			required,
			path: path.relative(rootDir, checkPath) || ".",
		};
	}

	#runCommandCheck(rootDir, check = {}) {
		const command = check.command;
		const args = check.args || DEFAULT_COMMAND_ARGS;
		const result = this.#spawnSync(command, args, {
			cwd: rootDir,
			encoding: "utf8",
			shell: check.shell ?? this.#platform === "win32",
		});
		const ok = result.status === 0;
		return commandCheckResult({
			id: check.id,
			label: check.label || `${command} ${args.join(" ")}`,
			ok,
			required: check.required !== false,
			command: [command, ...args].join(" "),
			stdout: result.stdout,
			stderr: result.stderr || result.stdout,
		});
	}

	#runAnyCommandCheck(rootDir, check = {}) {
		const attempts = [];
		for (const candidate of check.candidates || []) {
			const args = candidate.args || DEFAULT_COMMAND_ARGS;
			const result = this.#spawnSync(candidate.command, args, {
				cwd: rootDir,
				encoding: "utf8",
				shell: candidate.shell ?? this.#platform === "win32",
			});
			const command = [candidate.command, ...args].join(" ");
			attempts.push(command);
			if (result.status === 0) {
				return commandCheckResult({
					id: check.id,
					label: check.label || check.id,
					ok: true,
					required: check.required !== false,
					command,
					stdout: result.stdout,
				});
			}
		}

		return {
			id: check.id,
			label: check.label || check.id,
			ok: false,
			required: check.required !== false,
			command: attempts.join(" | "),
		};
	}

	async #runDevcontainerNodeModulesMountCheck(rootDir, context) {
		if (!this.#devcontainerNodeModulesMount) return null;

		const config = this.#devcontainerNodeModulesMount;
		const target = await readDevcontainerNodeModulesTarget(rootDir, config);
		if (!target) return null;

		const mountPoints = await readLinuxMountPoints({
			platform: this.#platform,
			mountInfoReader: this.#mountInfoReader,
			override: context.mountInfo,
		});
		if (mountPoints.length === 0) return null;

		return {
			id: config.id,
			label: config.label,
			ok: mountPoints.includes(target),
			required: config.required !== false,
			path: config.nodeModulesPath,
			target,
		};
	}
}

function normalizeDevcontainerMountCheck(value) {
	if (!value) return null;
	if (value === true) return DEFAULT_DEVCONTAINER_MOUNT_CHECK;
	return {
		...DEFAULT_DEVCONTAINER_MOUNT_CHECK,
		...value,
	};
}

async function pathExists(filePath, mode = constants.F_OK) {
	try {
		await fs.access(filePath, mode);
		return true;
	} catch {
		return false;
	}
}

function commandCheckResult({ id, label, ok, required, command, stdout = "", stderr = "" }) {
	return {
		id,
		label,
		ok,
		required,
		command,
		version: ok ? stdout.trim().slice(0, 80) : undefined,
		stderr: ok ? undefined : stderr.trim().slice(0, 240),
	};
}

async function readDevcontainerNodeModulesTarget(rootDir, config) {
	let parsed;
	try {
		const content = await fs.readFile(path.resolve(rootDir, config.devcontainerPath), "utf8");
		parsed = JSON.parse(content);
	} catch {
		return null;
	}

	const mounts = Array.isArray(parsed.mounts) ? parsed.mounts : [];
	for (const mount of mounts) {
		if (typeof mount !== "string") continue;
		const fields = parseMountFields(mount);
		if (!fields.target || !fields.source?.includes("node-modules")) continue;
		const target = path.resolve(fields.target);
		if (target === path.resolve(rootDir, config.nodeModulesPath)) return target;
	}
	return null;
}

function parseMountFields(mount) {
	return Object.fromEntries(
		mount.split(",").map((field) => {
			const index = field.indexOf("=");
			if (index === -1) return [field.trim(), ""];
			return [field.slice(0, index).trim(), field.slice(index + 1).trim()];
		}),
	);
}

async function readLinuxMountPoints({ platform, mountInfoReader, override }) {
	if (platform !== "linux") return [];
	let content;
	try {
		content = override ?? (await mountInfoReader());
	} catch {
		return [];
	}
	return content
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean)
		.map((line) => line.split(" - ")[0]?.split(" ")[4])
		.filter(Boolean)
		.map(decodeMountInfoPath)
		.map((mountPoint) => path.resolve(mountPoint));
}

function decodeMountInfoPath(value) {
	return value.replace(/\\([0-7]{3})/g, (_, octal) =>
		String.fromCharCode(Number.parseInt(octal, 8)),
	);
}

async function defaultMountInfoReader() {
	return fs.readFile("/proc/self/mountinfo", "utf8");
}
