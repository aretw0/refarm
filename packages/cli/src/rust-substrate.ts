import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { applicationCommand } from "./command-handoff.js";

export interface RustSubstrateRecommendation {
	diagnostic: string;
	severity: "failure" | "warning" | "info";
	summary: string;
	action: string;
	command?: string;
	target?: string;
}

export interface RustSubstrateCheck {
	command: "rust-substrate";
	operation: "check";
	ok: boolean;
	required: boolean;
	platform: NodeJS.Platform;
	rustcHost: string | null;
	missing: string[];
	linker: string | null;
	compiler: string | null;
	recommendations: RustSubstrateRecommendation[];
}

const RUST_SUBSTRATE_BUILD_TOOLS_COMMAND = "Install Visual Studio Build Tools with the C++ build tools workload.";
const RUST_SUBSTRATE_DEVELOPER_SHELL_COMMAND = "Open a Developer PowerShell for VS, set CARGO_TARGET_X86_64_PC_WINDOWS_MSVC_LINKER, or put the MSVC linker before Git usr/bin in PATH.";
const RUST_SUBSTRATE_CARGO_COMPONENT_COMMAND = "cargo install cargo-component --locked";
const RUST_SUBSTRATE_WASI_TARGET_COMMAND = "rustup target add wasm32-wasip1";
const RUST_SUBSTRATE_RETRY_CHECK_COMMAND = applicationCommand("refarm", [
	"check",
	"--next-action",
	"--json",
]);

async function exists(filePath: string): Promise<boolean> {
	try {
		await fs.access(filePath);
		return true;
	} catch {
		return false;
	}
}

async function rustSubstrateRequired(root: string): Promise<boolean> {
	return (await exists(path.join(root, "Cargo.toml"))) ||
		(await exists(path.join(root, "rust-toolchain.toml"))) ||
		(await exists(path.join(root, ".cargo", "config.toml")));
}

function runProbe(command: string, args: string[] = []): {
	ok: boolean;
	stdout: string;
	stderr: string;
} {
	try {
		return {
			ok: true,
			stdout: execFileSync(command, args, {
				encoding: "utf8",
				windowsHide: true,
			}).trim(),
			stderr: "",
		};
	} catch (error) {
		const probeError = error as {
			message?: string;
			status?: number;
			stdout?: Buffer | string;
			stderr?: Buffer | string;
		};
		if (probeError.status === 0) {
			return {
				ok: true,
				stdout: probeError.stdout?.toString().trim() ?? "",
				stderr: probeError.stderr?.toString().trim() ?? "",
			};
		}
		return {
			ok: false,
			stdout: probeError.stdout?.toString().trim() ?? "",
			stderr: probeError.stderr?.toString().trim() ?? probeError.message ?? "",
		};
	}
}

function stripAnsi(value: string): string {
	return value.replace(/\u001b\[[0-9;]*m/g, "");
}

function commandSource(command: string): string | null {
	if (process.platform !== "win32") return null;
	const result = runProbe("powershell.exe", [
		"-NoProfile",
		"-Command",
		`(Get-Command ${command} -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty Source)`,
	]);
	return result.ok && result.stdout ? result.stdout : null;
}

export async function runRustSubstrateCheck(
	root = process.cwd(),
): Promise<RustSubstrateCheck> {
	const required = await rustSubstrateRequired(root);
	const platform = os.platform();
	if (!required) {
		return {
			command: "rust-substrate",
			operation: "check",
			ok: true,
			required: false,
			platform,
			rustcHost: null,
			missing: [],
			linker: null,
			compiler: null,
			recommendations: [],
		};
	}

	const rustc = runProbe("rustc", ["-vV"]);
	const cargoList = runProbe("cargo", ["--list"]);
	const rustupTargets = runProbe("rustup", ["target", "list", "--installed"]);
	const rustcHost = rustc.stdout.match(/^host:\s*(.+)$/m)?.[1] ?? null;
	const installedTargets = rustupTargets.stdout.split(/\r?\n/).filter(Boolean);
	const cargoCommands = stripAnsi(cargoList.stdout).split(/\r?\n/).map((line) => line.trim());
	const missing: string[] = [];

	if (!rustc.ok) missing.push("rustc");
	if (!cargoList.ok) missing.push("cargo");
	if (!rustupTargets.ok) missing.push("rustup_targets");
	if (!installedTargets.includes("wasm32-wasip1")) missing.push("target_wasm32_wasip1");
	if (!cargoCommands.some((line) => line === "component" || line.startsWith("component "))) {
		missing.push("cargo_component");
	}

	const compiler = platform === "win32" ? commandSource("cl.exe") : null;
	const linker = platform === "win32" ? commandSource("link.exe") : null;
	const explicitMsvcLinker =
		platform === "win32" ? process.env.CARGO_TARGET_X86_64_PC_WINDOWS_MSVC_LINKER ?? null : null;
	const explicitMsvcLinkerOk =
		typeof explicitMsvcLinker === "string" &&
		/\\link\.exe$/i.test(explicitMsvcLinker) &&
		(await exists(explicitMsvcLinker));
	const effectiveLinker = explicitMsvcLinkerOk ? explicitMsvcLinker : linker;
	if (platform === "win32" && rustcHost?.endsWith("-msvc")) {
		if (!compiler) missing.push("msvc_cl");
		if (
			!explicitMsvcLinkerOk &&
			(!linker || /\\Git\\usr\\bin\\link\.exe$/i.test(linker))
		) {
			missing.push("msvc_link");
		}
	}

	const recommendations = buildRustSubstrateRecommendations({
		missing,
		rustcHost,
		linker,
		explicitMsvcLinkerOk,
	});
	return {
		command: "rust-substrate",
		operation: "check",
		ok: missing.length === 0,
		required,
		platform,
		rustcHost,
		missing,
		linker: effectiveLinker,
		compiler,
		recommendations,
	};
}

function buildRustSubstrateRecommendations(input: {
	missing: string[];
	rustcHost: string | null;
	linker: string | null;
	explicitMsvcLinkerOk?: boolean;
}): RustSubstrateRecommendation[] {
	const recommendations: RustSubstrateRecommendation[] = [];
	const missingMsvcPrerequisite =
		input.rustcHost?.endsWith("-msvc") &&
		(input.missing.includes("msvc_cl") || input.missing.includes("msvc_link"));
	if (input.missing.includes("target_wasm32_wasip1")) {
		recommendations.push({
			diagnostic: "rust-substrate:missing-wasi-target",
			severity: "failure",
			summary: "The Rust target wasm32-wasip1 is required for Refarm WASM plugin builds.",
			action: RUST_SUBSTRATE_WASI_TARGET_COMMAND,
			command: RUST_SUBSTRATE_WASI_TARGET_COMMAND,
			target: "wasm32-wasip1",
		});
	}
	if (input.rustcHost?.endsWith("-msvc") && input.missing.includes("msvc_cl")) {
		recommendations.push({
			diagnostic: "rust-substrate:missing-msvc-build-tools",
			severity: "failure",
			summary: "The Windows MSVC Rust toolchain requires Visual Studio C++ build tools.",
			action: RUST_SUBSTRATE_BUILD_TOOLS_COMMAND,
			target: "cl.exe",
		});
	}
	if (
		input.rustcHost?.endsWith("-msvc") &&
		input.missing.includes("msvc_link") &&
		!input.explicitMsvcLinkerOk &&
		input.linker?.includes("\\Git\\usr\\bin\\link.exe")
	) {
		recommendations.push({
			diagnostic: "rust-substrate:wrong-msvc-linker",
			severity: "failure",
			summary: "The Rust MSVC linker resolves to Git's Unix-style link.exe instead of the MSVC linker.",
			action: RUST_SUBSTRATE_DEVELOPER_SHELL_COMMAND,
			target: input.linker,
		});
	}
	if (input.missing.includes("cargo_component")) {
		recommendations.push({
			diagnostic: "rust-substrate:missing-cargo-component",
			severity: "failure",
			summary: "cargo-component is required to build Refarm component-model WASM packages.",
			action: RUST_SUBSTRATE_CARGO_COMPONENT_COMMAND,
			command: missingMsvcPrerequisite ? undefined : RUST_SUBSTRATE_CARGO_COMPONENT_COMMAND,
			target: "cargo component",
		});
	}
	if (input.missing.includes("rustc") || input.missing.includes("cargo") || input.missing.includes("rustup_targets")) {
		recommendations.push({
			diagnostic: "rust-substrate:missing-rust-toolchain",
			severity: "failure",
			summary: "The Rust toolchain is required by this workspace.",
			action: `Install Rust with rustup, then retry \`${RUST_SUBSTRATE_RETRY_CHECK_COMMAND}\`.`,
		});
	}
	return recommendations;
}
