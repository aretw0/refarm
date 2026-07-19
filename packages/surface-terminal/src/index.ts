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
export {
	computeTuiLayout,
	defaultMeasureText,
	type LayoutNode,
	type PositionedNode,
	type MeasureText,
	type ComputeTuiLayoutOptions,
} from "./tui-layout.js";
export { renderTuiLayout, type RenderTuiLayoutOptions } from "./tui-render.js";
export {
	surfaceModelToLayout,
	renderCapabilityDashboard,
	runInteractiveDashboard,
	defaultDashboardColors,
	dashboardColorsFromTuiTheme,
	type TuiThemeColor,
	type TuiThemeLike,
	type SurfaceDashboardColors,
	type SurfaceDashboardOptions,
	type RenderCapabilityDashboardOptions,
	type RunInteractiveDashboardOptions,
} from "./tui-dashboard.js";
export {
	statusPanelToLayout,
	renderStatusPanel,
	defaultStatusColors,
	type StatusPanelUnit,
	type StatusPanelModel,
	type StatusPanelColors,
	type RenderStatusPanelOptions,
} from "./tui-status.js";
export { scriptedInput, type Key, type TerminalInput } from "./tui-input.js";
export { focusOrder, moveFocus, type FocusTarget } from "./tui-focus.js";
export {
	runInteractiveLayout,
	runInteractiveTerminal,
	createStdinInput,
	type RunInteractiveLayoutOptions,
	type RunInteractiveTerminalOptions,
} from "./tui-interactive.js";
