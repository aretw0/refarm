import {
	createPendingPromptHub,
	type OperatorNotice,
	type PendingPrompt,
	type PendingPromptAnswerResult,
	type PendingPromptHub,
	type PendingPromptSettlement,
	type PendingPromptTicket,
} from "@refarm.dev/prompt-contract-v1";

/**
 * THE JOIN — the CLI's questions, published to the hub the operator's devices poll.
 *
 * Two halves of the pending-prompt design were built and never connected. The node
 * has kept the hub since `packages/tractor/src/sidecar/pending_prompt.rs`: askers
 * `POST /prompts` and hold the request open, attending devices `GET /prompts` and
 * `POST /prompts/:id/answer`. Everything that ATTENDS reads that hub — the kit on
 * the operator's phone (`packages/farm-client/src/pending-prompt.mjs`), the `/attend`
 * page (`packages/attend-web-v1`), and the `refarm web serve` proxy that joins them.
 *
 * Nothing published to it. `delivery-mount.ts` installed a publisher backed by
 * `createPendingPromptHub()` — an in-process hub that dies with the CLI process — so
 * a wizard's question was offered to a hub with no readers while every reader
 * polled a hub with no publisher. Both sides passed their own tests.
 *
 * This module is the wire between them, and it is deliberately shaped as a
 * `PendingPromptHub` rather than as a new channel type: `createRemoteOperatorChannel`,
 * `createPeeredOperatorChannel` and `attachDeliveryToHub` are all already written
 * against that interface and already tested. Swapping what the hub IS changes where
 * the questions go without changing a line of how they are asked, raced or announced.
 *
 * ── HOW THE CLI AUTHENTICATES (it does not, and that is the design) ──────────────
 *
 * `POST /prompts` is DEVICE-ONLY: `auth::route_requirement` declares a scope for
 * `GET /prompts` and for the answer route, and publishing deliberately declares
 * none — "an asking process is not an answering device", so a browser session's
 * `prompt:answer` credential cannot publish questions.
 *
 * The CLI is not a remote device. It runs ON the node, and reaches the node over
 * loopback, which is UNGATED BY CONSTRUCTION: `node_local::gate_for` returns `None`
 * for a `ListenRole::NodeLocal` listener whatever gate is configured, so the
 * `127.0.0.1` socket is built with no auth middleware at all — there is no
 * authentication inside it to skip, and `route_requirement` is never consulted
 * there. The authority is positional (the packet arrived on the loopback socket,
 * therefore from this machine), not a token the node presents to itself.
 *
 * So no credential is invented here, and none is needed. `FARM_TOKEN` is forwarded
 * when the operator has set it ONLY because `REFARM_SIDECAR_URL` may point at a
 * non-loopback listener, which is gated and does want the device credential the
 * operator already enrolled — the same choke point `fetchSidecarWithTimeout`
 * documents. Absent or empty, no header is sent, and the loopback path is
 * byte-identical to having no credential at all.
 *
 * ── WHY NOT `fetchSidecarWithTimeout` ────────────────────────────────────────────
 *
 * Because this request is a LONG POLL. `POST /prompts` returns when the question is
 * settled, which is whenever the operator gets to it; the shared client exists to
 * put a 500ms ceiling on sidecar calls, and axum sends no headers until the handler
 * returns, so that ceiling would abort every publish before anybody could answer.
 * An open-ended request is what this route is, so it is spelled out here rather
 * than smuggled past a helper whose whole purpose is the opposite.
 */

/** The publish/list route on the node's sidecar. */
export const SIDECAR_PROMPTS_PATH = "/prompts";

/**
 * Where a STATEMENT goes (N1). Its own route, not a field on `/prompts`: framing
 * riding the question is a DELIVERY rule (D9), and making transport inherit it
 * would leave every future statement the node makes without a road.
 */
export const SIDECAR_NOTICES_PATH = "/notices";

/**
 * The longest the node will hold a publisher's request open —
 * `MAX_PROMPT_TIMEOUT_MS` in `pending_prompt.rs`, which CLAMPS anything larger.
 * Asking for exactly the ceiling is how a prompt with no deadline of its own buys
 * the longest single wait the surface offers.
 */
export const SIDECAR_MAX_PROMPT_TIMEOUT_MS = 60 * 60 * 1000;

/**
 * How long a publish must have been open before an `expired` answer is believed
 * enough to renew on.
 *
 * There is no "wait forever" on `POST /prompts` (P5), but a terminal prompt with no
 * deadline of its own must not acquire one just because it is also published — so
 * an expiry the ASKER did not ask for is renewed rather than settled. This floor is
 * what keeps that renewal from becoming a hot loop against a node that is answering
 * `expired` immediately for some reason nobody predicted: a renewal is only sane if
 * the wait it replaces actually waited.
 */
export const SIDECAR_PROMPT_RENEW_MIN_ELAPSED_MS = 30_000;

export interface SidecarPromptHubOptions {
	/** The node's sidecar base URL, e.g. `http://127.0.0.1:42001`. */
	baseUrl: string;
	/** Injected in tests. Defaults to the global `fetch`. */
	fetch?: typeof globalThis.fetch;
	env?: NodeJS.ProcessEnv;
	/** Where a degradation becomes visible. Never receives an answer value. */
	warn?: (message: string) => void;
	now?: () => number;
}

/** The publish body `post_prompts` deserializes. `timeoutMs` is camelCase there. */
interface PublishPromptRequestBody {
	prompt: PendingPrompt["prompt"];
	asker: PendingPrompt["asker"];
	timeoutMs: number;
}

/** What a settled `POST /prompts` returns. `value` only ever on `answered`. */
interface PublishPromptResponseBody {
	outcome?: unknown;
	device?: unknown;
	reason?: unknown;
	value?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function defaultWarn(message: string): void {
	process.stderr.write(`${message}\n`);
}

/**
 * A `PendingPromptHub` whose questions live on the node, not in this process.
 *
 * The local hub underneath is NOT a second hub in the sense the defect was about —
 * it holds no question the node does not also hold, and it is what makes three
 * things possible that an HTTP round trip cannot:
 *
 *   1. `publish` stays SYNCHRONOUS. The terminal peer must be offered the prompt
 *      instantly (P2: sitting at the desk stays the fastest path), so the round trip
 *      is started and not awaited. A publish that waited on the node would put the
 *      network between the operator and their own keyboard.
 *   2. `answer` stays SYNCHRONOUS, which is what `attachDeliveryToHub`'s sink
 *      requires — a Telegram button press settles the prompt here and the open
 *      publish is aborted, which is what withdraws the question from the node.
 *   3. the first-answer-wins compare-and-set stays in ONE place. Every path — the
 *      terminal, a device answering on the node, a delivery adapter — funnels
 *      through `createPendingPromptHub`'s `claim`, which is synchronous and already
 *      tested. The node runs the same rule for the devices it can see; this side
 *      runs it for the asker, and the asker's answer is whichever arrives first.
 */
export function createSidecarPromptHub(options: SidecarPromptHubOptions): PendingPromptHub {
	const local = createPendingPromptHub(options.now ? { now: options.now } : {});
	const now = options.now ?? (() => Date.now());
	const warn = options.warn ?? defaultWarn;
	const doFetch = options.fetch ?? ((...args: Parameters<typeof globalThis.fetch>) => globalThis.fetch(...args));
	const env = options.env ?? process.env;
	const base = options.baseUrl.replace(/\/+$/, "");
	const url = `${base}${SIDECAR_PROMPTS_PATH}`;

	// ONCE per mount, not once per question. A wizard asks eight questions; an
	// operator whose node is down needs to be told that, not told it eight times.
	let degraded = false;
	function degrade(detail: string): void {
		if (degraded) return;
		degraded = true;
		warn(
			`refarm: could not publish this question to the node at ${base} — ${detail}. ` +
				`It is answerable at this terminal only; attending devices will not see it.`,
		);
	}

	function headers(): Record<string, string> {
		const built: Record<string, string> = { "content-type": "application/json" };
		// See the module header: loopback needs nothing, a redirected non-loopback
		// sidecar is gated and wants the credential the operator already enrolled.
		const token = typeof env.FARM_TOKEN === "string" ? env.FARM_TOKEN.trim() : "";
		if (token) built.authorization = `Bearer ${token}`;
		return built;
	}

	// The tickets this hub handed out, so an expiry the NODE reported can settle the
	// asker that is waiting here. Entries are removed the moment they settle, so this
	// is bounded by the number of questions actually in flight.
	const tickets = new Map<string, PendingPromptTicket>();

	// ── The notice queue: ORDER IS THE WHOLE REASON IT EXISTS (N4) ───────────────
	//
	// `say()` is synchronous and cannot await, so three notices said in a row would
	// otherwise become three concurrent POSTs — and the node stamps `ordinal` ON
	// ARRIVAL. Under any jitter at all the operator's phone would show a wizard's
	// preflight shuffled, which reads as incoherence rather than as omission: worse
	// than the framing simply being absent, because the operator cannot tell that
	// anything went wrong.
	//
	// One promise chain, so each POST starts only after the previous one settled.
	// The chain never rejects — a link that throws is absorbed here so the NEXT
	// notice still goes; a broken notification arrangement must not be why a wizard
	// stops explaining itself, the same judgement `currentPromptPublisher` makes.
	let noticeQueue: Promise<void> = Promise.resolve();

	function enqueueNotice(notice: OperatorNotice): void {
		noticeQueue = noticeQueue.then(() => postNotice(notice));
	}

	async function postNotice(notice: OperatorNotice): Promise<void> {
		try {
			const response = await doFetch(`${base}${SIDECAR_NOTICES_PATH}`, {
				method: "POST",
				headers: headers(),
				body: JSON.stringify({
					asker: notice.asker,
					message: notice.message,
					kind: notice.kind,
				}),
			});
			if (!response.ok) {
				degradeNotices(`the node answered ${response.status}`);
			}
		} catch (error) {
			degradeNotices(error instanceof Error ? error.message : String(error));
		}
	}

	// Once per mount, like `degrade` above and for the same reason: an operator whose
	// node is down needs to hear it once, not once per sentence a wizard says.
	let noticesDegraded = false;
	function degradeNotices(detail: string): void {
		if (noticesDegraded) return;
		noticesDegraded = true;
		warn(
			`refarm: could not publish this wizard's framing to the node at ${base} — ${detail}. ` +
				`The questions still travel; attending devices will see them without the ` +
				`sentences that explain them.`,
		);
	}

	/**
	 * Hold one question open on the node until something settles it.
	 *
	 * TOTAL, and it never rejects: every failure here is a failure to REACH the
	 * other surfaces, and the prompt standing at the terminal must survive all of
	 * them. Leaving the local ticket unsettled on failure is the whole mechanism —
	 * `createPeeredOperatorChannel` keeps waiting on the local side whenever the
	 * remote one does not produce an answer, so an unreachable node degrades to
	 * exactly the terminal-only prompt the operator had before any of this.
	 */
	async function hold(pending: PendingPrompt, signal: AbortSignal): Promise<void> {
		for (;;) {
			// Recomputed each attempt: a renewed publish gets the deadline that is
			// LEFT, never the one the prompt started with.
			const remaining =
				pending.expiresAt === null
					? SIDECAR_MAX_PROMPT_TIMEOUT_MS
					: Math.max(1, pending.expiresAt - now());
			const body: PublishPromptRequestBody = {
				prompt: pending.prompt,
				asker: pending.asker,
				timeoutMs: Math.min(remaining, SIDECAR_MAX_PROMPT_TIMEOUT_MS),
			};
			const startedAt = now();

			let response: Response;
			try {
				response = await doFetch(url, {
					method: "POST",
					headers: headers(),
					body: JSON.stringify(body),
					signal,
				});
			} catch (error) {
				// An abort is US ending the question (the terminal answered, delivery
				// answered, the asker gave up). Dropping the request is precisely how
				// the node withdraws it — `PromptTicket`'s `Drop` — so it is the happy
				// path, not a failure to report.
				if (signal.aborted) return;
				degrade(error instanceof Error ? error.message : String(error));
				return;
			}

			if (signal.aborted) return;

			if (!response.ok) {
				// 429 too-many-pending, 400 invalid-prompt, 401/403 from a gated
				// non-loopback sidecar. Named, never guessed at, and never retried:
				// the node refused for a reason it stated.
				degrade(`the node answered HTTP ${response.status}`);
				return;
			}

			let settled: PublishPromptResponseBody;
			try {
				settled = (await response.json()) as PublishPromptResponseBody;
			} catch (error) {
				if (signal.aborted) return;
				degrade(`the node's reply could not be read (${error instanceof Error ? error.message : String(error)})`);
				return;
			}
			if (signal.aborted) return;
			if (!isRecord(settled)) {
				degrade("the node's reply was not an object");
				return;
			}

			const device = typeof settled.device === "string" ? settled.device : "another device";

			if (settled.outcome === "answered") {
				// The ONE place a value crosses back. `local.answer` re-checks it against
				// the prompt's own constraints and runs the compare-and-set; losing here
				// means the terminal got there first, which is not an error.
				local.answer(pending.id, settled.value, device);
				return;
			}

			if (settled.outcome === "abandoned" && settled.reason === "expired") {
				if (pending.expiresAt !== null) {
					// The ASKER's own deadline. It belongs to the ask rather than to
					// either surface, so it ends both.
					tickets.get(pending.id)?.withdraw("expired", device);
					return;
				}
				// A deadline the asker never asked for — see
				// SIDECAR_PROMPT_RENEW_MIN_ELAPSED_MS. Publish it again so the question
				// stays visible on the devices that are attending it.
				if (now() - startedAt >= SIDECAR_PROMPT_RENEW_MIN_ELAPSED_MS) continue;
				degrade("the node expired the question immediately");
				return;
			}

			// `withdrawn`, or an outcome this version does not know. Either way the
			// node is no longer holding the question and this side has no answer — so
			// the local prompt is left exactly as it is, standing at the terminal.
			return;
		}
	}

	function publish(pending: PendingPrompt): PendingPromptTicket {
		const ticket = local.publish(pending);
		tickets.set(pending.id, ticket);

		const controller = new AbortController();
		// Whatever settles this question HERE ends it on the node too: aborting the
		// open publish drops the connection, and the node's `PromptTicket::drop`
		// withdraws the question from every attending device's next poll. A prompt
		// answered at the terminal is not still open on the phone.
		void ticket.settled.then(
			() => {
				tickets.delete(pending.id);
				controller.abort();
			},
			() => {
				tickets.delete(pending.id);
				controller.abort();
			},
		);

		// NOT awaited: the terminal peer is offered this prompt in the same tick.
		void hold(pending, controller.signal);
		return ticket;
	}

	return {
		pollIntervalMs: local.pollIntervalMs,
		publish,
		list: (): PendingPrompt[] => local.list(),
		answer: (promptId, value, device): PendingPromptAnswerResult =>
			local.answer(promptId, value, device),
		settlementOf: (promptId): PendingPromptSettlement | null => local.settlementOf(promptId),
		subscribe: (listener) => local.subscribe(listener),
		// ── Notices: LOCAL ONLY, and that boundary is deliberate ─────────────────
		//
		// `publish` above is overridden to also `hold` the question on the node, so
		// a device polling the node's `GET /prompts` sees it. These three do NOT do
		// the equivalent, because the node's half of the announcement contract is
		// Rust (`packages/tractor/src/sidecar/pending_prompt.rs`) and does not exist
		// yet.
		//
		// What that means in practice, stated rather than discovered later: framing
		// reaches the TERMINAL and any DELIVERY channel (`attachDeliveryToHub`
		// subscribes to this hub in-process, and `noticesFor` is served from here),
		// AND now also the node, so the surfaces that poll it — the PWA, farm-attend
		// — stop receiving questions stripped of the sentences that explain them.
		announce(asker, notice) {
			const recorded = local.announce(asker, notice);
			// Fire into the queue and return. `say()` is synchronous and total (D1):
			// a wizard must never wait on, or fail because of, a notification hop.
			enqueueNotice(recorded);
			return recorded;
		},
		notices: () => local.notices(),
		noticesFor: (askerCommand, since) => local.noticesFor(askerCommand, since),
	};
}
