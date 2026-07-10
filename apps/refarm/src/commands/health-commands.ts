import type { ApplicationProcessSpec } from "@refarm.dev/cli/command-handoff";
import { refarmCommand, refarmProcess } from "../brand.js";

/**
 * The ONE source of truth for the recovery/handoff commands that reference the
 * `health` verb. Health is a CapabilityGroup: its modes are sub-verbs
 * (`health policy` / `health suggest-policy` / `health apply-policy`), not the
 * legacy `--policy` / `--suggest-policy` / `--apply-suggested-policy` flags. The
 * output modifiers (`--next-action` / `--next-command`) stay options on the
 * default `audit` action, so their command form is unchanged.
 *
 * Everything that recommends a health command — the report recommendations, the
 * agent handoff plan, the finish plan, and the tests that pin those strings —
 * imports from here, so the surface's command grammar lives in exactly one place
 * (change a sub-verb name once, every recommender and its test follow). Built via
 * refarmCommand so the white-label binary prefix is honored.
 */

const HEALTH = "health";

/** `refarm health --help` — the disambiguation pointer. */
export const HEALTH_HELP_COMMAND = refarmCommand([HEALTH, "--help"]);

/** `refarm health suggest-policy --json` — propose a reviewed policy. */
export const HEALTH_SUGGEST_POLICY_COMMAND = refarmCommand([HEALTH, "suggest-policy", "--json"]);

/** `refarm health apply-policy --json` — write the suggested policy. */
export const HEALTH_APPLY_POLICY_COMMAND = refarmCommand([HEALTH, "apply-policy", "--json"]);

/** `refarm health policy --json` — print the resolved policy. */
export const HEALTH_POLICY_JSON_COMMAND = refarmCommand([HEALTH, "policy", "--json"]);

/** `refarm health --next-action --json` — first blocking action (option, not a
 * sub-verb, so the form is unchanged from the pre-group command). */
export const HEALTH_NEXT_ACTION_COMMAND = refarmCommand([HEALTH, "--next-action", "--json"]);

/** The argv (not the joined string) for the audit next-action handoff, for
 * callers that build an ApplicationProcessSpec or a finish-plan step. */
export const HEALTH_NEXT_ACTION_ARGV: readonly string[] = [HEALTH, "--next-action", "--json"];

/** The process spec form of {@link HEALTH_POLICY_JSON_COMMAND}. */
export function healthPolicyProcess(): ApplicationProcessSpec {
	return refarmProcess([HEALTH, "policy", "--json"]);
}

/** The process spec form of {@link HEALTH_SUGGEST_POLICY_COMMAND}. */
export function healthSuggestPolicyProcess(): ApplicationProcessSpec {
	return refarmProcess([HEALTH, "suggest-policy", "--json"]);
}
