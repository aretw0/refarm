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
 * THIS IS AN OVER-APPROXIMATION, DELIBERATELY. `refarm cert trust --anchor ~/staging.crt`
 * needs no root at all. Declaring the step rather than the exact invocation means the guidance
 * defaults to the form that works in the case that actually bites — the system trust store —
 * and the operator who passed `--anchor` loses nothing but an unnecessary `sudo`.
 */

/** Key: the argv path from the root binary, space-joined. Value: why root is involved. */
export const PRIVILEGED_STEPS: Readonly<Record<string, string>> = {
	"cert trust":
		"writes the CA trust anchor into the system trust store (/usr/local/share/ca-certificates) " +
		"and refreshes it with `update-ca-certificates` — both belong to root. sudo's secure_path " +
		"drops ~/.local/bin, so a bare `refarm` here is not found.",
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
