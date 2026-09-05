/**
 * A DELIBERATELY BROKEN EMITTER. Not dead code — the proof that
 * `test/architecture/executable-guidance-conformance.test.ts` goes red.
 *
 * Every line below is a next step that a shell could not run as printed, and between them they
 * trip every rule the harness enforces. If the harness ever stops reporting all of them, it has
 * lost the ability to catch the thing it was written for, and the "goes red on a
 * deliberately-broken fixture emitter" test says so — a green suite over a harness that checks
 * nothing is the failure mode this file exists to make impossible.
 *
 * Nothing imports this at runtime. It is read as SOURCE by the harness, exactly as the real
 * emitters are.
 */

import { refarmCommand } from "../../../src/brand.js";

/** BROKEN — `cert trust system` is declared privileged, and `sudo`'s secure_path omits
 *  `~/.local/bin`, so the bare binary is not found. This is the exact shape `refarm cert issue`
 *  used to print. (Its sibling `refarm cert trust` — the browser scope — is NOT broken: it writes
 *  inside `$HOME` and needs no privilege, which is why it is absent from this file.) */
export const BARE_PRIVILEGED_STEP = refarmCommand(["cert", "trust", "system"]);

/** BROKEN — the same step spelled out under `sudo` in printed prose. */
export const SUDO_IN_PROSE = "Re-run as `sudo -E refarm cert trust system`.";

/** BROKEN twice over — no such subcommand (a shell finds `refarm`, and `refarm` refuses), and
 *  `--json` is an option of `cert trust`, which this does not reach, not of the `cert` group. */
export const MISSPELLED_SUBCOMMAND = refarmCommand(["cert", "trustt", "--json"]);

/** BROKEN — a placeholder where a subcommand name belongs: no value the operator types resolves. */
export const PLACEHOLDER_AS_SUBCOMMAND = refarmCommand(["<surface>", "status", "--json"]);
