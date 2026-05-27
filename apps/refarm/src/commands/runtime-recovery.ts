import { refarmCommand } from "./command-handoff.js";

export const RUNTIME_STATUS_COMMAND = refarmCommand(["runtime", "status"]);
export const RUNTIME_START_COMMAND = refarmCommand(["runtime", "start"]);
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
export const RUNTIME_ENSURE_WAIT_NEXT_COMMAND =
	refarmCommand(["runtime", "ensure", "--wait", "--next-command"]);
export const RUNTIME_DOCTOR_COMMAND = refarmCommand(["doctor"]);
export const RUNTIME_DOCTOR_NEXT_ACTION_COMMAND = refarmCommand([
	"doctor",
	"--next-action",
]);
export const RUNTIME_DOCTOR_NEXT_COMMAND = refarmCommand(["doctor", "--next-command"]);
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

export const RUNTIME_NOT_READY_LAUNCH_HINT =
	` Run \`${RUNTIME_STATUS_COMMAND}\`, then \`${RUNTIME_ENSURE_WAIT_NEXT_COMMAND}\`.`;
