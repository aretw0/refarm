/**
 * Declared delivery — being reached, on whatever the operator actually carries.
 *
 * Design: `docs/superpowers/specs/2026-07-31-declared-delivery-design.md`.
 * Pairs with the pending-prompt wire (`@refarm.dev/prompt-contract-v1`), whose
 * prompts are what delivery announces.
 *
 * This block is the SEAM (D2): the vocabulary an adapter declares, the routing
 * rules refarm enforces on that declaration, and the three outcomes a delivery
 * can have. It is deliberately pure and dependency-free —
 *   - a third-party adapter package imports THIS, never refarm's core;
 *   - every rule below is a total function over plain data, so the refusals can
 *     be tested without a transport, a config file, or a network.
 *
 * It also never touches a secret. A declaration NAMES where a token comes from
 * (`tokenFile` / `tokenEnv`); resolution happens at use, in the core, and the
 * catalog parser REFUSES a declaration that tries to carry one inline.
 */

// ── D3 — the capability vocabulary ────────────────────────────────────────────

/**
 * What an adapter can do with a question.
 *
 * - `announce` — "there is a question waiting, go look". Real information, and
 *   the only honest claim for an email, a webhook, or a toast with no actions.
 * - `answer` — the decision can come BACK through this channel: a Termux action
 *   button, a Telegram inline keyboard.
 *
 * `answer` strictly implies `announce`: you cannot carry a decision through a
 * channel that cannot raise the question in the first place. One value rather
 * than a set, because that is the whole of the distinction — converge the
 * vocabulary, do not build a configuration language (D5).
 */
export type DeliveryCapability = "announce" | "answer";

/**
 * What a route ACTUALLY carried, which is finer than what a channel is declared able to carry.
 *
 * Declared on the outcome as well as on the route because the outcome is the record an operator
 * reads hours later: "answer" and "text-answer" are different events — one carried a decision
 * among choices, the other carried a value — and collapsing them would lose which happened.
 */
export type DeliveryRouteMode = DeliveryCapability | "text-answer";

const DELIVERY_CAPABILITIES: readonly DeliveryCapability[] = ["announce", "answer"];

/** True when `held` satisfies a requirement for `needed`. `answer` ⊇ `announce`. */
export function capabilitySatisfies(
	held: DeliveryCapability,
	needed: DeliveryCapability,
): boolean {
	if (needed === "announce") return true;
	return held === "answer";
}

// ── D4 — a delivery that failed is not a delivery that was not needed ─────────

/**
 * Three outcomes, not two.
 *
 * - `delivered`        — the transport accepted it. The operator has been told.
 * - `refused`          — the transport was REACHED and said no (the bot is
 *                        blocked, the chat does not exist, the credential is
 *                        rejected). A verdict came back.
 * - `could-not-attempt`— no verdict ever came back: the secret would not
 *                        resolve, the network failed, the deadline passed, the
 *                        adapter threw. refarm does not know whether the
 *                        operator was told, and says so.
 *
 * Collapsing the last two is the failure this repo has hit repeatedly (`down`
 * vs `unknown`, no-peers vs could-not-ask, refused vs absent). "I asked and was
 * told no" and "I never got to ask" are different facts and an operator finding
 * a question hours later needs to know which one happened.
 */
export type DeliveryStatus = "delivered" | "refused" | "could-not-attempt";

/**
 * What one adapter did with one delivery.
 *
 * `detail` is operator-facing prose. It MUST NOT contain a credential, a URL
 * carrying one, or a prompt answer — this record is logged, serialised, and
 * shown. Adapters are responsible for scrubbing what they put here; the
 * `assertNoSecretInDetail` guard below is the last line of defence.
 */
export interface DeliveryOutcome {
	/** Registry id of the adapter that produced this. */
	adapter: string;
	status: DeliveryStatus;
	/** What was actually carried — an announcement, or an answerable offer. */
	mode: DeliveryRouteMode;
	/** Epoch ms. */
	at: number;
	/** Short, operator-facing, secret-free. */
	detail?: string;
}

/** Convenience constructors, so an adapter never hand-rolls the shape. */
export function delivered(
	adapter: string,
	mode: DeliveryRouteMode,
	at: number,
	detail?: string,
): DeliveryOutcome {
	return detail === undefined
		? { adapter, status: "delivered", mode, at }
		: { adapter, status: "delivered", mode, at, detail };
}

export function refused(
	adapter: string,
	mode: DeliveryRouteMode,
	at: number,
	detail: string,
): DeliveryOutcome {
	return { adapter, status: "refused", mode, at, detail };
}

export function couldNotAttempt(
	adapter: string,
	mode: DeliveryRouteMode,
	at: number,
	detail: string,
): DeliveryOutcome {
	return { adapter, status: "could-not-attempt", mode, at, detail };
}

/** True when refarm knows the operator was told. Only ONE status qualifies. */
export function deliveryReachedOperator(outcome: DeliveryOutcome): boolean {
	return outcome.status === "delivered";
}

// ── What an adapter is handed ─────────────────────────────────────────────────

/** One answerable choice, projected for a surface that renders buttons. */
export interface DeliveryChoice {
	value: string;
	label: string;
}

/**
 * A question, PROJECTED for delivery.
 *
 * Deliberately not the `OperatorPrompt` type itself: an adapter is a third
 * party, and handing it the live prompt object would let it reach further than
 * "say this, and maybe carry a decision back". It also keeps this block free of
 * a dependency on the prompt block, so an adapter package pulls in nothing.
 */
export interface DeliveryRequest {
	/** The pending prompt's id — how an answer finds its way home. */
	promptId: string;
	/** What the operator reads. */
	question: string;
	/** What asked, e.g. `refarm auth enrol`. Recognisable on a small screen. */
	asker: string;
	/**
	 * D3's discriminator: does settling this REQUIRE a decision from the
	 * operator? True for a pending prompt. False for a pure notice ("the VPN is
	 * up"), which any announce-only adapter may carry.
	 */
	needsDecision: boolean;
	/**
	 * What was STATED before this question and has not been carried yet (D9).
	 *
	 * A wizard's framing reaches a PUSH surface only by riding the question it
	 * frames: an adapter sends ONE message carrying both, rather than one message
	 * per sentence. Three preflight lines and a question are one Telegram message,
	 * not four — times every declared channel.
	 *
	 * DISTINCT from the standalone status notice `needsDecision` describes above
	 * ("the VPN is up"), which is its own genre with its own producer and answers
	 * nothing. This field is framing, and framing belongs to what it frames.
	 */
	framing?: readonly { readonly message: string; readonly kind: string }[];
	/** Offered values, when the decision is a choice. */
	choices?: readonly DeliveryChoice[];
	/**
	 * P4 — answering this puts the ANSWER on the wire. An adapter that would
	 * carry it through a third party must degrade to announcing instead.
	 */
	answerTravels: boolean;
	/** The asker's deadline, epoch ms, or null. */
	expiresAt: number | null;
}

/**
 * How an answer gets back. An adapter calls this and nothing else — it never
 * touches the hub, and it never sees any other prompt.
 *
 * Returns false when something else already settled the prompt (the operator
 * answered at the terminal, another device won, the deadline passed). An
 * adapter must treat that as normal, not as an error.
 */
export interface DeliveryAnswerSink {
	answer(value: string | boolean): boolean;
}

// ── D2 — the adapter seam ─────────────────────────────────────────────────────

/**
 * A delivery adapter: one file, one registry line, and nothing else learns it
 * exists (the `identity-sources.ts` precedent).
 *
 * The two declarations an adapter makes about ITSELF are load-bearing and are
 * checked structurally, not taken on trust — see `refuseUnenforceableAdapter`.
 */
export interface DeliveryAdapter {
	/** Stable registry id. Matches the `adapter` key of a declaration. */
	readonly id: string;
	/** D3 — the MOST this adapter can do. */
	readonly capability: DeliveryCapability;
	/**
	 * D8 — does it deliver when nobody is attending?
	 *
	 * `true` for a channel that survives the phone being in a pocket (a push
	 * service that has already won the argument with Android's doze). `false`
	 * for one that only works while the operator is deliberately looking — which
	 * is honest and useful, and is exactly the attended mode `refarm intention
	 * arm` declares.
	 */
	readonly unattended: boolean;
	/** Raise the question. Every adapter can do this. */
	announce(request: DeliveryRequest): Promise<DeliveryOutcome>;
	/**
	 * Raise the question AND carry a decision back. Present only on an
	 * answer-capable adapter — its absence is what makes `capability: "answer"`
	 * unfakeable.
	 */
	offerAnswer?(request: DeliveryRequest, sink: DeliveryAnswerSink): Promise<DeliveryOutcome>;
	/**
	 * IS THIS CHANNEL REACHABLE, AND AS WHOM — asked without sending anything a human receives.
	 *
	 * MEASURED 2026-08-27: the operator asked whether he had a Telegram bot configured and no
	 * refarm surface could answer. `delivery list` reported `declared: true`, which is a fact
	 * about a FILE — a declaration exists and a token path resolves. What actually answered was
	 * a hand-written `getMe` outside refarm.
	 *
	 * THE INVERSE IS THE DANGEROUS CASE. A revoked token, a deleted bot, a rotated secret: the
	 * declaration still reads `true`, routing still reports the channel answerable, and the first
	 * anyone learns otherwise is a consent question that never arrives. For a node whose whole
	 * consent model routes decisions through delivery, "declared" standing in for "works" is a
	 * claim wearing a measurement's clothes.
	 *
	 * OPTIONAL BY DESIGN, so an adapter that cannot probe says so by ABSENCE — the device
	 * `OperationTrail.readQuestions?` already uses, where a trail that cannot remember a question
	 * says so by not implementing the method. A surface then reports three states and never
	 * collapses the first two: declared-but-unprobed, reachable-as-X, unreachable-because-Y.
	 *
	 * IT MUST NOT DELIVER. `refarm delivery test` is the thing that sends, and it asks first,
	 * every time. A control plane cannot buzz the operator's phone to find out whether it can
	 * buzz the operator's phone.
	 */
	probe?(): Promise<DeliveryProbe>;
	/**
	 * WHERE THIS TRANSPORT CAN LAND — the chats, groups and lists it has seen.
	 *
	 * A credential says WHO a channel speaks as; a destination says WHERE it lands. One bot
	 * addresses many chats, which is the platform's own model rather than a workaround, so a
	 * workspace that wants its own channel declares a DESTINATION and never a second credential
	 * (`docs/superpowers/specs/2026-08-28-one-bot-many-destinations-design.md`). Declaring one
	 * requires being able to see what exists.
	 *
	 * OPTIONAL, like `probe`: a transport with no notion of enumerable destinations says so by
	 * absence rather than by returning an empty list that reads as "none found".
	 *
	 * IT RETURNS, IT DOES NOT STORE. Where topology lives is the caller's decision — it carries
	 * real chat ids, so whether it is machine-local or in a synced tree is not a transport's to
	 * make. `@refarm.dev/contacts` is the store; this is the read.
	 */
	discoverDestinations?(): Promise<DeliveryDestination[]>;
	/**
	 * Carry a question that needs a VALUE rather than a choice, and bring the value back.
	 *
	 * WHY IT IS SEPARATE FROM `offerAnswer`. That one carries a decision among choices — buttons,
	 * on every transport that has them — and its absence is what makes `capability: "answer"`
	 * unfakeable. A value has no choices to render, so a transport can be perfectly able to offer
	 * buttons and unable to accept free text. Two methods, two abilities, each proven by presence.
	 *
	 * WHAT IT UNLOCKS, measured 2026-08-28: `refarm sow` asks "paste the redirect URL" through the
	 * operator channel, which is already delivery-attached — but a choice-less question routed as
	 * `announce`, so the operator saw it on his phone and had nowhere to answer. An OAuth
	 * re-authentication was therefore completable from anywhere EXCEPT the surface he was holding.
	 *
	 * THE ANSWER MUST BE BOUND TO THE QUESTION. A transport that captured the next message in a
	 * chat would turn any unrelated line — or anyone else in a group — into the answer to a
	 * pending question. An implementation must tie the reply to the message it answers.
	 */
	offerTextAnswer?(request: DeliveryRequest, sink: DeliveryAnswerSink): Promise<DeliveryOutcome>;
}

/**
 * One place a channel can send to, in the platform's own vocabulary.
 *
 * `id` is what the transport addresses; everything else is for a human choosing between them on
 * a small screen.
 */
export interface DeliveryDestination {
	readonly platform: string;
	readonly id: string;
	readonly name?: string;
	/** The platform's own kind — private, group, channel, supergroup. Not normalised: a
	 *  vocabulary invented here would hide the distinctions each platform actually makes. */
	readonly type?: string;
	readonly handle?: string | null;
}

/**
 * What a channel answers about itself.
 *
 * `identity` is the half that makes this more than a ping: it says WHO the channel speaks as. An
 * operator running one bot across several workspaces needs to see that the workspace channel is
 * the bot he thinks it is, and a node that has silently been rotated onto another identity looks
 * identical to a healthy one without it.
 */
export interface DeliveryProbe {
	readonly reachable: boolean;
	/** How the far side names this channel — a bot username, an account handle. */
	readonly identity?: string;
	/** Why it is not reachable. Present only when `reachable` is false. */
	readonly reason?: string;
}

/**
 * What an adapter package needs to build one instance of itself from one
 * declaration.
 *
 * `resolveToken` is a THUNK, not a value: the core resolves the declared secret
 * at the moment of use and the adapter never receives it early, never stores
 * it, and never sees where it came from. That is what keeps "a declaration
 * names where a secret comes from" true all the way down.
 */
export interface DeliveryAdapterContext {
	declaration: DeliveryDeclaration;
	resolveToken(): Promise<string>;
}

/**
 * The registry entry (D2). An adapter package exports ONE of these, and the
 * core's registry is one import and one array element — the `identity-sources.ts`
 * precedent, which is the whole measure of whether this seam succeeded.
 *
 * `create` may throw `DeliveryDeclarationError` for a declaration it cannot
 * serve (a missing chat id, an unparseable option). Refusing at resolution is
 * the point: an adapter that half-builds itself fails at 3am instead.
 */
export interface DeliveryAdapterFactory {
	readonly id: string;
	create(context: DeliveryAdapterContext): DeliveryAdapter;
}

/**
 * S3, structurally: a thing may not declare a capability it cannot enforce.
 *
 * An adapter object claiming `capability: "answer"` without an `offerAnswer`
 * implementation is REFUSED at registration — before any prompt exists, before
 * any operator is waiting. The alternative is discovering the lie at 3am, when
 * a decision was routed to a channel that had nowhere to send it back from and
 * the wizard waits forever.
 */
export class DeliveryDeclarationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "DeliveryDeclarationError";
	}
}

export function refuseUnenforceableAdapter(adapter: DeliveryAdapter): void {
	if (!DELIVERY_CAPABILITIES.includes(adapter.capability)) {
		throw new DeliveryDeclarationError(
			`delivery adapter "${adapter.id}": capability must be "announce" or "answer"`,
		);
	}
	if (typeof adapter.announce !== "function") {
		throw new DeliveryDeclarationError(
			`delivery adapter "${adapter.id}": every adapter must implement announce()`,
		);
	}
	if (adapter.capability === "answer" && typeof adapter.offerAnswer !== "function") {
		throw new DeliveryDeclarationError(
			`delivery adapter "${adapter.id}": declares capability "answer" but implements no offerAnswer() — ` +
				`an adapter may not declare a capability it cannot enforce`,
		);
	}
	if (typeof adapter.unattended !== "boolean") {
		throw new DeliveryDeclarationError(
			`delivery adapter "${adapter.id}": must declare unattended as a boolean`,
		);
	}
}

// ── D1 — the declared catalog: silence is closed ──────────────────────────────

/**
 * Keys a declaration owns. Everything else is the adapter's own options —
 * which is what lets a new adapter add configuration without this parser
 * learning anything about it.
 */
const RESERVED_DECLARATION_KEYS: readonly string[] = ["adapter", "capability", "unattended"];

/**
 * A declaration NAMES where a secret comes from; it never contains one.
 *
 * `.refarm/config.json` is world-readable, lands in `git status`, is printed by
 * diagnostics, and is merged from several sources. A bot token in it is a bot
 * token in all of those. So the catalog refuses these keys outright rather than
 * trusting an operator to know better — the same posture as
 * `REFARM_AUTH_POLICY`, which carries a PATH and never contents.
 */
const INLINE_SECRET_KEYS: readonly string[] = [
	"token",
	"botToken",
	"bot_token",
	"secret",
	"apiKey",
	"api_key",
	"password",
	"credential",
	"credentials",
];

/** How a declaration names its secret. Resolution happens at use, in the core. */
export type DeclaredTokenRef =
	| { kind: "file"; path: string }
	| { kind: "env"; name: string };

/** One declared delivery channel, as the operator wrote it. */
export interface DeliveryDeclaration {
	/** Catalog key — how the operator refers to this channel. */
	readonly name: string;
	/** Registry id of the adapter that serves it. Defaults to `name`. */
	readonly adapter: string;
	/** D3 — what the operator is claiming this channel can do. */
	readonly capability: DeliveryCapability;
	/** D8 — whether it should be used when nobody is attending. */
	readonly unattended: boolean;
	/** Adapter-owned settings. Secret-free by construction (see above). */
	readonly options: Readonly<Record<string, unknown>>;
}

export type DeliveryCatalog = ReadonlyMap<string, DeliveryDeclaration>;

/**
 * Ceiling on declared channels. Not a limit anyone will reach — a bound, so a
 * malformed or hostile config cannot make refarm fan out unboundedly on every
 * single prompt.
 */
export const MAX_DELIVERY_CHANNELS = 8;

const MAX_DELIVERY_NAME_LEN = 64;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Parse the `delivery` block of `.refarm/config.json`.
 *
 * FAIL-SHUT, on the `parseSurfaces` model: an ABSENT block is the closed
 * default (D1 — an undeclared adapter does not exist, and refarm does not go
 * looking for one), while a block that is PRESENT and malformed throws. The
 * operator asked for something; delivering a silently-different thing is how a
 * question ends up somewhere they are not.
 *
 * Silence here is not "no notifications configured yet" — it is the operator's
 * consent to be interrupted, absent. Detection never substitutes for it.
 */
export function parseDeliveryCatalog(config: unknown): DeliveryCatalog {
	const catalog = new Map<string, DeliveryDeclaration>();
	if (!isRecord(config)) return catalog;
	const block = config.delivery;
	if (block === undefined || block === null) return catalog;
	if (!isRecord(block)) {
		throw new DeliveryDeclarationError(
			`delivery: expected an object of declared channels, got ${Array.isArray(block) ? "an array" : typeof block}`,
		);
	}

	const names = Object.keys(block);
	if (names.length > MAX_DELIVERY_CHANNELS) {
		throw new DeliveryDeclarationError(
			`delivery: ${names.length} channels declared, at most ${MAX_DELIVERY_CHANNELS} are allowed`,
		);
	}

	for (const name of names) {
		catalog.set(name, parseOneDeclaration(name, block[name]));
	}
	return catalog;
}

function parseOneDeclaration(name: string, raw: unknown): DeliveryDeclaration {
	if (!name.trim()) {
		throw new DeliveryDeclarationError("delivery: a channel name must not be blank");
	}
	if (name.length > MAX_DELIVERY_NAME_LEN) {
		throw new DeliveryDeclarationError(
			`delivery."${name.slice(0, MAX_DELIVERY_NAME_LEN)}…": channel name is longer than ${MAX_DELIVERY_NAME_LEN} characters`,
		);
	}
	if (!isRecord(raw)) {
		throw new DeliveryDeclarationError(
			`delivery."${name}": expected an object, got ${Array.isArray(raw) ? "an array" : typeof raw}`,
		);
	}

	for (const key of INLINE_SECRET_KEYS) {
		if (key in raw) {
			throw new DeliveryDeclarationError(
				`delivery."${name}": "${key}" must not appear in the declaration — a declaration names where a ` +
					`secret comes from, it never contains one. Use "tokenFile" (a path) or "tokenEnv" (a variable name).`,
			);
		}
	}

	const adapterRaw = raw.adapter === undefined ? name : raw.adapter;
	if (typeof adapterRaw !== "string" || !adapterRaw.trim()) {
		throw new DeliveryDeclarationError(
			`delivery."${name}": "adapter" must be a non-empty string naming a registered adapter`,
		);
	}

	const capability = raw.capability;
	if (capability !== "announce" && capability !== "answer") {
		throw new DeliveryDeclarationError(
			`delivery."${name}": "capability" must be "announce" or "answer" (got ${JSON.stringify(capability)})`,
		);
	}

	const unattended = raw.unattended;
	if (typeof unattended !== "boolean") {
		throw new DeliveryDeclarationError(
			`delivery."${name}": "unattended" must be declared as true or false — whether this channel ` +
				`reaches you when you are not attending is not something refarm may guess`,
		);
	}

	const options: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(raw)) {
		if (RESERVED_DECLARATION_KEYS.includes(key)) continue;
		options[key] = value;
	}

	return {
		name,
		adapter: adapterRaw.trim(),
		capability,
		unattended,
		options: Object.freeze(options),
	};
}

/**
 * S3 at the CATALOG boundary: the operator may not declare, for a channel, a
 * capability its adapter does not have.
 *
 * Declaring `capability: "answer"` over an announce-only adapter is exactly the
 * failure D3 exists to prevent — refarm would believe it could get a decision
 * back from a channel that can only say things out loud, and the wizard would
 * wait forever for a reply with nowhere to come from. Caught at resolution,
 * loudly, rather than at 3am, silently.
 */
export function refuseOverclaimedDeclaration(
	declaration: DeliveryDeclaration,
	adapter: DeliveryAdapter,
): void {
	if (!capabilitySatisfies(adapter.capability, declaration.capability)) {
		throw new DeliveryDeclarationError(
			`delivery."${declaration.name}": declares capability "${declaration.capability}" but adapter ` +
				`"${adapter.id}" can only "${adapter.capability}" — a thing may not declare a capability it cannot enforce`,
		);
	}
	if (declaration.unattended && !adapter.unattended) {
		throw new DeliveryDeclarationError(
			`delivery."${declaration.name}": declares unattended delivery but adapter "${adapter.id}" only ` +
				`reaches you while you are attending — a thing may not declare a capability it cannot enforce`,
		);
	}
}

/**
 * Read a declaration's secret REFERENCE. Exactly one of `tokenFile` (a path) or
 * `tokenEnv` (a variable name) — never both, never neither, and never a value.
 *
 * Returns the reference only. Nothing here opens a file or reads an
 * environment: this block is pure, and resolving the secret is the core's job,
 * at the moment of use.
 */
export function parseDeclaredTokenRef(declaration: DeliveryDeclaration): DeclaredTokenRef {
	const { tokenFile, tokenEnv } = declaration.options as {
		tokenFile?: unknown;
		tokenEnv?: unknown;
	};
	const hasFile = tokenFile !== undefined;
	const hasEnv = tokenEnv !== undefined;

	if (hasFile && hasEnv) {
		throw new DeliveryDeclarationError(
			`delivery."${declaration.name}": declare exactly one of "tokenFile" or "tokenEnv", not both`,
		);
	}
	if (!hasFile && !hasEnv) {
		throw new DeliveryDeclarationError(
			`delivery."${declaration.name}": needs a secret and none is named — declare "tokenFile" (a path ` +
				`to a file holding the token) or "tokenEnv" (the name of an environment variable)`,
		);
	}
	if (hasFile) {
		if (typeof tokenFile !== "string" || !tokenFile.trim()) {
			throw new DeliveryDeclarationError(
				`delivery."${declaration.name}": "tokenFile" must be a non-empty path`,
			);
		}
		return { kind: "file", path: tokenFile.trim() };
	}
	if (typeof tokenEnv !== "string" || !tokenEnv.trim()) {
		throw new DeliveryDeclarationError(
			`delivery."${declaration.name}": "tokenEnv" must be a non-empty variable name`,
		);
	}
	return { kind: "env", name: tokenEnv.trim() };
}

// ── D3 + D8 — routing ─────────────────────────────────────────────────────────

/** Why a declared channel was not used for this delivery. */
export type DeliveryRefusalReason =
	/** D3 — the prompt needs a decision and this channel can only announce. */
	| "announce-only"
	/** D8 — nobody is attending and this channel only works when somebody is. */
	| "attended-only"
	/** P4 — the answer would travel, and this channel is not a place to send it. */
	| "answer-would-travel"
	/** The decision is free text, which a notification channel cannot collect. */
	| "needs-free-text";

export interface DeliveryRefusal {
	adapter: string;
	channel: string;
	reason: DeliveryRefusalReason;
	detail: string;
}

/** One channel that WILL be used, and in which mode. */
export interface DeliveryRoute {
	channel: string;
	adapter: DeliveryAdapter;
	declaration: DeliveryDeclaration;
	/** What this channel will actually carry. Never exceeds its capability. */
	mode: DeliveryRouteMode;
}

export interface DeliveryPlan {
	routes: readonly DeliveryRoute[];
	refusals: readonly DeliveryRefusal[];
	/**
	 * True when at least one route can carry a decision BACK. False for a
	 * decision-needing prompt whose every declared channel can only announce —
	 * which is not an error (go look at the terminal), but is a fact the
	 * operator record must carry.
	 */
	answerable: boolean;
}

/** A channel that survived resolution: a declaration bound to its adapter. */
export interface ResolvedDeliveryChannel {
	declaration: DeliveryDeclaration;
	adapter: DeliveryAdapter;
}

export interface RouteDeliveryInput {
	request: DeliveryRequest;
	channels: readonly ResolvedDeliveryChannel[];
	/**
	 * D8 — is the operator attending RIGHT NOW? Read from the attention window
	 * the operator already declares with `refarm intention arm`, so routing
	 * consults a declaration they already make rather than asking them to pick
	 * an adapter per prompt.
	 */
	attending: boolean;
}

/**
 * Decide which declared channels carry this delivery, and in which mode.
 *
 * TOTAL and PURE: no I/O, no throwing, no adapter invoked. Every exclusion
 * produces a `DeliveryRefusal` rather than a silent drop, because "this channel
 * was not used" is information an operator finding a stale question needs.
 *
 * The two gates, in order:
 *
 *  1. D8 (attendance). Not attending ⇒ only a channel declared `unattended`
 *     will do; one that only works while the operator is looking would deliver
 *     into an empty room. Attending ⇒ every channel is eligible, including the
 *     fully-sovereign device-side ones, which is the whole point of the
 *     attended mode.
 *
 *  2. D3 (capability). A prompt needing a decision is NEVER routed in `answer`
 *     mode to an announce-only channel. It may still be ANNOUNCED there —
 *     "there is a question waiting, go look" is real information — but the
 *     refusal is recorded so the channel is labelled as what it is.
 */
export function routeDelivery(input: RouteDeliveryInput): DeliveryPlan {
	const routes: DeliveryRoute[] = [];
	const refusals: DeliveryRefusal[] = [];

	for (const channel of input.channels) {
		const { declaration, adapter } = channel;

		// Gate 1 — D8. The operator's attention window decides, not a per-prompt choice.
		if (!input.attending && !declaration.unattended) {
			refusals.push({
				adapter: adapter.id,
				channel: declaration.name,
				reason: "attended-only",
				detail:
					`"${declaration.name}" only reaches you while you are attending, and no attention window is armed`,
			});
			continue;
		}

		// Gate 2 — D3. What may this channel carry?
		const mode = resolveDeliveryMode(input.request, declaration, adapter);

		if (input.request.needsDecision && mode === "announce") {
			refusals.push({
				adapter: adapter.id,
				channel: declaration.name,
				...explainDegradedToAnnounce(input.request, declaration),
			});
		}

		routes.push({ channel: declaration.name, adapter, declaration, mode });
	}

	return {
		routes,
		refusals,
		answerable: routes.some((route) => routeCarriesAnAnswer(route.mode)),
	};
}

/**
 * Say WHY a decision-needing request degraded to an announcement on this
 * channel. Every degradation gets a distinct reason, because "your channel
 * cannot do this" and "this particular question cannot be asked this way" are
 * different facts and lead the operator to different fixes.
 */
function explainDegradedToAnnounce(
	request: DeliveryRequest,
	declaration: DeliveryDeclaration,
): { reason: DeliveryRefusalReason; detail: string } {
	if (declaration.capability !== "answer") {
		return {
			reason: "announce-only",
			detail: `"${declaration.name}" can only announce, so it cannot carry this decision back`,
		};
	}
	if (request.answerTravels) {
		return {
			reason: "answer-would-travel",
			detail: `"${declaration.name}" will announce only: this answer would travel and must not cross this channel`,
		};
	}
	return {
		reason: "needs-free-text",
		detail: `"${declaration.name}" can carry a choice but not free text, so this one must be answered elsewhere`,
	};
}

/**
 * What ONE channel may carry for ONE request. The decision D3 turns on, isolated
 * so it can be read and tested on its own.
 *
 * A secret answer (P4) degrades to `announce` even on an answer-capable
 * channel: sending the value through a delivery transport is a different act
 * from answering inside the tailnet, and the operator declared a notification
 * channel, not a place to type passwords.
 *
 * A decision with no enumerable choices degrades too. A notification channel
 * carries a CHOICE — an action button, an inline keyboard — not a text field;
 * collecting free text needs a conversation, which is a different capability
 * from being reached. This is not a Telegram limit leaking into the contract:
 * Termux action buttons have exactly the same shape, and an adapter that
 * pretended otherwise would hang a wizard on an answer that can never arrive.
 */
/**
 * Does this mode bring something BACK?
 *
 * DERIVED FROM THE MODE, not compared against one literal. `answerable` read
 * `mode === "answer"` and stayed silently false the day `text-answer` was added: the routing was
 * correct, the plan said `text-answer`, and the surface reporting whether an operator could reply
 * had been left behind — the tenth time this week a correct model and a correct consumer were
 * separated by a hand-written projection.
 *
 * Exhaustive by construction: a mode added to `DeliveryRouteMode` stops this compiling until it
 * is classified.
 */
export function routeCarriesAnAnswer(mode: DeliveryRouteMode): boolean {
	switch (mode) {
		case "answer":
		case "text-answer":
			return true;
		case "announce":
			return false;
	}
}

export function resolveDeliveryMode(
	request: DeliveryRequest,
	declaration: DeliveryDeclaration,
	/**
	 * The adapter this route would use. OPTIONAL so every existing caller keeps its meaning:
	 * without it a choice-less question is announce-only, which is what this function has always
	 * answered. With it, a transport that can accept a VALUE gets to say so.
	 */
	adapter?: Pick<DeliveryAdapter, "offerTextAnswer">,
): DeliveryRouteMode {
	if (!request.needsDecision) return "announce";
	if (declaration.capability !== "answer") return "announce";
	if (request.answerTravels) return "announce";
	if (!request.choices || request.choices.length === 0) {
		// A QUESTION WITH NO CHOICES WANTS A VALUE. It was announce-only for as long as answers
		// travelled as buttons, which left `refarm sow`'s "paste the redirect URL" visible on a
		// phone and answerable only at a keyboard. A transport that implements `offerTextAnswer`
		// can carry it; one that does not still cannot, and says so by absence.
		return adapter?.offerTextAnswer ? "text-answer" : "announce";
	}
	return "answer";
}

/**
 * The hard refusal (D3), at the last possible moment — the point where an
 * adapter is about to be handed a decision to carry.
 *
 * `routeDelivery` already refuses to build such a route, so reaching this is a
 * bug. It throws anyway: the cost of the bug is a prompt that waits forever for
 * a reply from a channel that cannot send one, and a loud failure at the seam
 * is cheaper than that every time.
 */
export function refuseAnswerRouteToAnnounceOnly(route: DeliveryRoute): void {
	if (route.mode !== "answer") return;
	if (route.declaration.capability !== "answer") {
		throw new DeliveryDeclarationError(
			`delivery."${route.channel}": refusing to route a decision to a channel declared "announce"`,
		);
	}
	if (typeof route.adapter.offerAnswer !== "function") {
		throw new DeliveryDeclarationError(
			`delivery."${route.channel}": refusing to route a decision to adapter "${route.adapter.id}", ` +
				`which implements no offerAnswer()`,
		);
	}
}

// ── Carrying it out ───────────────────────────────────────────────────────────

export interface DeliverInput {
	plan: DeliveryPlan;
	request: DeliveryRequest;
	sink: DeliveryAnswerSink;
	now?: () => number;
}

/**
 * Run a plan. Returns one outcome PER ROUTE, always — a channel that was
 * planned and produced nothing is the silent failure D4 exists to abolish.
 *
 * An adapter that throws, hangs past its own bounds, or returns something that
 * is not an outcome yields `could-not-attempt`: refarm genuinely does not know
 * whether the operator was told, and inventing either of the other two answers
 * would be a lie. One adapter's failure never prevents another's delivery.
 */
export async function deliver(input: DeliverInput): Promise<DeliveryOutcome[]> {
	const now = input.now ?? (() => Date.now());
	const results = await Promise.all(
		input.plan.routes.map(async (route): Promise<DeliveryOutcome> => {
			try {
				refuseAnswerRouteToAnnounceOnly(route);
				const outcome =
					route.mode === "answer"
						? // Non-null asserted by refuseAnswerRouteToAnnounceOnly above.
							await route.adapter.offerAnswer!(input.request, input.sink)
						: route.mode === "text-answer"
							? // Only routed when the adapter has it — `resolveDeliveryMode` checked.
								await route.adapter.offerTextAnswer!(input.request, input.sink)
							: await route.adapter.announce(input.request);
				return normaliseOutcome(outcome, route, now());
			} catch (error) {
				return couldNotAttempt(
					route.adapter.id,
					route.mode,
					now(),
					`adapter failed before reporting an outcome: ${errorSummary(error)}`,
				);
			}
		}),
	);
	return results;
}

function errorSummary(error: unknown): string {
	if (error instanceof Error) return error.message;
	return typeof error === "string" ? error : "unknown error";
}

/**
 * Trust an adapter's outcome only as far as it is well-formed. A missing or
 * unrecognised status becomes `could-not-attempt` rather than being read as
 * success — an adapter that cannot say what happened has not told us the
 * operator was reached.
 */
function normaliseOutcome(
	outcome: DeliveryOutcome | undefined,
	route: DeliveryRoute,
	at: number,
): DeliveryOutcome {
	if (
		!outcome ||
		(outcome.status !== "delivered" &&
			outcome.status !== "refused" &&
			outcome.status !== "could-not-attempt")
	) {
		return couldNotAttempt(
			route.adapter.id,
			route.mode,
			at,
			"adapter returned no recognisable delivery outcome",
		);
	}
	return { ...outcome, adapter: route.adapter.id, mode: route.mode };
}

// ── The record an operator reads hours later (D4) ─────────────────────────────

/**
 * Everything that happened when refarm tried to reach the operator about ONE
 * prompt. Carries no answer and no secret — it is designed to be safe to log,
 * serialise and display, which is the only way it survives to be read later.
 */
export interface DeliveryRecord {
	promptId: string;
	/** Epoch ms of the attempt. */
	at: number;
	outcomes: readonly DeliveryOutcome[];
	refusals: readonly DeliveryRefusal[];
	/** True when at least one channel reported `delivered`. */
	reached: boolean;
	/** True when at least one DELIVERED channel could carry a decision back. */
	answerable: boolean;
}

export function buildDeliveryRecord(
	promptId: string,
	at: number,
	plan: DeliveryPlan,
	outcomes: readonly DeliveryOutcome[],
): DeliveryRecord {
	return {
		promptId,
		at,
		outcomes,
		refusals: plan.refusals,
		reached: outcomes.some(deliveryReachedOperator),
		answerable: outcomes.some((o) => o.mode === "answer" && deliveryReachedOperator(o)),
	};
}

/**
 * One line an operator can read: did this question ever reach me?
 *
 * Names the three outcomes explicitly rather than collapsing them, and says
 * "nothing was declared" as its own case — an undeclared catalog is silence by
 * consent (D1), not a failure.
 */
export function describeDeliveryRecord(record: DeliveryRecord | null): string {
	if (!record) return "no delivery was attempted — no channel is declared";
	if (record.outcomes.length === 0) {
		const why = record.refusals.length > 0 ? record.refusals[0]!.detail : "no channel was eligible";
		return `not delivered — ${why}`;
	}
	const parts = record.outcomes.map((outcome) => {
		const suffix = outcome.detail ? ` (${outcome.detail})` : "";
		if (outcome.status === "delivered") {
			return `${outcome.adapter}: delivered${outcome.mode === "answer" ? ", answerable" : ", announce only"}${suffix}`;
		}
		if (outcome.status === "refused") return `${outcome.adapter}: refused by the transport${suffix}`;
		return `${outcome.adapter}: could not attempt${suffix}`;
	});
	return parts.join("; ");
}

// ── Secret hygiene ────────────────────────────────────────────────────────────

/**
 * Remove every occurrence of a secret from operator-facing text.
 *
 * The case this exists for is concrete: Telegram's API puts the bot token in
 * the URL PATH, so any error, log line or diagnostic that echoes a request URL
 * leaks the credential. An adapter runs everything it is about to emit through
 * this, and the emptiness of what comes out is testable.
 *
 * Short secrets are not scrubbed — replacing a 2-character string everywhere
 * would mangle unrelated text — so this is a backstop for real credentials, not
 * a licence to build strings out of them.
 */
export const MIN_SCRUBBABLE_SECRET_LEN = 8;

export function scrubSecret(text: string, secret: string | undefined | null): string {
	if (!secret || secret.length < MIN_SCRUBBABLE_SECRET_LEN) return text;
	return text.split(secret).join("[redacted]");
}

/**
 * Refuse to emit a detail that still contains the secret. The last line of
 * defence before an outcome is recorded, and a failure here is a bug in the
 * adapter, not something to paper over.
 */
export function assertNoSecretInDetail(detail: string, secret: string | undefined | null): string {
	if (secret && secret.length >= MIN_SCRUBBABLE_SECRET_LEN && detail.includes(secret)) {
		throw new DeliveryDeclarationError(
			"delivery: refusing to record a detail containing a credential",
		);
	}
	return detail;
}
