/**
 * The Refarm brand, spoken ONCE (ADR-087). This is the only module that names
 * "refarm" as the CLI binary; every generic package stays brand-agnostic and takes
 * the binary via the neutral `applicationCommand`/`applicationProcess`. A
 * white-label app defines its OWN equivalent over the same agnostic primitives —
 * the substrate never hardcodes a product name.
 */
import {
	applicationCommand,
	applicationProcess,
	privilegedApplicationCommand,
	type ApplicationProcessSpec,
	type PrivilegedInvocationSource,
} from "@refarm.dev/cli/command-handoff";

/** The canonical CLI binary name — the ONE literal "refarm" the app owns. Pass it
 *  to any generic package that takes a binary (ADR-087). */
export const REFARM_BINARY = "refarm";

/** The product name spoken to the model in agent prompts (ADR-087) — generic
 *  packages take it injected, never name it themselves. */
export const REFARM_PRODUCT_NAME = "Refarm";

/** A shareable `refarm <args…>` handoff string (the stable, canonical binary name). */
export function refarmCommand(args: string[]): string {
	return applicationCommand(REFARM_BINARY, args);
}

/**
 * A `refarm <args…>` handoff for a step that needs root.
 *
 * `sudo` replaces `PATH` with `secure_path`, which omits `~/.local/bin` — so the bare
 * `refarm` that works in the operator's shell is NOT found once `sudo` is in front of it
 * (`sudo: refarm: command not found`). This names the interpreter and the entrypoint by
 * absolute path instead, both taken from the running process, so nothing is looked up.
 */
export function refarmPrivilegedCommand(
	args: string[],
	source?: PrivilegedInvocationSource,
): string {
	return privilegedApplicationCommand(REFARM_BINARY, args, source ?? {});
}

/** A spawnable `refarm <args…>` process spec (honors the launcher-path override). */
export function refarmProcess(args: string[]): ApplicationProcessSpec {
	return applicationProcess(REFARM_BINARY, args);
}
