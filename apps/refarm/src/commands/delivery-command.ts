import {
	buildJsonErrorEnvelope,
	buildJsonSuccessEnvelope,
	printJson,
} from "@refarm.dev/capabilities/envelope";
import {
	parseDeclaredTokenRef,
	routeDelivery,
	type DeliveryRequest,
	type ResolvedDeliveryChannel,
} from "@refarm.dev/delivery-contract-v1";
import chalk from "chalk";
import { Command } from "commander";
import {
	DeliveryAddRefusal,
	runDeliveryAdd,
	runDeliveryTest,
	type DeliveryAddOptions,
	type DeliveryAddResult,
} from "./delivery-add.js";
import {
	loadDeclaredDelivery,
	operatorIsAttending,
	type DeliveryChannelIssue,
} from "./delivery.js";

/**
 * `refarm delivery` — look at the declaration WITHOUT being interrupted by it.
 *
 * An operator who has just written a `delivery` block has one question ("is this
 * on?") and one worry ("will it actually carry a decision, or only shout?"). Both
 * were previously answerable only by triggering a real prompt and watching a real
 * phone, which is a terrible way to debug a notification: the feedback arrives on
 * a different device, minutes later, and the experiment costs a genuine question.
 *
 * So this command answers both from the terminal, and it does it WITHOUT sending
 * anything. `list` resolves the declaration exactly as the mount does — same
 * parser, same registry, same S3 refusals — and `route` runs the real router
 * (`routeDelivery`, which is pure and calls no adapter) against a hypothetical
 * question. No token is read, no request leaves the process, no prompt is
 * published.
 *
 * WHAT IS NEVER PRINTED: the token. A declaration NAMES a source — a path or an
 * environment variable's NAME — and that name is what appears below. The value is
 * resolved at use, by the adapter, once, and it does not come back here.
 */

const DELIVERY_HELP_COMMAND = "refarm delivery --help";
const DELIVERY_LIST_COMMAND = "refarm delivery list --json";

interface DeliveryCommandOptions {
	json?: boolean;
	kind?: string;
	question?: string;
	attending?: boolean;
}

/**
 * The declaration as it is safe to print: a source NAMED, never a value.
 *
 * Goes through the same `parseDeclaredTokenRef` the adapters do, so what is shown
 * is what will actually be resolved — and a declaration naming no source at all
 * says so rather than pretending it has one.
 */
function describeTokenSource(declaration: ResolvedDeliveryChannel["declaration"]): string | null {
	try {
		const ref = parseDeclaredTokenRef(declaration);
		return ref.kind === "file" ? `file:${ref.path}` : `env:${ref.name}`;
	} catch {
		return null;
	}
}

function failDelivery(operation: string, options: DeliveryCommandOptions, message: string): void {
	if (options.json) {
		printJson(
			buildJsonErrorEnvelope({
				command: "delivery",
				operation,
				error: "delivery-invalid-request",
				message,
				nextAction: `Run \`${DELIVERY_HELP_COMMAND}\` to see the accepted options.`,
				nextCommand: DELIVERY_HELP_COMMAND,
			}),
		);
	} else {
		console.error(chalk.red(`✗  ${message}`));
		console.error(chalk.dim(`   ${DELIVERY_HELP_COMMAND}`));
	}
	process.exitCode = 1;
}

/**
 * The refusal shape for the authoring subcommands, which carry their OWN code and handoff.
 *
 * `DeliveryAddRefusal` knows why it refused and where the operator should go next — a wizard that
 * cannot find a token file and one that has no terminal to ask at need different next commands,
 * and flattening both into "see --help" throws away the only useful part.
 */
function failAuthoring(operation: string, options: DeliveryCommandOptions, error: unknown): void {
	const refusal = error instanceof DeliveryAddRefusal ? error : null;
	const message = error instanceof Error ? error.message : String(error);
	const code = refusal?.code ?? "delivery-invalid-request";
	const nextCommands = refusal?.nextCommands ?? [DELIVERY_HELP_COMMAND];
	if (options.json) {
		printJson(
			buildJsonErrorEnvelope({
				command: "delivery",
				operation,
				error: code,
				message,
				nextAction: `Run \`${nextCommands[0] ?? DELIVERY_HELP_COMMAND}\`.`,
				nextCommands,
			}),
		);
	} else {
		console.error(chalk.red(`✗  ${message}`));
		for (const next of nextCommands) console.error(chalk.dim(`   ${next}`));
	}
	process.exitCode = 1;
}

/** Wrap an async action so any failure becomes a refusal rather than an escaped exception. */
function guardedAsync(
	operation: string,
	handler: (options: DeliveryCommandOptions & DeliveryAddOptions) => Promise<void>,
): (options: DeliveryCommandOptions & DeliveryAddOptions) => Promise<void> {
	return async (options) => {
		try {
			await handler(options);
		} catch (error) {
			failAuthoring(operation, options, error);
		}
	};
}

/** Wrap an action so a validation error becomes the repo's refusal shape. */
function guarded(
	operation: string,
	handler: (options: DeliveryCommandOptions) => void,
): (options: DeliveryCommandOptions) => void {
	return (options) => {
		try {
			handler(options);
		} catch (error) {
			failDelivery(operation, options, error instanceof Error ? error.message : String(error));
		}
	};
}

function issueLines(issues: readonly DeliveryChannelIssue[]): string[] {
	return issues.map((issue) => `${issue.channel} (${issue.adapter}): ${issue.detail}`);
}

/**
 * The hypothetical question `route` reasons about.
 *
 * `needsDecision` is always true because that is the interesting case — an
 * announcement routes everywhere a decision does and more, so a plan that can
 * carry a decision is the stronger statement. `answerTravels` follows the same
 * rule the wire does (`secret` travels), so P4's refusal is visible here too.
 */
function probeRequest(kind: string, question: string): DeliveryRequest {
	const request: DeliveryRequest = {
		promptId: "(probe)",
		question,
		asker: "refarm delivery route",
		needsDecision: true,
		answerTravels: kind === "secret",
		expiresAt: null,
	};
	if (kind === "confirm") {
		return {
			...request,
			choices: [
				{ value: "true", label: "Yes" },
				{ value: "false", label: "No" },
			],
		};
	}
	if (kind === "select") {
		return {
			...request,
			choices: [
				{ value: "a", label: "A" },
				{ value: "b", label: "B" },
			],
		};
	}
	// text and secret offer no enumerable choices — which is exactly the rule that
	// degrades them to announce, and the reason they are worth probing.
	return request;
}

const PROBE_KINDS = ["confirm", "select", "text", "secret"] as const;

function resolveKind(value: string | undefined): string {
	const kind = (value ?? "confirm").trim();
	if (!(PROBE_KINDS as readonly string[]).includes(kind)) {
		throw new Error(`--kind must be one of: ${PROBE_KINDS.join(", ")}.`);
	}
	return kind;
}

/** `--option key=value`, repeatable. */
function collectOption(value: string, previous: string[]): string[] {
	return [...previous, value];
}

/**
 * Where the operator goes next, per outcome.
 *
 * `ok` means "the command did its job", not "the answer was yes" — so a decline, a deferral and a
 * cancellation are all successful runs of a command whose job was to ask. What changes is the
 * handoff, because those three lead to genuinely different next steps.
 */
function addNextAction(result: DeliveryAddResult): string | null {
	switch (result.status) {
		case "declared":
			return result.route.answerable
				? `Send one real test message with \`refarm delivery test ${result.channel}\` when you want to prove it end to end.`
				: `Declared, but a decision would not reach you there — check the refusals above, then \`refarm delivery test ${result.channel}\`.`;
		case "declined":
			return "Nothing was written. The refusal is recorded, so this will not be asked again.";
		case "deferred":
			return "Nothing was written and nothing recorded — run it again when you want to decide.";
		case "cancelled":
			return "Cancelled. Nothing was written.";
		case "unchanged":
			return "Kept what was already there.";
	}
}

function addNextCommands(result: DeliveryAddResult): string[] {
	if (result.status === "declared") {
		return [`refarm delivery test ${result.channel}`, DELIVERY_LIST_COMMAND, result.undoCommand];
	}
	return [DELIVERY_LIST_COMMAND];
}

function printAddResult(result: DeliveryAddResult): void {
	if (result.status !== "declared") {
		console.log(chalk.dim(addNextAction(result) ?? ""));
		return;
	}
	console.log(
		chalk.green(
			`✓  ${result.replaced ? "replaced" : "declared"} "${result.channel}" (${result.adapter})`,
		),
	);
	console.log(chalk.dim(`   ${result.configPath}`));
	if (result.tokenFile) console.log(chalk.dim(`   token: ${result.tokenFile} (0600)`));
	if (result.tokenEnv) console.log(chalk.dim(`   token: env:${result.tokenEnv}`));
	console.log(chalk.dim(`   undo:  ${result.undoCommand}`));
	// VERIFIED, not claimed: this is the real router, run against what was just written.
	console.log(
		result.route.answerable
			? chalk.green("   uma decisão chegaria até você por aqui, mesmo sem você estar atendendo")
			: chalk.yellow("   uma decisão NÃO chegaria até você por aqui:"),
	);
	for (const route of result.route.routes) {
		console.log(chalk.dim(`     → ${route.channel} (${route.adapter}) carrega ${route.mode}`));
	}
	for (const refusal of result.route.refusals) {
		console.log(chalk.dim(`     · ${refusal.detail}`));
	}
	console.log(chalk.dim(`   ${addNextAction(result)}`));
}

export function createDeliveryCommand(): Command {
	const command = new Command("delivery").description(
		"Inspect declared delivery channels and how a question would be routed",
	);

	command
		.command("list")
		.description("Show the declared delivery channels, and the ones that cannot be used")
		.option("--json", "Output machine-readable JSON")
		.action(
			guarded("list", (options) => {
				const { channels, issues } = loadDeclaredDelivery();
				const declared = channels.map((channel) => ({
					channel: channel.declaration.name,
					adapter: channel.adapter.id,
					capability: channel.adapter.capability,
					unattended: channel.declaration.unattended,
					// A SOURCE, never a value.
					token: describeTokenSource(channel.declaration),
				}));
				const nextCommand =
					declared.length > 0 ? "refarm delivery route --json" : DELIVERY_LIST_COMMAND;
				if (options.json) {
					printJson(
						buildJsonSuccessEnvelope({
							command: "delivery",
							operation: "list",
							nextAction:
								declared.length > 0
									? "Check how a decision would be routed before relying on it."
									: "Declare a delivery channel in .refarm/config.json to be notified.",
							nextCommand,
							extra: {
								declared: declared.length > 0,
								channels: declared,
								issues,
								attending: operatorIsAttending(),
							},
						}),
					);
					return;
				}
				if (declared.length === 0) {
					console.log(chalk.dim("No delivery channel is declared — refarm will not notify you."));
				}
				for (const entry of declared) {
					console.log(
						`${chalk.bold(entry.channel)}  ${entry.adapter}  ${entry.capability}` +
							`  ${entry.unattended ? "unattended" : "attended-only"}` +
							(entry.token ? chalk.dim(`  ${entry.token}`) : ""),
					);
				}
				for (const line of issueLines(issues)) console.error(chalk.yellow(`!  ${line}`));
			}),
		);

	command
		.command("route")
		.description("Show which declared channels a question would reach — sends nothing")
		.option("--kind <type>", `Prompt kind to probe (${PROBE_KINDS.join(" | ")})`)
		.option("--question <text>", "The question text to probe with")
		.option("--attending", "Probe as if an attention window were armed (D8)")
		.option("--json", "Output machine-readable JSON")
		.action(
			guarded("route", (options) => {
				const kind = resolveKind(options.kind);
				const question = options.question?.trim() || "Probe: would this reach you?";
				const { channels, issues } = loadDeclaredDelivery();
				const attending = options.attending ?? operatorIsAttending();
				const plan = routeDelivery({
					request: probeRequest(kind, question),
					channels,
					attending,
				});
				const routes = plan.routes.map((route) => ({
					channel: route.channel,
					adapter: route.adapter.id,
					mode: route.mode,
				}));
				const refusals = plan.refusals.map((refusal) => ({
					channel: refusal.channel,
					adapter: refusal.adapter,
					reason: refusal.reason,
					detail: refusal.detail,
				}));
				if (options.json) {
					printJson(
						buildJsonSuccessEnvelope({
							command: "delivery",
							operation: "route",
							nextAction: plan.answerable
								? null
								: "No declared channel can carry this decision back — you would have to answer at the terminal.",
							nextCommand: DELIVERY_LIST_COMMAND,
							extra: {
								kind,
								attending,
								answerable: plan.answerable,
								routes,
								refusals,
								issues,
								/** Nothing was sent. Stated so a reader never has to infer it. */
								sent: false,
							},
						}),
					);
					return;
				}
				console.log(
					`${chalk.bold(kind)}  ${attending ? "attending" : "not attending"}  ` +
						(plan.answerable ? chalk.green("answerable") : chalk.yellow("announce-only")),
				);
				for (const route of routes) {
					console.log(`  → ${route.channel} (${route.adapter}) carries ${route.mode}`);
				}
				for (const refusal of refusals) {
					console.log(chalk.dim(`  · ${refusal.channel}: ${refusal.detail}`));
				}
				for (const line of issueLines(issues)) console.error(chalk.yellow(`!  ${line}`));
			}),
		);

	command
		.command("add")
		.description("Declare a delivery channel, guided — writes the same .refarm/config.json")
		.option("--name <name>", "What to call the channel (defaults to the adapter's id)")
		.option("--adapter <id>", "Which registered adapter serves it")
		.option("--capability <mode>", "announce | answer — asked when not given")
		.option("--unattended", "It reaches you when you are not attending")
		.option("--attended-only", "It only reaches you while you are attending")
		.option("--token-env <NAME>", "Name an environment variable holding the token")
		.option("--token-file <path>", "Point at a token file you already wrote")
		.option("--option <key=value>", "Adapter-owned setting (repeatable)", collectOption, [])
		.option("--replace", "Re-open a channel that is already declared or already decided")
		.option("--json", "Output machine-readable JSON")
		.action(
			guardedAsync("add", async (options) => {
				const result = await runDeliveryAdd(options);
				if (options.json) {
					printJson(
						buildJsonSuccessEnvelope({
							command: "delivery",
							operation: "add",
							nextAction: addNextAction(result),
							nextCommands: addNextCommands(result),
							extra: { ...result },
						}),
					);
					return;
				}
				printAddResult(result);
			}),
		);

	command
		.command("test")
		.description("Send ONE real message through a declared channel — asks first, every time")
		.argument("<name>", "The declared channel to test")
		.option("--json", "Output machine-readable JSON")
		.action(async (name: string, options: DeliveryCommandOptions) => {
			try {
				const result = await runDeliveryTest(name);
				if (options.json) {
					printJson(
						buildJsonSuccessEnvelope({
							command: "delivery",
							operation: "test",
							nextAction: result.sent ? null : "Nothing was sent.",
							nextCommands: [DELIVERY_LIST_COMMAND],
							extra: { ...result },
						}),
					);
					return;
				}
				if (!result.sent) {
					console.log(chalk.dim("Nada foi enviado."));
					return;
				}
				for (const outcome of result.outcomes) {
					const mark = outcome.status === "delivered" ? chalk.green("✓") : chalk.yellow("!");
					console.log(
						`${mark}  ${outcome.adapter}: ${outcome.status}${outcome.detail ? ` — ${outcome.detail}` : ""}`,
					);
				}
			} catch (error) {
				failAuthoring("test", options, error);
			}
		});

	command.addHelpText(
		"after",
		`

Examples:
  $ refarm delivery add
  $ refarm delivery add --adapter telegram --option chatId=123456789 --token-env TG_TOKEN \\
      --capability answer --unattended
  $ refarm delivery list --json
  $ refarm delivery route --kind confirm --json
  $ refarm delivery route --kind secret --attending
  $ refarm delivery test telegram

Notes:
  \`list\` and \`route\` send nothing, read no token, and publish no prompt.
  \`add\` is a humane path to the SAME file: it asks, shows the exact JSON, and writes
  only after you authorise it. Hand-editing .refarm/config.json keeps working, and
  \`add\` reads what you wrote. A token is prompted without echo and written to
  .refarm/delivery/<name>.token at 0600; the declaration names the FILE, never the value.
  \`test\` is the only subcommand that sends anything, and it asks first, separately.
`,
	);

	return command;
}

export const deliveryCommand = createDeliveryCommand();
