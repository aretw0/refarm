// The Commander CLI projector moved into @refarm.dev/cli (capabilities/cli-projector)
// so an external white-label app can build its OWN CLI from refarm's builtins +
// its own verbs — the two-layer model. This file stays as a thin re-export so the
// app's existing import sites are unchanged.
export {
	capabilityCliCommands,
	capabilityCliCommandsForGroup,
	capabilityToCliCommand,
	renderCapabilityError,
	toCommanderCommand,
	toCommanderGroup,
	type CapabilityHooksResolver,
	type CapabilitySurfaceHooks,
} from "@refarm.dev/cli/capabilities";
