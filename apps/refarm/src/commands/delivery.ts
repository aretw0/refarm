import { loadRawSovereignConfig } from "@refarm.dev/config";
import {
	buildDeliveryRecord,
	deliver,
	DeliveryDeclarationError,
	parseDeclaredTokenRef,
	parseDeliveryCatalog,
	refuseOverclaimedDeclaration,
	refuseUnenforceableAdapter,
	routeDelivery,
	type DeclaredTokenRef,
	type DeliveryAdapterFactory,
	type DeliveryCatalog,
	type DeliveryChoice,
	type DeliveryDeclaration,
	type DeliveryRecord,
	type DeliveryRequest,
	type ResolvedDeliveryChannel,
} from "@refarm.dev/delivery-contract-v1";
import type { PendingPrompt, PendingPromptHub } from "@refarm.dev/prompt-contract-v1";
import fs from "node:fs";
import path from "node:path";
import { resolveRefarmScopeRoot } from "../utils/refarm-home.js";
import { defaultDeliveryAdapterFactories } from "./delivery-adapters.js";

/**
 * Declared delivery, wired into the node.
 *
 * Design: `docs/superpowers/specs/2026-07-31-declared-delivery-design.md`.
 *
 * The whole point of this module is that WIZARDS DO NOT IMPORT IT (D5). A
 * wizard asks a question through `OperatorChannel`; if a channel is declared,
 * the prompt is announced on it, and if that channel can carry a decision the
 * operator can settle it from their pocket. Delivery appears in a wizard's code
 * exactly never — that is the acceptance test for this design, not a nicety.
 *
 * The seam it hooks is `PendingPromptHub.subscribe`, which the pending-prompt
 * design already described as "what a push transport would hook". Delivery is
 * that push transport.
 */

// ── Reading the catalog ───────────────────────────────────────────────────────

/**
 * Read the `delivery` block from `.refarm/config.json`.
 *
 * Uses the same reader the `surfaces` catalog uses (`loadRawSovereignConfig`) —
 * the fs-only, no-interpolation, no-legacy-merge one that mirrors the Rust
 * host's view of the file — because a declaration about who may interrupt the
 * operator must be read from exactly what is on disk.
 */
export function readDeliveryCatalog(root: string = process.cwd()): DeliveryCatalog {
	return parseDeliveryCatalog(loadRawSovereignConfig(root));
}

// ── Resolving the secret, at use ──────────────────────────────────────────────

export interface ResolveTokenOptions {
	root?: string;
	env?: NodeJS.ProcessEnv;
}

/**
 * Turn a declared REFERENCE into the secret it names, at the moment of use.
 *
 * Nothing here is cached, and the value is returned to exactly one caller: the
 * adapter about to make one request. It is never written back to the catalog,
 * never attached to a declaration, and never included in an error — the
 * messages below name the SOURCE (a path, a variable name), which is what the
 * operator needs to fix it, and never the contents.
 */
export async function resolveDeclaredToken(
	ref: DeclaredTokenRef,
	options: ResolveTokenOptions = {},
): Promise<string> {
	if (ref.kind === "env") {
		const env = options.env ?? process.env;
		const value = env[ref.name];
		if (typeof value !== "string" || !value.trim()) {
			throw new DeliveryDeclarationError(
				`delivery: the environment variable "${ref.name}" is empty or unset`,
			);
		}
		return value.trim();
	}

	const root = options.root ?? process.cwd();
	const resolved = path.isAbsolute(ref.path) ? ref.path : path.join(root, ref.path);
	let raw: string;
	try {
		raw = await fs.promises.readFile(resolved, "utf8");
	} catch {
		// The path is safe to name; whatever is inside it is not.
		throw new DeliveryDeclarationError(`delivery: cannot read the token file at ${resolved}`);
	}
	const trimmed = raw.trim();
	if (!trimmed) {
		throw new DeliveryDeclarationError(`delivery: the token file at ${resolved} is empty`);
	}
	return trimmed;
}

// ── Binding declarations to adapters ──────────────────────────────────────────

/** A declared channel that could not be brought up, and why. */
export interface DeliveryChannelIssue {
	channel: string;
	adapter: string;
	detail: string;
}

export interface ResolveDeliveryChannelsOptions {
	factories?: readonly DeliveryAdapterFactory[];
	root?: string;
	env?: NodeJS.ProcessEnv;
}

/**
 * Bind every declared channel to its adapter, refusing the ones that cannot be
 * honoured.
 *
 * REPORTS rather than throws, on the `connection-catalog` model: one broken
 * channel must not take the other channels — or the command the operator is
 * actually running — down with it. But a channel that produced an issue is NOT
 * returned as usable, so a refusal here is a genuine refusal, not a warning
 * that gets ignored one line later.
 *
 * The three S3 checks all run before a channel is ever used: the adapter must
 * be able to do what it says (`refuseUnenforceableAdapter`), the declaration
 * must not exceed the adapter (`refuseOverclaimedDeclaration`), and the factory
 * gets to refuse a declaration it cannot serve.
 */
export function resolveDeliveryChannels(
	catalog: DeliveryCatalog,
	options: ResolveDeliveryChannelsOptions = {},
): { channels: ResolvedDeliveryChannel[]; issues: DeliveryChannelIssue[] } {
	const factories = options.factories ?? defaultDeliveryAdapterFactories();
	const byId = new Map(factories.map((factory) => [factory.id, factory]));
	const channels: ResolvedDeliveryChannel[] = [];
	const issues: DeliveryChannelIssue[] = [];

	for (const declaration of catalog.values()) {
		const factory = byId.get(declaration.adapter);
		if (!factory) {
			issues.push({
				channel: declaration.name,
				adapter: declaration.adapter,
				detail:
					`no delivery adapter named "${declaration.adapter}" is registered ` +
					`(available: ${[...byId.keys()].join(", ") || "none"})`,
			});
			continue;
		}
		try {
			const adapter = factory.create({
				declaration,
				resolveToken: () =>
					resolveDeclaredToken(parseDeclaredTokenRef(declaration), {
						root: options.root,
						env: options.env,
					}),
			});
			refuseUnenforceableAdapter(adapter);
			refuseOverclaimedDeclaration(declaration, adapter);
			channels.push({ declaration, adapter });
		} catch (error) {
			issues.push({
				channel: declaration.name,
				adapter: declaration.adapter,
				detail: error instanceof Error ? error.message : String(error),
			});
		}
	}

	return { channels, issues };
}

// ── D8 — is the operator attending? ───────────────────────────────────────────

const DEFAULT_ATTENTION_WINDOW_MS = 5 * 60 * 1000;

function attentionStatePath(scope: string): string {
	const safeScope = scope.replace(/[^a-zA-Z0-9._:-]/g, "_");
	return path.join(resolveRefarmScopeRoot(), "operator-attention", `${safeScope}.json`);
}

export interface OperatorAttendingOptions {
	/** Attention scope. Defaults to `REFARM_OPERATOR_ATTENTION_SCOPE`. */
	scope?: string;
	now?: () => number;
}

/**
 * Is the operator attending RIGHT NOW?
 *
 * D8's insight is that refarm already knows this, because the operator already
 * declares it: `refarm intention arm` is precisely "I am attending, for this
 * window". So routing consults a declaration the operator ALREADY MAKES rather
 * than asking them to choose an adapter per prompt.
 *
 * No scope declared ⇒ not attending. That is the safe default in the honest
 * direction: it routes only to channels that survive the phone being in a
 * pocket, which is the assumption that fails least badly.
 *
 * NOTE: this reads the same `<REFARM_HOME>/operator-attention/<scope>.json`
 * that `intention.ts` writes and that `base-surface-status.ts` reads. Those are
 * already two copies of this predicate and this is a third; converging them
 * into one reader is a real debt, deliberately not paid inside this slice
 * because it would touch commands this slice has no business changing.
 */
export function operatorIsAttending(options: OperatorAttendingOptions = {}): boolean {
	const scope = options.scope?.trim() || process.env.REFARM_OPERATOR_ATTENTION_SCOPE?.trim();
	if (!scope) return false;

	let state: { armedAt?: number; windowMs?: number };
	try {
		state = JSON.parse(fs.readFileSync(attentionStatePath(scope), "utf8")) as typeof state;
	} catch {
		return false;
	}

	const armedAt = Number(state.armedAt ?? 0);
	const windowMs = Number(state.windowMs ?? DEFAULT_ATTENTION_WINDOW_MS);
	const now = (options.now ?? (() => Date.now()))();
	const ageMs = now - armedAt;
	return Number.isFinite(armedAt) && armedAt > 0 && ageMs >= 0 && ageMs <= windowMs;
}

// ── Projecting a pending prompt for delivery ──────────────────────────────────

/**
 * What choices, if any, this prompt can be settled with from a notification.
 *
 * A confirm becomes two buttons; a select becomes its offered options. Text and
 * secret produce none, which is what makes them announce-only: a notification
 * channel carries a choice, not a text field.
 */
export function deliveryChoicesFor(pending: PendingPrompt): DeliveryChoice[] | undefined {
	const prompt = pending.prompt;
	if (prompt.type === "confirm") {
		return [
			{ value: "true", label: "Yes" },
			{ value: "false", label: "No" },
		];
	}
	if (prompt.type === "select") {
		return prompt.options.map((option) => ({ value: option.value, label: option.label }));
	}
	return undefined;
}

/**
 * Project a pending prompt into the shape an adapter is handed.
 *
 * Deliberately lossy: an adapter gets what it needs to say the question and
 * carry a choice back, and nothing more. It never receives the prompt object,
 * the hub, or any way to reach another prompt.
 */
export function deliveryRequestFromPendingPrompt(
	pending: PendingPrompt,
	framing: readonly { message: string; kind: string }[] = [],
): DeliveryRequest {
	const choices = deliveryChoicesFor(pending);
	const request: DeliveryRequest = {
		promptId: pending.id,
		question: pending.prompt.question,
		asker: pending.asker.command,
		needsDecision: true,
		answerTravels: pending.answerTravels,
		expiresAt: pending.expiresAt,
	};
	const withFraming = framing.length > 0 ? { ...request, framing } : request;
	return choices === undefined ? withFraming : { ...withFraming, choices };
}

// ── The attachment: where a wizard gains delivery without knowing ─────────────

export interface DeliveryAttachment {
	/** Stop delivering. Idempotent. */
	detach(): void;
	/** What happened when refarm tried to reach the operator about this prompt. */
	recordFor(promptId: string): DeliveryRecord | null;
	/** Every record still remembered, oldest first. */
	records(): DeliveryRecord[];
}

export interface AttachDeliveryOptions {
	channels: readonly ResolvedDeliveryChannel[];
	/** D8 — injected so routing can be tested without the filesystem. */
	attending?: () => boolean;
	now?: () => number;
	/**
	 * How many delivery records stay readable. Bounded by construction: an
	 * operator asks about the question in front of them, not about the four
	 * hundredth one.
	 */
	maxRecords?: number;
	/** Where a delivery failure becomes visible. Defaults to stderr (D4). */
	warn?: (message: string) => void;
}

const DEFAULT_MAX_RECORDS = 64;

function defaultWarn(message: string): void {
	// stderr, never stdout — stdout belongs to the command the operator ran.
	process.stderr.write(`${message}\n`);
}

/**
 * Attach declared delivery to a pending-prompt hub.
 *
 * THIS is the line that makes every wizard already written, and every wizard
 * not yet written, reach the operator's pocket — at cost O(1) rather than
 * O(wizards). A wizard asks through `OperatorChannel`; the channel publishes to
 * the hub; the hub tells us; we route to the declared channels. The wizard
 * never learns any of it happened.
 *
 * Delivery is fire-and-forget with respect to the ASKER: a slow or broken
 * notification transport must never delay, or fail, the question itself. What
 * it must never be is SILENT, so every attempt lands in a record and a failure
 * to reach the operator is written where they will see it (D4).
 */
export function attachDeliveryToHub(
	hub: PendingPromptHub,
	options: AttachDeliveryOptions,
): DeliveryAttachment {
	const now = options.now ?? (() => Date.now());
	const attending = options.attending ?? (() => operatorIsAttending());
	const warn = options.warn ?? defaultWarn;
	const maxRecords = options.maxRecords ?? DEFAULT_MAX_RECORDS;
	const records: DeliveryRecord[] = [];

	function remember(record: DeliveryRecord): void {
		records.push(record);
		while (records.length > maxRecords) records.shift();
	}

	// THIS consumer's cursor into the notice log (D9). Per asker, because framing
	// belongs to the wizard that said it, and held HERE rather than in the hub
	// because a hub that keeps its readers' state can only serve one reader — the
	// node hop and any future poller carry their own.
	const framingCarried = new Map<string, number>();

	const unsubscribe = hub.subscribe((pending) => {
		// No channel declared is not a failure — it is silence by consent (D1).
		if (options.channels.length === 0) return;

		// Take what this wizard said since the last question we carried, so framing
		// and question arrive as ONE message per channel — and a second question
		// does not repeat sentences the operator already read.
		const command = pending.asker.command;
		const fresh = hub.noticesFor(command, framingCarried.get(command) ?? 0);
		if (fresh.length > 0) {
			framingCarried.set(command, fresh[fresh.length - 1]!.ordinal);
		}
		const framing = fresh.map((notice) => ({ message: notice.message, kind: notice.kind }));

		const request = deliveryRequestFromPendingPrompt(pending, framing);
		const plan = routeDelivery({ request, channels: options.channels, attending: attending() });

		void deliver({
			plan,
			request,
			// The adapter's only reach back into refarm: settle THIS prompt, and
			// nothing else. `answer` returns false when something already settled it
			// — the operator typed at the terminal, another device won, the deadline
			// passed — which is normal, not an error.
			sink: {
				answer: (value) => hub.answer(pending.id, value, deliveryDeviceLabel(plan)).ok,
			},
			now,
		})
			.then((outcomes) => {
				const record = buildDeliveryRecord(pending.id, now(), plan, outcomes);
				remember(record);
				announceFailures(record, warn);
			})
			.catch((error: unknown) => {
				// deliver() is total, so this is a bug rather than a transport failure —
				// which is exactly why it must be loud instead of swallowed.
				warn(
					`refarm delivery: could not attempt delivery of a pending question ` +
						`(${error instanceof Error ? error.message : String(error)})`,
				);
			});
	});

	let detached = false;
	return {
		detach: () => {
			if (detached) return;
			detached = true;
			unsubscribe();
		},
		recordFor: (promptId) => records.find((record) => record.promptId === promptId) ?? null,
		records: () => [...records],
	};
}

/**
 * Which device a delivered answer is recorded as coming from (P3).
 *
 * The channel NAME, not a device the adapter chose for itself: an attribution a
 * caller can pick is not an attribution. It is prefixed so it can never be
 * mistaken for an enrolled device label.
 */
function deliveryDeviceLabel(plan: { routes: readonly { channel: string }[] }): string {
	const channel = plan.routes.find((route) => route.channel)?.channel ?? "delivery";
	return `delivery:${channel}`;
}

/**
 * Make a failure to reach the operator VISIBLE.
 *
 * A notification adapter that fails silently produces the worst outcome
 * available: a prompt waiting, an operator who was never told, and nothing
 * anywhere saying so. A successful delivery says nothing — the operator's phone
 * already buzzed.
 */
function announceFailures(record: DeliveryRecord, warn: (message: string) => void): void {
	if (record.reached) return;
	const reasons = [
		...record.outcomes.map(
			(outcome) =>
				`${outcome.adapter}: ${outcome.status === "refused" ? "refused by the transport" : "could not attempt"}` +
				(outcome.detail ? ` (${outcome.detail})` : ""),
		),
		...record.refusals.map((refusal) => refusal.detail),
	];
	warn(
		`refarm delivery: a question is waiting and could not be delivered — ${
			reasons.join("; ") || "no channel was eligible"
		}`,
	);
}

/**
 * Bring up declared delivery from the filesystem, ready to attach.
 *
 * The one call a host (the sidecar, a long-running command) makes. Returns the
 * issues rather than throwing them so a broken delivery declaration degrades to
 * "the operator is not reached, loudly" instead of "the node will not start".
 */
export function loadDeclaredDelivery(
	options: ResolveDeliveryChannelsOptions & { root?: string } = {},
): { channels: ResolvedDeliveryChannel[]; issues: DeliveryChannelIssue[] } {
	const root = options.root ?? process.cwd();
	let catalog: DeliveryCatalog;
	try {
		catalog = readDeliveryCatalog(root);
	} catch (error) {
		return {
			channels: [],
			issues: [
				{
					channel: "(delivery)",
					adapter: "(catalog)",
					detail: error instanceof Error ? error.message : String(error),
				},
			],
		};
	}
	return resolveDeliveryChannels(catalog, { ...options, root });
}

export type { DeliveryDeclaration, DeliveryRecord, ResolvedDeliveryChannel };
