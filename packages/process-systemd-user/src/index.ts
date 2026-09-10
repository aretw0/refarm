/**
 * The borrowed supervisor: `systemd --user`.
 *
 * Design: `docs/superpowers/specs/2026-07-30-declared-processes-design.md` (W1–W3).
 *
 * This package is the FIRST supervision backend, and it is deliberately a separate package from the
 * contract for the same reason `certificate-local-ca` is separate from `certificate-contract-v1`:
 * the vocabulary is portable, the act is not. A Termux host has no systemd and will register a
 * different backend (W5's tractor fallback) against the same seam without changing a line here.
 *
 * Nothing in here starts, stops or enables anything. It reads state, renders a unit, and builds the
 * consent request that proposes writing it.
 */

export {
	createSystemdUserBackend,
	SYSTEMD_USER_BACKEND_ID,
	type SystemdUnitPlan,
	type SystemdUserBackendOptions,
} from "./backend.js";
export {
	buildLingerRequest,
	createLingerFileSystem,
	describeUnitLifetime,
	LINGER_DIR,
	LINGER_OPERATION_KIND,
	lingerMarkerPath,
	PROCESS_UNIT_OPERATION_KIND,
	readLingerState,
	refuseBundledLinger,
	type LingerRequestInput,
	type LingerState,
} from "./linger.js";
export {
	createNodeCommandRunner,
	DEFAULT_PROBE_TIMEOUT_MS,
	type CommandResult,
	type CommandRunner,
} from "./runner.js";
export {
	quoteExecArgument,
	refuseRelativeExecutable,
	renderSystemdUnit,
	systemdRestartValue,
	systemdTimerName,
	systemdUnitName,
	systemdUnitPath,
	systemdUserUnitDir,
	UNIT_PREFIX,
	type RenderUnitOptions,
} from "./unit.js";
