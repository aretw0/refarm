import type { LaunchRecoveryHints } from "@refarm.dev/cli/launch-policy";
import { refarmCommand } from "../brand.js";

// These runtime handoff constants moved out of @refarm.dev/cli/launch-policy
// (ADR-087): the generic package stayed brand-agnostic, so the app owns and
// computes them here with its own `refarmCommand`.
export const RUNTIME_STATUS_COMMAND = refarmCommand(["runtime", "status"]);
export const RUNTIME_ENSURE_WAIT_NEXT_COMMAND = refarmCommand([
	"runtime",
	"ensure",
	"--wait",
	"--next-command",
]);
export const RUNTIME_DOCTOR_NEXT_ACTION_COMMAND = refarmCommand([
	"doctor",
	"--next-action",
]);
export const RUNTIME_DOCTOR_NEXT_COMMAND = refarmCommand([
	"doctor",
	"--next-command",
]);
	export const RUNTIME_START_COMMAND = refarmCommand(["runtime", "start"]);
	export const RUNTIME_START_DRY_RUN_JSON_COMMAND = refarmCommand([
	"runtime",
	"start",
	"--dry-run",
	"--json",
	]);
	export const RUNTIME_START_WAIT_COMMAND = refarmCommand([
	"runtime",
	"start",
	"--wait",
	]);
	export const RUNTIME_ENSURE_WAIT_COMMAND = refarmCommand([
	"runtime",
	"ensure",
	"--wait",
	]);
	export const RUNTIME_DOCTOR_COMMAND = refarmCommand(["doctor"]);
	export const RUNTIME_AUTOSTART_ALWAYS_COMMAND =
	refarmCommand(["config", "set", "runtime.autostart", "always"]);
	export const RUNTIME_AUTOSTART_NEVER_COMMAND =
	refarmCommand(["config", "set", "runtime.autostart", "never"]);
	export const RUNTIME_ENGINE_AUTO_COMMAND = refarmCommand([
	"config",
	"set",
	"tractor.engine",
	"auto",
	]);

	export const RUNTIME_NOT_READY_RECOVERY_ACTION =
	`Run \`${RUNTIME_STATUS_COMMAND}\`, then \`${RUNTIME_ENSURE_WAIT_NEXT_COMMAND}\`; use \`${RUNTIME_AUTOSTART_ALWAYS_COMMAND}\` if this should be automatic.`;

	// Same text the launch-policy package baked in before ADR-087 moved the brand
	// out; now composed in the app from the app-owned commands.
	export const RUNTIME_NOT_READY_LAUNCH_HINT =
	` Run \`${RUNTIME_STATUS_COMMAND}\`, then \`${RUNTIME_ENSURE_WAIT_NEXT_COMMAND}\`.`;

	// The brand-specific recovery hints the app hands to the agnostic launch policy
	// (ADR-087) so resolveLaunchReadiness weaves refarm's commands without the
	// package knowing the binary name.
	export const REFARM_LAUNCH_RECOVERY_HINTS: LaunchRecoveryHints = {
	runtimeNotReadyHint: RUNTIME_NOT_READY_LAUNCH_HINT,
	doctorNextActionCommand: RUNTIME_DOCTOR_NEXT_ACTION_COMMAND,
	runtimeNotReadyCommands: [
	RUNTIME_ENSURE_WAIT_NEXT_COMMAND,
	RUNTIME_DOCTOR_NEXT_COMMAND,
	],
	};
