import {
	deliver,
	parseDeliveryCatalog,
	refuseOverclaimedDeclaration,
	refuseUnenforceableAdapter,
	routeDelivery,
	type DeliveryAdapter,
	type DeliveryAdapterFactory,
	type DeliveryDeclaration,
	type DeliveryRequest,
	type ResolvedDeliveryChannel,
} from "@refarm.dev/delivery-contract-v1";
import {
	createFileOperationTrail,
	createNodeOperationFileSystem,
	undoOperationRecord,
	type OperationFileSystem,
	type OperationTrail,
} from "@refarm.dev/operation-consent-v1";
import {
	createStdioOperatorChannel,
	OperatorPromptCancelledError,
	type OperatorChannel,
	type OperatorNoticeInput,
	type SelectPrompt,
	type TextPrompt,
} from "@refarm.dev/prompt-contract-v1";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { refarmCommand } from "../brand.js";
import {
	authorCatalogDeclaration,
	buildCatalogOperationRequest,
	catalogConfigPath,
	catalogTrailPath,
	planCatalogDeclaration,
	renderCatalogProposal,
	sovereignDirRelative,
	standingCatalogDecision,
	type CatalogDeclarationPlan,
} from "./catalog-authoring.js";
import { defaultDeliveryAdapterFactories } from "./delivery-adapters.js";
import { loadDeclaredDelivery } from "./delivery.js";

/**
 * `refarm delivery add` — declaring a delivery channel as a GUIDED experience.
 *
 * Design: `docs/superpowers/specs/2026-07-31-declaring-is-authoring-design.md`.
 *
 * The operator's complaint that forced this: *"não deixando eu preso a ter que fazer as coisas na
 * unha … quero que até superfícies novas tenham uma boa experiência em serem intencionadas."*
 * Declared delivery gave them sovereignty and left authoring at "hand-edit JSON, knowing the
 * vocabulary by heart". This is the humane path to the same file.
 *
 * FOUR THINGS THIS DOES NOT DO, each of which is the point:
 *
 *  1. **It does not invent a second source of truth.** The output is `.refarm/config.json`, in the
 *     `delivery` vocabulary the parser already reads. Hand-editing keeps working; a hand-written
 *     declaration is read, shown, and (with consent) replaced rather than duplicated.
 *  2. **It does not synthesise.** Every value comes from an answer or a flag. A launch script that
 *     GENERATED the operator's declaration with `jq` was removed from this repo and it was right to
 *     refuse it — the difference between that and this is not the file being written, it is who
 *     decided.
 *  3. **It does not put the token in the config.** The secret is prompted without echo and written
 *     to `<sovereign>/delivery/<name>.token` at mode 0600; the declaration references it by PATH.
 *     The token is deliberately outside the consent change set, because a change set becomes
 *     before/after snapshots in `operations.json` — a durable trail is exactly where a secret must
 *     not be.
 *  4. **It does not guess `capability` or `unattended`.** The parser refuses to guess them and so
 *     does this: they are asked in terms a person can answer, with the consequence of each answer
 *     stated, and the options are narrowed to what the chosen adapter can actually enforce (S3).
 *
 * It ends by VERIFYING rather than claiming: the declaration is re-read from disk and run through
 * the real router, so what is printed at the end is what a real question would reach. A real test
 * send is a separate command with its own authorisation — bundling it is how a small yes becomes a
 * large one.
 */

export const DELIVERY_BLOCK = "delivery" as const;

const DELIVERY_LIST_COMMAND = refarmCommand(["delivery", "list", "--json"]);
const DELIVERY_ADD_COMMAND = refarmCommand(["delivery", "add"]);

// ── Refusals ──────────────────────────────────────────────────────────────────

/** A refusal the command turns into the repo's envelope. Carries the handoff, so the caller never
 *  has to invent one for a case it does not understand. */
export class DeliveryAddRefusal extends Error {
	constructor(
		readonly code: string,
		message: string,
		readonly nextCommands: string[] = [DELIVERY_LIST_COMMAND],
	) {
		super(message);
		this.name = "DeliveryAddRefusal";
	}
}

// ── What each adapter needs asked ─────────────────────────────────────────────

export interface DeliveryAdapterQuestion {
	/** The declaration key this answer becomes. */
	key: string;
	prompt: TextPrompt;
	/** Normalise and refuse an unusable answer. Throws `DeliveryAddRefusal`. */
	parse(raw: string): unknown;
}

/**
 * The guided authoring for one adapter — the ONLY adapter-specific knowledge in this file.
 *
 * Kept beside `delivery-adapters.ts` (the registry that already knows which ways of reaching the
 * operator exist) rather than pushed into `DeliveryAdapterFactory`: the contract package is
 * consumed by the node, and a question set is a terminal concern. A new adapter adds an entry
 * here; an adapter with no entry is not a failure — the operator is told to declare it by hand,
 * which is the path that must never stop working.
 */
export interface DeliveryAdapterAuthoring {
	adapter: string;
	/** One line: what this channel IS. */
	summary: string;
	/** What the operator has to have already. PRINTED, never performed — refarm does not create
	 *  anyone's bot, and does not talk to a third party on their behalf. */
	preflight: string[];
	questions: DeliveryAdapterQuestion[];
}

const TELEGRAM_AUTHORING: DeliveryAdapterAuthoring = {
	adapter: "telegram",
	summary: "Telegram — o bot fala com você no app que já está no seu bolso.",
	preflight: [
		"Você precisa de um bot SEU e do token dele (o @BotFather entrega em /newbot ou /token).",
		"E do chatId: a conversa em que o bot fala com você — a sua, um grupo, um canal.",
		"refarm não cria bot nem fala com o BotFather por você. O bot é seu; eu só guardo a referência.",
	],
	questions: [
		{
			key: "chatId",
			prompt: {
				type: "text",
				question: "Qual o chatId? (o identificador da conversa, não é segredo)",
				placeholder: "123456789",
			},
			parse(raw) {
				const value = raw.trim();
				if (!value) {
					throw new DeliveryAddRefusal(
						"delivery-add-invalid-option",
						'telegram precisa de um "chatId" — a conversa em que o bot deve falar com você.',
					);
				}
				return value;
			},
		},
	],
};

const AUTHORING_BY_ADAPTER: ReadonlyMap<string, DeliveryAdapterAuthoring> = new Map([
	[TELEGRAM_AUTHORING.adapter, TELEGRAM_AUTHORING],
]);

/** The guided authoring for an adapter, or `null` when it has none yet. */
export function deliveryAdapterAuthoring(adapter: string): DeliveryAdapterAuthoring | null {
	return AUTHORING_BY_ADAPTER.get(adapter) ?? null;
}

// ── The two questions refarm refuses to guess ─────────────────────────────────

/**
 * `capability`, asked as what it MEANS.
 *
 * Not "declare a capability" — *can this channel carry a decision back to me?* The consequence of
 * each answer is stated, because the answer decides whether a wizard can wait on this channel or
 * can only shout at it, and an operator who over-claims here gets a question that waits forever
 * for a reply with nowhere to come from (D3).
 */
export function deliveryCapabilityPrompt(options: {
	channel: string;
	adapterCanAnswer: boolean;
}): SelectPrompt {
	const prompt: SelectPrompt = {
		type: "select",
		question: `"${options.channel}" consegue trazer uma DECISÃO de volta pra mim?`,
		options: [
			{
				value: "answer",
				label: "Sim — eu respondo pelo próprio aviso (botão, resposta) e o refarm segue",
				description:
					"refarm pode fazer uma pergunta por aqui e esperar a sua escolha chegar de volta",
			},
			{
				value: "announce",
				label: "Não — ele só me avisa; para responder eu ainda vou até o terminal",
				description:
					"refarm nunca manda uma decisão por aqui; o aviso diz que há algo esperando por você",
			},
		],
		default: options.adapterCanAnswer ? "answer" : "announce",
	};
	if (options.adapterCanAnswer) return prompt;
	// S3: never offer a claim the adapter cannot enforce.
	return { ...prompt, options: prompt.options.filter((option) => option.value === "announce") };
}

/**
 * `unattended`, asked as what it MEANS.
 *
 * Not "declare unattended" — *does this reach me when I am not attending?* The consequence is the
 * one that bites at 3am: a channel declared attended-only is skipped unless an attention window is
 * armed, and the question simply waits (D8).
 */
export function deliveryUnattendedPrompt(options: {
	channel: string;
	adapterIsUnattended: boolean;
}): SelectPrompt {
	const prompt: SelectPrompt = {
		type: "select",
		question: `"${options.channel}" te alcança quando você NÃO está atendendo — celular no bolso, terminal fechado?`,
		options: [
			{
				value: "true",
				label: "Sim — pode me interromper a qualquer hora",
				description: "uma pergunta às 3 da manhã chega até você por aqui",
			},
			{
				value: "false",
				label: "Não — só me use quando eu declarar que estou atendendo",
				description: `sem uma janela armada (${refarmCommand(["intention", "arm"])}), refarm pula este canal e a pergunta espera`,
			},
		],
		default: options.adapterIsUnattended ? "true" : "false",
	};
	if (options.adapterIsUnattended) return prompt;
	return { ...prompt, options: prompt.options.filter((option) => option.value === "false") };
}

// ── The token file ────────────────────────────────────────────────────────────

/** Where a channel's token lives, RELATIVE to the sovereign root — what the declaration carries,
 *  so the config stays portable and says nothing about this machine's home directory. */
export function deliveryTokenRelativePath(
	name: string,
	env: NodeJS.ProcessEnv = process.env,
): string {
	const safe = name.replace(/[^a-zA-Z0-9._-]/g, "_");
	return path.join(sovereignDirRelative(env), "delivery", `${safe}.token`);
}

/** The one write this module makes outside the consent change set. Seamed so a test can observe
 *  it, defaulted to the real filesystem with the permission the secret requires. */
export interface DeliveryTokenWriter {
	write(absolutePath: string, token: string): Promise<void>;
}

/**
 * 0600, asserted rather than hoped for.
 *
 * `mode` on `writeFile` applies only when the file is CREATED, so an existing token file would
 * silently keep whatever permission it had. The explicit `chmod` closes that — rotating a token
 * must not be how a secret becomes world-readable.
 */
export function createNodeDeliveryTokenWriter(): DeliveryTokenWriter {
	return {
		async write(absolutePath, token) {
			await fsp.mkdir(path.dirname(absolutePath), { recursive: true, mode: 0o700 });
			await fsp.writeFile(absolutePath, `${token}\n`, { mode: 0o600 });
			await fsp.chmod(absolutePath, 0o600);
		},
	};
}

// ── Options and result ────────────────────────────────────────────────────────

export interface DeliveryAddOptions {
	name?: string;
	adapter?: string;
	capability?: string;
	unattended?: boolean;
	attendedOnly?: boolean;
	tokenEnv?: string;
	tokenFile?: string;
	/** Adapter-owned settings as `key=value`, repeatable — the generic escape hatch that keeps this
	 *  command from growing a flag per adapter. */
	option?: string[];
	/** "I know something is already there / already decided — ask me anyway." */
	replace?: boolean;
	/**
	 * "There is no terminal here, and that is fine — I am attending from another surface."
	 *
	 * Set by `auth remote run`, which only ever runs because an enrolled device asked it to,
	 * so the device IS the attending surface. Never inferred: a publisher exists on every
	 * node since the pending-prompt bridge, so its presence says nothing about whether a
	 * human is watching.
	 */
	attendedElsewhere?: boolean;
}

export interface DeliveryRouteProbe {
	answerable: boolean;
	routes: Array<{ channel: string; adapter: string; mode: string }>;
	refusals: Array<{ channel: string; reason: string; detail: string }>;
}

export type DeliveryAddResult =
	| {
			status: "declared";
			channel: string;
			adapter: string;
			capability: string;
			unattended: boolean;
			configPath: string;
			/** The PATH the token was written to, or null when the operator named an env var. */
			tokenFile: string | null;
			/** The NAME of the environment variable, or null. Never a value. */
			tokenEnv: string | null;
			recordId: string;
			undoCommand: string;
			route: DeliveryRouteProbe;
			replaced: boolean;
	  }
	| { status: "declined"; channel: string; recordId: string }
	/** "Agora não" — nothing recorded, the question comes back next run. */
	| { status: "deferred"; channel: string }
	/** Ctrl+C / EOF mid-wizard. Nothing asked after it, nothing written. */
	| { status: "cancelled"; channel: string | null }
	/** Something was already there and the operator chose to keep it. */
	| { status: "unchanged"; channel: string; reason: "already-declared" | "already-decided" };

export interface DeliveryAddDeps {
	/** Sovereign root the declaration is read from and written to. Defaults to cwd — delivery is
	 *  read from the project-local config, so that is the only scope where declaring it has an
	 *  effect. */
	root?: string;
	env?: NodeJS.ProcessEnv;
	/** Is there a human at a terminal? Defaults to real TTY detection. */
	interactive?: boolean;
	operator?: OperatorChannel;
	factories?: readonly DeliveryAdapterFactory[];
	trail?: OperationTrail;
	fs?: OperationFileSystem;
	tokenWriter?: DeliveryTokenWriter;
	now?: () => string;
	decidedBy?: string;
	host?: string;
	/** Where operator-facing lines go. Defaults to stdout. */
	announce?: (line: string) => void;
}

// ── The wizard ────────────────────────────────────────────────────────────────

function parseOptionPairs(pairs: readonly string[] | undefined): Record<string, string> {
	const out: Record<string, string> = {};
	for (const pair of pairs ?? []) {
		const at = pair.indexOf("=");
		if (at <= 0) {
			throw new DeliveryAddRefusal(
				"delivery-add-invalid-option",
				`--option must be "key=value" (got ${JSON.stringify(pair)}).`,
				[`${DELIVERY_ADD_COMMAND} --help`],
			);
		}
		out[pair.slice(0, at).trim()] = pair.slice(at + 1);
	}
	return out;
}

/**
 * Build the adapter to ask it what it can do, WITHOUT resolving a secret.
 *
 * The weakest possible claim goes in (`announce`, attended-only) because it is the one no adapter
 * can over-claim, so this never trips S3 on the way to finding out what S3 will allow.
 */
function probeAdapter(
	factory: DeliveryAdapterFactory,
	name: string,
	options: Record<string, unknown>,
): DeliveryAdapter {
	const declaration: DeliveryDeclaration = {
		name,
		adapter: factory.id,
		capability: "announce",
		unattended: false,
		options: Object.freeze({ ...options }),
	};
	const adapter = factory.create({
		declaration,
		resolveToken: async () => {
			// Nothing here needs a secret, and an adapter that reaches for one while being
			// INSPECTED is a bug worth failing loudly on rather than quietly satisfying.
			throw new Error("no token is resolved while authoring a declaration");
		},
	});
	refuseUnenforceableAdapter(adapter);
	return adapter;
}

/** The declaration entry, validated by the SAME parser that will read it back off disk. */
export function buildDeliveryEntry(input: {
	adapter: string;
	name: string;
	capability: "announce" | "answer";
	unattended: boolean;
	options: Record<string, unknown>;
	tokenFile?: string;
	tokenEnv?: string;
}): Record<string, unknown> {
	const entry: Record<string, unknown> = {
		adapter: input.adapter,
		capability: input.capability,
		unattended: input.unattended,
		...input.options,
	};
	if (input.tokenFile !== undefined) entry.tokenFile = input.tokenFile;
	if (input.tokenEnv !== undefined) entry.tokenEnv = input.tokenEnv;
	// Not decoration: the catalog refuses `token`/`botToken`/`apiKey` outright, and this wizard
	// must RESPECT that rule rather than route around it. Running the entry through the real
	// parser means a declaration this command produces can never be one the node would reject.
	parseDeliveryCatalog({ [DELIVERY_BLOCK]: { [input.name]: entry } });
	return entry;
}

const MAX_CHANNEL_NAME_LEN = 64;

function validateChannelName(raw: string): string {
	const name = raw.trim();
	if (!name) {
		throw new DeliveryAddRefusal(
			"delivery-add-invalid-name",
			"A channel name must not be blank — it is how you will refer to this channel.",
		);
	}
	if (name.length > MAX_CHANNEL_NAME_LEN) {
		throw new DeliveryAddRefusal(
			"delivery-add-invalid-name",
			`A channel name must be at most ${MAX_CHANNEL_NAME_LEN} characters.`,
		);
	}
	return name;
}

function undoCommandFor(recordId: string): string {
	return refarmCommand(["config", "history", "undo", recordId, "--local"]);
}

/**
 * What a question would reach, read back FROM DISK.
 *
 * Deliberately not computed from the values still in memory: the point of ending here is to prove
 * the file that was written parses, resolves and routes. Anything less would be claiming.
 */
function probeRoute(root: string, channel: string): DeliveryRouteProbe {
	const { channels } = loadDeclaredDelivery({ root });
	const mine = channels.filter((entry) => entry.declaration.name === channel);
	const request: DeliveryRequest = {
		promptId: "(probe)",
		question: "Probe: uma decisão chegaria até você por aqui?",
		asker: DELIVERY_ADD_COMMAND,
		needsDecision: true,
		answerTravels: false,
		expiresAt: null,
		choices: [
			{ value: "true", label: "Yes" },
			{ value: "false", label: "No" },
		],
	};
	// `attending: false` is the case worth proving: a channel that only works while you are
	// already looking is the failure the whole delivery slice exists to avoid.
	const plan = routeDelivery({ request, channels: mine, attending: false });
	return {
		answerable: plan.answerable,
		routes: plan.routes.map((route) => ({
			channel: route.channel,
			adapter: route.adapter.id,
			mode: route.mode,
		})),
		refusals: plan.refusals.map((refusal) => ({
			channel: refusal.channel,
			reason: refusal.reason,
			detail: refusal.detail,
		})),
	};
}

export async function runDeliveryAdd(
	options: DeliveryAddOptions,
	deps: DeliveryAddDeps = {},
): Promise<DeliveryAddResult> {
	const env = deps.env ?? process.env;
	const root = deps.root ?? process.cwd();
	const factories = deps.factories ?? defaultDeliveryAdapterFactories();

	// ── TWO SINKS, and the split is a SECURITY boundary, not a style choice ──────
	//
	// `say` goes through the OperatorChannel, which means it can now leave this
	// machine: to the node's notice ring, and — riding the next question — to a
	// declared delivery channel, which is a third party (Telegram sees message
	// content). That is correct for FRAMING: the sentences exist to explain a
	// question that already travels, and framing is strictly less sensitive than
	// the question it frames.
	//
	// It is NOT correct for everything this command prints. `renderCatalogProposal`
	// renders the config file with WHOLE_FILE context — the entire
	// `.refarm/config.json`: surfaces, workspaces, token references, connections.
	// No question ever carries that, and pushing a machine's whole topology into a
	// chat app is a widening nobody asked for. It is a LOCAL REVIEW ARTIFACT — shown
	// so the operator can check a file before it is written, at the terminal where
	// they are running the wizard — so it stays here.
	//
	// The line: framing explains a question; a config dump is a local review.
	const review = deps.announce ?? ((line: string) => console.log(line));

	// NOWHERE TO ASK ⇒ NO PROMPT, and no hang either. A declaration is the operator's; with
	// nobody to ask there is nobody to author it. The honest answer is to refuse and name the
	// paths that do work.
	//
	// The gate USED to be "is there a TTY", and its premise — "no terminal means nobody to ask"
	// — stopped being true. A question asked here is published to the node's pending-prompt hub
	// as well as to the terminal (`installDeclaredDelivery`, the `preAction` hook in
	// `program.ts`), and the operator answers it from whichever surface they are attending on:
	// the phone, the `/attend` page, `farm-attend`. R4 of the composable-onboarding design makes
	// that the whole point — the operator declaring a notification channel on the node WITHOUT
	// opening a terminal on the node.
	//
	// So the question the gate asks is now the honest one: **is there anywhere to ask at all?**
	// A terminal is one such place; a declared publisher is another. Only when there is neither
	// is there nobody to author the declaration, and only then does this refuse.
	//
	// `delivery test` (below) keeps the strict TTY gate on purpose, and the difference is not an
	// oversight: this command WRITES a declaration the operator can read back and remove, while
	// that one sends a REAL message out of the machine. Authorising the second from somewhere
	// else is a different decision, and it has not been made.
	// Refuse what the operator ALREADY told us before deciding to ask them anything.
	// A `--adapter` naming something unregistered is answerable from the arguments alone,
	// and walking someone through a series of questions only to reject an argument they
	// supplied at the start is the wrong order — worse still when "someone" is a device
	// that has to be attended for the questions to arrive at all.
	//
	// This also restores a property the refusal harness relies on and that the gate below
	// had quietly taken away: invalid input SETTLES, rather than waiting on a human who was
	// never coming.
	const declaredAdapterId = options.adapter?.trim();
	if (declaredAdapterId && !factories.some((factory) => factory.id === declaredAdapterId)) {
		throw new DeliveryAddRefusal(
			"delivery-add-unknown-adapter",
			`No delivery adapter called "${declaredAdapterId}" is registered. Registered: ` +
				`${factories.map((factory) => factory.id).join(", ") || "(none)"}.`,
			[DELIVERY_ADD_COMMAND, DELIVERY_LIST_COMMAND],
		);
	}

	// A publisher EXISTING is not evidence that anyone is attending, and since the
	// pending-prompt bridge landed it is installed unconditionally — so keying the gate on
	// `currentPromptPublisher() !== null` made the condition permanently true and stopped it
	// being a gate at all. A `delivery add` with no terminal then waited forever on a human
	// who was never coming.
	//
	// So a terminal is the default evidence, and being attended from somewhere else is
	// DECLARED by the caller that knows it — `auth remote run`, which was asked for by a
	// device that is attending. Silence is closed here as everywhere else.
	//
	// This is not the wizard learning it is remote: it asks the same questions in the same
	// order either way. It is the invocation stating that a local terminal is not required.
	const atTerminal = Boolean(process.stdin.isTTY && process.stdout.isTTY);
	const interactive = deps.interactive ?? (atTerminal || Boolean(options.attendedElsewhere));
	if (!interactive) {
		throw new DeliveryAddRefusal(
			"delivery-add-not-interactive",
			"Declaring a channel is your authorisation, and there is nowhere to ask you — no " +
				"terminal here, and no surface attending this node. Run this from an interactive " +
				"shell, attend the node from a device, or write the `delivery` block into " +
				`${catalogConfigPath(root, env)} by hand — hand-editing is ` +
				"still a first-class path, and this command reads what you wrote.",
			[DELIVERY_ADD_COMMAND, DELIVERY_LIST_COMMAND],
		);
	}
	const operator = deps.operator ?? createStdioOperatorChannel();

	/**
	 * Framing, through the CHANNEL.
	 *
	 * `console.log` is what left every wizard's explanation on the node while only
	 * its questions travelled — the defect this whole slice exists to remove. A
	 * channel that cannot say (`say` is optional) simply does not, and behaves
	 * exactly as it did before. See the two-sink note above for what does NOT come
	 * through here.
	 */
	const say = (notice: string | OperatorNoticeInput): void => operator.say?.(notice);

	let channelName: string | null = null;
	try {
		// ── 1. Which adapter ──────────────────────────────────────────────────────
		const available = factories.map((factory) => factory.id);
		let adapterId = options.adapter?.trim() || "";
		if (!adapterId) {
			if (available.length === 0) {
				throw new DeliveryAddRefusal(
					"delivery-add-no-adapters",
					"No delivery adapter is registered, so there is nothing to declare.",
				);
			}
			if (available.length === 1) {
				adapterId = available[0]!;
				// THE SILENCE THIS SLICE EXISTS TO REMOVE. Skipping the select made the
				// choice invisible, so the operator read `delivery add` as "the Telegram
				// command" rather than as a wizard over a registry that happens to hold
				// one adapter today. refarm chose; refarm says so.
				say({
					kind: "decision",
					message:
						`Um adaptador registrado: ${adapterId}. Escolhi ele — ` +
						`este comando serve qualquer adaptador registrado, não só este.`,
				});
			} else {
				adapterId = await operator.ask({
					type: "select",
					question: "Por onde o refarm deve te alcançar?",
					options: available.map((id) => ({ value: id, label: id })),
					default: available[0]!,
				});
			}
		}
		const factory = factories.find((entry) => entry.id === adapterId);
		if (!factory) {
			throw new DeliveryAddRefusal(
				"delivery-add-unknown-adapter",
				`No delivery adapter named "${adapterId}" is registered (available: ${available.join(", ") || "none"}).`,
			);
		}
		const authoring = deliveryAdapterAuthoring(factory.id);
		if (!authoring) {
			throw new DeliveryAddRefusal(
				"delivery-add-no-authoring",
				`"${factory.id}" has no guided authoring yet. Declare it by hand under "delivery" in ` +
					`${catalogConfigPath(root, env)}, then run ` +
					`\`${DELIVERY_LIST_COMMAND}\` — the parser is the same either way.`,
				[DELIVERY_LIST_COMMAND],
			);
		}

		say(authoring.summary);
		for (const line of authoring.preflight) say(`  · ${line}`);

		// ── 2. What to call it ────────────────────────────────────────────────────
		channelName = validateChannelName(
			options.name?.trim() ||
				(await operator.ask({
					type: "text",
					question: "Como você quer chamar este canal?",
					default: factory.id,
					placeholder: factory.id,
				})) ||
				factory.id,
		);

		// ── 3. Is something already there, or already decided? ────────────────────
		const trailPath = catalogTrailPath(catalogConfigPath(root, env));
		const trail =
			deps.trail ?? createFileOperationTrail(trailPath, deps.fs ?? createNodeOperationFileSystem());
		const declared = loadDeclaredDelivery({ root });
		const alreadyDeclared = declared.channels.some(
			(entry) => entry.declaration.name === channelName,
		);
		const prior = await standingCatalogDecision(trail, DELIVERY_BLOCK, channelName);

		if ((alreadyDeclared || prior) && !options.replace) {
			// RE-RUNNING NEVER DUPLICATES AND NEVER CLOBBERS. A catalog is keyed, so there is no
			// duplicate to make; what there is, is the chance to overwrite something silently, and
			// that is what this gate exists to stop. R4 covers the other half: a standing decision
			// is not re-asked by accident.
			const question = alreadyDeclared
				? `Já existe um canal chamado "${channelName}". Quero substituir a declaração dele?`
				: `Você já decidiu sobre "${channelName}" (${prior?.decision}, em ${prior?.decidedAt}). Quero decidir de novo?`;
			const again = await operator.ask({ type: "confirm", question, default: false });
			if (!again) {
				return {
					status: "unchanged",
					channel: channelName,
					reason: alreadyDeclared ? "already-declared" : "already-decided",
				};
			}
		}

		// ── 4. Adapter-owned settings ─────────────────────────────────────────────
		const fromFlags = parseOptionPairs(options.option);
		const adapterOptions: Record<string, unknown> = {};
		for (const question of authoring.questions) {
			const supplied = fromFlags[question.key];
			const raw = supplied ?? (await operator.ask(question.prompt));
			adapterOptions[question.key] = question.parse(raw);
		}
		for (const [key, value] of Object.entries(fromFlags)) {
			if (!(key in adapterOptions)) adapterOptions[key] = value;
		}

		// ── 5. The two refarm refuses to guess ────────────────────────────────────
		const probe = probeAdapter(factory, channelName, adapterOptions);
		const adapterCanAnswer = probe.capability === "answer";
		const adapterIsUnattended = probe.unattended;

		let capability: "announce" | "answer";
		if (options.capability) {
			const wanted = options.capability.trim();
			if (wanted !== "announce" && wanted !== "answer") {
				throw new DeliveryAddRefusal(
					"delivery-add-invalid-capability",
					'--capability must be "announce" or "answer".',
					[`${DELIVERY_ADD_COMMAND} --help`],
				);
			}
			capability = wanted;
		} else {
			const prompt = deliveryCapabilityPrompt({ channel: channelName, adapterCanAnswer });
			if (prompt.options.length === 1) {
				capability = prompt.options[0]!.value as "announce" | "answer";
				say({
					kind: "decision",
					message: `"${factory.id}" só sabe avisar — este canal fica como "announce".`,
				});
			} else {
				capability = (await operator.ask(prompt)) as "announce" | "answer";
			}
		}

		let unattended: boolean;
		if (options.unattended === true || options.attendedOnly === true) {
			if (options.unattended === true && options.attendedOnly === true) {
				throw new DeliveryAddRefusal(
					"delivery-add-conflicting-flags",
					"--unattended and --attended-only say opposite things; pass one.",
					[`${DELIVERY_ADD_COMMAND} --help`],
				);
			}
			unattended = options.unattended === true;
		} else {
			const prompt = deliveryUnattendedPrompt({ channel: channelName, adapterIsUnattended });
			if (prompt.options.length === 1) {
				unattended = prompt.options[0]!.value === "true";
				say({
					kind: "decision",
					message: `"${factory.id}" só te alcança enquanto você está atendendo — este canal fica "attended-only".`,
				});
			} else {
				unattended = (await operator.ask(prompt)) === "true";
			}
		}

		// ── 6. The secret — prompted without echo, never into the config ──────────
		const tokenRelative = deliveryTokenRelativePath(channelName, env);
		const tokenAbsolute = path.join(root, tokenRelative);
		let tokenValue: string | null = null;
		let tokenFile: string | null = null;
		let tokenEnv: string | null = null;

		if (options.tokenEnv?.trim()) {
			tokenEnv = options.tokenEnv.trim();
		} else if (options.tokenFile?.trim()) {
			tokenFile = options.tokenFile.trim();
		} else {
			say(`  · O token vai para ${tokenRelative}, com permissão 0600.`);
			say(
				"  · Ele NUNCA entra no config.json e nunca aparece em log — a declaração aponta o arquivo.",
			);
			const secret = await operator.ask({
				type: "secret",
				question: `Cole o token de "${channelName}" (não aparece na tela)`,
			});
			const trimmed = secret.trim();
			if (!trimmed) {
				throw new DeliveryAddRefusal(
					"delivery-add-empty-token",
					"An empty token would declare a channel that cannot be used. Nothing was written.",
					[DELIVERY_ADD_COMMAND],
				);
			}
			tokenValue = trimmed;
			tokenFile = tokenRelative;
		}

		// ── 7. The exact JSON, then the decision ──────────────────────────────────
		const entry = buildDeliveryEntry({
			adapter: factory.id,
			name: channelName,
			capability,
			unattended,
			options: adapterOptions,
			...(tokenFile === null ? {} : { tokenFile }),
			...(tokenEnv === null ? {} : { tokenEnv }),
		});
		// S3, one last time, against the real adapter: the operator may not declare, for a
		// channel, a capability its adapter cannot enforce.
		refuseOverclaimedDeclaration(
			{
				name: channelName,
				adapter: factory.id,
				capability,
				unattended,
				options: Object.freeze({ ...adapterOptions }),
			},
			probe,
		);

		const plan: CatalogDeclarationPlan = planCatalogDeclaration({
			block: DELIVERY_BLOCK,
			name: channelName,
			entry,
			root,
			env,
		});

		const notes = [
			tokenValue === null
				? tokenEnv !== null
					? `O segredo fica na variável de ambiente ${tokenEnv} — a declaração carrega o NOME, nunca o valor.`
					: `A declaração aponta para ${tokenFile}. Esse arquivo não é escrito por esta operação.`
				: `Além deste arquivo, eu escrevo o token em ${tokenRelative} com permissão 0600. ` +
					"Ele fica FORA deste registro de propósito: um registro é durável, e um segredo não " +
					"pode morar num lugar durável.",
			"Desfazer restaura o config.json; o arquivo de token continua onde está — apague-o à mão se quiser.",
		];

		const request = buildCatalogOperationRequest({
			plan,
			title: `${DELIVERY_ADD_COMMAND} ${channelName} (${factory.id})`,
			purpose:
				`Declarar o canal de entrega "${channelName}" para que o refarm consiga te alcançar ` +
				`(${capability === "answer" ? "pode trazer decisão de volta" : "só avisa"}, ` +
				`${unattended ? "alcança mesmo sem você estar atendendo" : "só enquanto você está atendendo"}).`,
			requester: DELIVERY_ADD_COMMAND,
			requestedAt: (deps.now ?? (() => new Date().toISOString()))(),
			notes,
		});

		// R2 — the operator authorises a SPECIFIC diff, so they get to see all of it. Rendered
		// here rather than through the consent journey's own `announce`, which shows three lines
		// of context: a diff you can only see three lines of is a category, not a change.
		// LOCAL, not `say`: this is the whole config file. See the two-sink note.
		for (const line of renderCatalogProposal(request)) review(line);

		const outcome = await authorCatalogDeclaration({
			request,
			channel: operator,
			trail,
			...(deps.fs ? { fs: deps.fs } : {}),
			...(deps.now ? { now: deps.now } : {}),
			...(deps.decidedBy ? { decidedBy: deps.decidedBy } : {}),
			host: deps.host ?? os.hostname(),
			...(prior ? { revisit: true } : {}),
		});

		if (outcome.status === "declined") {
			return { status: "declined", channel: channelName, recordId: outcome.record.id };
		}
		if (outcome.status !== "authorized") {
			// `deferred` (agora não) and `no-operator` both mean: nothing written, nothing recorded.
			return { status: "deferred", channel: channelName };
		}

		// ── 8. The secret, after the yes and only after it ────────────────────────
		if (tokenValue !== null) {
			const writer = deps.tokenWriter ?? createNodeDeliveryTokenWriter();
			try {
				await writer.write(tokenAbsolute, tokenValue);
			} catch (error) {
				// A declaration pointing at a token that was never written is worse than no
				// declaration: it looks configured and is not. Put the config back through the
				// trail's own undo, so the reversal is recorded rather than silent.
				await undoOperationRecord({
					record: outcome.record,
					trail,
					...(deps.fs ? { fs: deps.fs } : {}),
					...(deps.now ? { now: deps.now } : {}),
				});
				throw new DeliveryAddRefusal(
					"delivery-add-token-write-failed",
					`Could not write the token file at ${tokenAbsolute} ` +
						`(${error instanceof Error ? error.message : String(error)}). ` +
						"The declaration was rolled back — nothing is half-written.",
					[DELIVERY_LIST_COMMAND],
				);
			}
		}

		// ── 9. Verify, do not claim ───────────────────────────────────────────────
		return {
			status: "declared",
			channel: channelName,
			adapter: factory.id,
			capability,
			unattended,
			configPath: plan.configPath,
			tokenFile: tokenFile === null ? null : path.join(root, tokenFile),
			tokenEnv,
			recordId: outcome.record.id,
			undoCommand: undoCommandFor(outcome.record.id),
			route: probeRoute(root, channelName),
			replaced: plan.replaced,
		};
	} catch (error) {
		if (error instanceof OperatorPromptCancelledError) {
			// Cancellation settles: nothing was applied and nothing recorded, because the consent
			// journey writes only after an answer and every write above happens after that.
			return { status: "cancelled", channel: channelName };
		}
		throw error;
	}
}

// ── The separate, separately-authorised test send ─────────────────────────────

export interface DeliveryTestResult {
	channel: string;
	sent: boolean;
	outcomes: Array<{ adapter: string; status: string; detail: string | null }>;
}

export interface DeliveryTestDeps {
	root?: string;
	interactive?: boolean;
	operator?: OperatorChannel;
	now?: () => number;
	announce?: (line: string) => void;
}

/**
 * `refarm delivery test <name>` — the one thing `add` deliberately does NOT do.
 *
 * A real message leaves the machine here, so it is a SEPARATE command with its OWN authorisation.
 * Bundling it into the wizard is how a small yes ("declare this channel") becomes a large one
 * ("and talk to a third party on my behalf"), and the operator would have authorised the second
 * without ever being asked it.
 */
export async function runDeliveryTest(
	channelName: string,
	deps: DeliveryTestDeps = {},
): Promise<DeliveryTestResult> {
	const root = deps.root ?? process.cwd();
	const { channels } = loadDeclaredDelivery({ root });
	const channel: ResolvedDeliveryChannel | undefined = channels.find(
		(entry) => entry.declaration.name === channelName,
	);
	if (!channel) {
		throw new DeliveryAddRefusal(
			"delivery-test-unknown-channel",
			`No usable delivery channel named "${channelName}" is declared here.`,
			[DELIVERY_LIST_COMMAND],
		);
	}

	const interactive = deps.interactive ?? Boolean(process.stdin.isTTY && process.stdout.isTTY);
	if (!interactive) {
		throw new DeliveryAddRefusal(
			"delivery-test-not-interactive",
			"A real message would leave this machine, and there is no terminal to authorise it at. " +
				"Run this from an interactive shell.",
			[DELIVERY_LIST_COMMAND],
		);
	}
	const operator = deps.operator ?? createStdioOperatorChannel();
	// Through the CHANNEL: a warning that stays on the node warns nobody who is
	// answering from a phone. `deps.announce` still overrides, for tests that read
	// lines directly.
	const say = (notice: string | OperatorNoticeInput): void => {
		if (deps.announce) {
			deps.announce(typeof notice === "string" ? notice : notice.message);
			return;
		}
		operator.say?.(notice);
	};

	// CAUTION: the next answer has an outward, irreversible effect. Sibling of
	// `answerTravels` on the prompt side — the doctrine that a surface must say so
	// BEFORE the operator commits, not after.
	say({
		kind: "caution",
		message: `Isto envia uma mensagem REAL por "${channelName}" agora — sai desta máquina e chega no seu aparelho.`,
	});
	const go = await operator.ask({
		type: "confirm",
		question: `Envio a mensagem de teste por "${channelName}"?`,
		default: false,
	});
	if (!go) return { channel: channelName, sent: false, outcomes: [] };

	const request: DeliveryRequest = {
		promptId: "(delivery-test)",
		question: "refarm: teste de entrega. Se você está lendo isto, o canal funciona.",
		asker: refarmCommand(["delivery", "test"]),
		needsDecision: false,
		answerTravels: false,
		expiresAt: null,
	};
	const plan = routeDelivery({ request, channels: [channel], attending: true });
	const outcomes = await deliver({
		plan,
		request,
		// Announce-only by construction (`needsDecision: false`), so nothing can settle anything.
		sink: { answer: () => false },
		...(deps.now ? { now: deps.now } : {}),
	});
	return {
		channel: channelName,
		sent: true,
		outcomes: outcomes.map((outcome) => ({
			adapter: outcome.adapter,
			status: outcome.status,
			detail: outcome.detail ?? null,
		})),
	};
}
