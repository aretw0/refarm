// The terminal surfaces of the capability model.
//
// Each export projects the neutral model (@refarm.dev/capabilities) onto a
// terminal. They live here — not in the model — because each marries a terminal
// technology (Commander for the CLI, a read-loop for the TUI); the model stays a
// clean leaf. See README.

export {
	capabilityCliCommands,
	capabilityCliCommandsForGroup,
	capabilityToCliCommand,
	renderCapabilityError,
	toCommanderCommand,
	toCommanderGroup,
	type CapabilityHooksResolver,
	type CapabilitySurfaceHooks,
} from "./cli-projector.js";
export { runTui, createReadlineTuiIo, type TuiIo, type RunTuiOptions } from "./tui-runtime.js";
