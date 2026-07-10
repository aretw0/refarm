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
	type ApplicationProcessSpec,
} from "@refarm.dev/cli/command-handoff";

/** The canonical CLI binary name — the ONE literal "refarm" the app owns. Pass it
 *  to any generic package that takes a binary (ADR-087). */
export const REFARM_BINARY = "refarm";

/** A shareable `refarm <args…>` handoff string (the stable, canonical binary name). */
export function refarmCommand(args: string[]): string {
	return applicationCommand(REFARM_BINARY, args);
}

/** A spawnable `refarm <args…>` process spec (honors the launcher-path override). */
export function refarmProcess(args: string[]): ApplicationProcessSpec {
	return applicationProcess(REFARM_BINARY, args);
}
