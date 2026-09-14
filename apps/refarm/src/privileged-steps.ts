/**
 * WHICH OF THIS CLI'S OWN STEPS NEED ROOT — declared once, read by the emitter and by the
 * architecture harness that checks the emitter.
 *
 * WHY A DECLARATION AT ALL. A handoff string cannot be inspected for privilege: `refarm cert
 * trust` looks exactly like `refarm cert issue`, and only one of them writes into a directory
 * that belongs to root. The difference is a fact about the operating system, not about the
 * text, so it is stated here rather than guessed at — and stated with the reason, because a
 * bare list of names rots into something nobody can audit.
 *
 * WHAT IT BUYS. `sudo` replaces `PATH` with `secure_path`, and every distribution that sets
 * one omits per-user bin directories such as `~/.local/bin`. A step declared here must
 * therefore be emitted through {@link refarmPrivilegedCommand}, which names the interpreter
 * and entrypoint by absolute path. `test/architecture/executable-guidance-conformance.test.ts`
 * enforces that, and enforces that every key here is a command the program actually has —
 * so a renamed or removed command takes its entry down with it instead of leaving a rule that
 * silently guards nothing.
 *
 * THIS IS AN OVER-APPROXIMATION, DELIBERATELY. `refarm cert trust system --anchor ~/staging.crt`
 * needs no root at all. Declaring the step rather than the exact invocation means the guidance
 * defaults to the form that works in the case that actually bites — the system trust store —
 * and the operator who passed `--anchor` loses nothing but an unnecessary `sudo`.
 *
 * AN OVER-APPROXIMATION IS NOT A LICENCE TO DECLARE THE WHOLE COMMAND. `cert trust` used to be
 * keyed here, and it should not have been: its default scope writes into the operator's own NSS
 * databases under `$HOME` and needs nothing. Declaring the parent forced every emission of it
 * through `refarmPrivilegedCommand`, so the guidance printed `sudo -E <interpreter> <entrypoint>
 * cert trust` for a step that needs no privilege — which is how an operator ends up typing `sudo`
 * to open a page in their own browser. The key is the SUBCOMMAND that actually touches root's
 * directory, and the scope is a subcommand precisely so this file can say which.
 */

/** Key: the argv path from the root binary, space-joined. Value: why root is involved. */
export const PRIVILEGED_STEPS: Readonly<Record<string, string>> = {
	"cert trust system":
		"writes the CA trust anchor into the system trust store (/usr/local/share/ca-certificates) " +
		"and refreshes it with `update-ca-certificates` — both belong to root. sudo's secure_path " +
		"drops ~/.local/bin, so a bare `refarm` here is not found. Its sibling `cert trust` " +
		"(browser scope) writes only inside $HOME and is deliberately NOT declared here.",
};

/** The argv path a handoff points at, in the form {@link PRIVILEGED_STEPS} is keyed by. */
export function privilegedStepKey(argv: readonly string[]): string {
	return argv.filter((token) => !token.startsWith("-")).join(" ");
}

/** Why this step needs root, or `null` when it does not. */
export function privilegedStepReason(argv: readonly string[]): string | null {
	return PRIVILEGED_STEPS[privilegedStepKey(argv)] ?? null;
}

/** Does this step need root? */
export function isPrivilegedStep(argv: readonly string[]): boolean {
	return privilegedStepReason(argv) !== null;
}
