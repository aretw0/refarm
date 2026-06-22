import { refarmCommand } from "@refarm.dev/cli/command-handoff";
import {
	RUNTIME_STATUS_COMMAND,
	RUNTIME_DOCTOR_NEXT_ACTION_COMMAND,
	RUNTIME_DOCTOR_NEXT_COMMAND,
	RUNTIME_ENSURE_WAIT_NEXT_COMMAND,
	RUNTIME_NOT_READY_LAUNCH_HINT as BASE_RUNTIME_NOT_READY_LAUNCH_HINT,
} from "@refarm.dev/cli/launch-policy";
export {
	RUNTIME_STATUS_COMMAND,
	RUNTIME_DOCTOR_NEXT_ACTION_COMMAND,
	RUNTIME_DOCTOR_NEXT_COMMAND,
	RUNTIME_ENSURE_WAIT_NEXT_COMMAND,
};
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

export const RUNTIME_NOT_READY_LAUNCH_HINT = BASE_RUNTIME_NOT_READY_LAUNCH_HINT;
