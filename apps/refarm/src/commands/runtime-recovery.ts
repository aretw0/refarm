export const RUNTIME_STATUS_COMMAND = "refarm runtime status";
export const RUNTIME_START_COMMAND = "refarm runtime start";
export const RUNTIME_START_WAIT_COMMAND = "refarm runtime start --wait";
export const RUNTIME_DOCTOR_COMMAND = "refarm doctor";
export const RUNTIME_AUTOSTART_ALWAYS_COMMAND =
	"refarm config set runtime.autostart always";
export const RUNTIME_AUTOSTART_NEVER_COMMAND =
	"refarm config set runtime.autostart never";
export const RUNTIME_ENGINE_AUTO_COMMAND = "refarm config set tractor.engine auto";

export const RUNTIME_NOT_READY_RECOVERY_ACTION =
	`Run \`${RUNTIME_STATUS_COMMAND}\`, then \`${RUNTIME_START_WAIT_COMMAND}\`; use \`${RUNTIME_AUTOSTART_ALWAYS_COMMAND}\` if this should be automatic.`;

export const RUNTIME_NOT_READY_LAUNCH_HINT =
	` Run \`${RUNTIME_STATUS_COMMAND}\`, then \`${RUNTIME_START_WAIT_COMMAND}\`.`;
