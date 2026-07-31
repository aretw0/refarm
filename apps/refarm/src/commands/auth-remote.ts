import { buildJsonSuccessEnvelope, printJson } from "@refarm.dev/capabilities/envelope";
import { Command } from "commander";

import { refarmCommand } from "../brand.js";
import {
	REMOTELY_INITIABLE_OPERATIONS,
	remoteInitiationCommandLine,
} from "./remote-initiation.js";

/**
 * `refarm auth remote` — WHAT AN ENROLLED DEVICE MAY START, asked and answered.
 *
 * The declaration in `remote-initiation.ts` would be worth much less if reading it meant reading
 * a source file: a rule the operator cannot inspect from the outside is a rule they have to trust
 * rather than check. This is the check. It is a subcommand of `auth`, beside `auth list` — which
 * answers "WHO is enrolled" — because together they are the whole sentence: these devices, these
 * operations.
 *
 * It lives in its own module rather than in `auth.ts` for a reason worth keeping: `auth.ts` is
 * under a source-text guard (`auth.test.ts`, "no enrolment module so much as names the declaration
 * file") which forbids enrolment code from even mentioning `config.json`, so that discovery can
 * never quietly start reading the operator's declaration. This command legitimately names that
 * file — to point the operator's OWN commands at the door they actually use — and the right answer
 * is to sit outside the guarded set, not to loosen the guard.
 *
 * It reads no policy file and touches no state: the answer is a property of this build, identical
 * on every node, and saying so is part of the point. Whether a given DEVICE is enrolled is
 * `auth list`'s question, and conflating the two would let a reader think an empty device list
 * narrowed this one.
 */
export function createAuthRemoteCommand(): Command {
	return new Command("remote")
		.description("List the operations an enrolled device may start on this node")
		.option("--json", "Print the result as JSON")
		.action((options: { json?: boolean }) => {
			const operations = REMOTELY_INITIABLE_OPERATIONS.map((operation) => ({
				id: operation.id,
				command: remoteInitiationCommandLine(operation),
				why: operation.why,
			}));
			if (options.json) {
				printJson(
					buildJsonSuccessEnvelope({
						command: "auth",
						operation: "remote",
						nextAction: "Confirm which devices hold a credential that could start these.",
						nextCommands: [refarmCommand(["auth", "list", "--json"])],
						extra: { operations, closedByDefault: true },
					}),
				);
				return;
			}
			if (operations.length === 0) {
				process.stdout.write(
					"No operation on this node may be started by a device.\n" +
						"  An operation that does not declare itself remotely initiable may not be started\n" +
						"  remotely — silence is closed, and nothing here has spoken.\n",
				);
				return;
			}
			process.stdout.write(
				`Operations an enrolled device may start (${operations.length}):\n` +
					operations.map(({ command, why }) => `  • ${command}\n      ${why}\n`).join("") +
					"\n" +
					"  Everything else is closed. An operation that does not declare itself remotely\n" +
					"  initiable may not be started remotely, including one added tomorrow.\n" +
					"  Your OWN commands are a different door: they stay allowlisted per workspace in\n" +
					`  .refarm/config.json and run through ${refarmCommand([
						"workspace",
						"run",
						"<workspace>",
						"<command>",
					])}.\n`,
			);
		});
}
