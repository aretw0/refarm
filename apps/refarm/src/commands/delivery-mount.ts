import { loadRawSovereignConfig } from "@refarm.dev/config";
import {
	parseDeliveryCatalog,
	type DeliveryAdapterFactory,
	type DeliveryCatalog,
} from "@refarm.dev/delivery-contract-v1";
import {
	createRemoteOperatorChannel,
	setPromptPublisher,
	type PendingPromptAsker,
	type PendingPromptHub,
	type PromptPublisher,
} from "@refarm.dev/prompt-contract-v1";
import os from "node:os";
import type { DeliveryAttachment, DeliveryChannelIssue } from "./delivery.js";
import { createSidecarPromptHub } from "./pending-prompt-sidecar.js";
import { resolveSidecarUrl } from "./sidecar-url.js";

/**
 * THE LAST MILE — where a declared delivery channel stops being a seam and starts
 * announcing the operator's actual questions.
 *
 * Design: `docs/superpowers/specs/2026-07-31-declared-delivery-design.md`, whose
 * implementation record ends with the one thing that was missing: *"Nothing
 * mounts delivery in production yet … that wiring is the next step, and it is one
 * call: `attachDeliveryToHub`."* This module is that call, plus the two facts it
 * needs to be safe.
 *
 * ── WHO FIRES IT (and why it is not the wizard, and not Rust) ─────────────────
 *
 * The ASKING side fires delivery. The process asking the question is the one that
 * knows a question exists, knows who is asking, and is still alive to be
 * interrupted — so publishing the question and announcing it are two halves of
 * one act, performed by one process. The alternative, the node calling back out
 * to announce on the asker's behalf, needs a second wire, a second failure mode,
 * and an answer path back into a process the node cannot see.
 *
 * D5 forbids the wizard from doing it: *"a wizard author writes nothing about
 * delivery"*. So the join is the ONE thing every wizard already shares — the
 * construction of its `OperatorChannel`. `setPromptPublisher` (in the prompt
 * block) makes that construction declarable; this module is what declares it for
 * the refarm CLI. Not one line of `auth.ts`, `intention.ts` or the kit's PATH
 * consent wizard changes, and none of them can tell the difference.
 *
 * ── THE HUB IS THE NODE'S, NOT THIS PROCESS'S ─────────────────────────────────
 *
 * This mount published to `createPendingPromptHub()` — an in-process hub that dies
 * with the CLI — while every attending surface (the kit on the operator's phone,
 * the `/attend` page, the `web serve` proxy that joins them) polled the NODE's hub
 * in `packages/tractor/src/sidecar/pending_prompt.rs`. Two hubs, so a question
 * asked at the terminal reached no device, and nothing in this repository ever
 * called `POST /prompts`. Both halves passed their own tests.
 *
 * The hub is now `createSidecarPromptHub` — the same interface, backed by the
 * node over loopback. Nothing else in this file changed shape, because nothing
 * else had to: the publisher, the peering, the no-deadline decision and the
 * delivery attachment were all written against `PendingPromptHub`.
 *
 * ── WHAT IT COSTS WHEN NOTHING IS DECLARED (D1) ───────────────────────────────
 *
 * Nothing, of DELIVERY. Finding no `delivery` block, this returns before the
 * adapter registry is imported, constructs no adapter, announces nothing, and
 * reports `declared: false` with no channels — an operator who never wants to be
 * notified is not merely un-notified, they are running the same code path.
 *
 * The node's own hub is a different axis and is deliberately NOT declaration-gated:
 * a question asked on the node is offered to the node, because that is where the
 * operator's enrolled devices are already listening — enrolling the phone WAS the
 * declaration, and `delivery` declares something else (an announcement pushed out
 * to a third party). Gating the wire on a Telegram channel would leave every
 * attending surface reading a hub with no publisher, which is the defect.
 *
 * It is still paid for only if a question is asked: `setPromptPublisher` takes a
 * THUNK, the publisher is built at channel construction, and the node is contacted
 * at `ask()`. A command that never prompts touches no socket.
 *
 * ── WHAT IT COSTS WHEN DELIVERY IS BROKEN (D4) ────────────────────────────────
 *
 * The question, never. Every failure below degrades to "the operator was not
 * reached, loudly" and leaves the prompt standing at the terminal and on the
 * pending-prompt wire: an unreadable config, a channel naming an unknown adapter,
 * an adapter that refuses at the transport, an adapter that throws. A
 * notification error is never allowed to surface as a prompt error.
 */

/** How a mount ended up: what it declared, what it could bring up, what it could not. */
export interface DeclaredDeliveryMount {
	/** Did the operator declare a `delivery` block with at least one channel? */
	declared: boolean;
	/** Channel names that were brought up and are now announcing. */
	channels: string[];
	/** Declared channels that could NOT be brought up, and why (D4, never a secret). */
	issues: DeliveryChannelIssue[];
	/**
	 * The hub this process's questions are published to — the NODE's, over
	 * loopback. Always present: it is what the operator's attending devices read,
	 * and it does not depend on a `delivery` declaration.
	 */
	hub: PendingPromptHub;
	/** Present only when at least one delivery channel came up. */
	attachment: DeliveryAttachment | null;
	/** Undo. Idempotent: detaches delivery and restores the previous publisher. */
	unmount(): void;
}

export interface InstallDeclaredDeliveryOptions {
	/** Who is asking, as the operator would recognise it, e.g. `refarm auth enroll`. */
	asker: PendingPromptAsker;
	/** Sovereign root to read the declaration from. Defaults to cwd. */
	root?: string;
	env?: NodeJS.ProcessEnv;
	/**
	 * The adapter registry. Defaults to `defaultDeliveryAdapterFactories()` — the
	 * production one. Injected only so the mount can be exercised against a spy
	 * adapter: a test that had to reach a real Telegram to prove the wiring would
	 * not be proving the wiring.
	 */
	factories?: readonly DeliveryAdapterFactory[];
	/** Where a delivery failure becomes visible. Defaults to stderr (D4). */
	warn?: (message: string) => void;
	/** Is a local terminal reading the question? Threaded to the attachment so a failure to ALSO
	 *  reach a phone does not interrupt an operator who is looking at the prompt. */
	attendedLocally?: () => boolean;
	/** Injected in tests so routing can be exercised without the filesystem (D8). */
	attending?: () => boolean;
	now?: () => number;
	/**
	 * The node's sidecar base URL. Defaults to the same resolution every other
	 * command uses (`REFARM_SIDECAR_URL` → config → `http://127.0.0.1:42001`), so
	 * the questions go to the same daemon `refarm status` reports on.
	 */
	sidecarUrl?: string;
	/**
	 * Injected so the join can be exercised against a stub. A test that had to
	 * reach the operator's LIVE daemon to prove the wiring would be publishing real
	 * questions to real devices — see the end-to-end run instead, which stands up
	 * its own throwaway node.
	 */
	fetch?: typeof globalThis.fetch;
}

function defaultWarn(message: string): void {
	// stderr, never stdout — stdout belongs to the command the operator ran.
	process.stderr.write(`${message}\n`);
}


/**
 * Read the `delivery` block. TOTAL — an unreadable or malformed declaration is an
 * issue to report, never an exception that reaches the command the operator ran.
 */
export function readDeclaredDeliveryCatalog(root: string): {
	catalog: DeliveryCatalog;
	issues: DeliveryChannelIssue[];
} {
	try {
		return { catalog: parseDeliveryCatalog(loadRawSovereignConfig(root)), issues: [] };
	} catch (error) {
		return {
			catalog: new Map(),
			issues: [
				{
					channel: "(delivery)",
					adapter: "(catalog)",
					detail: error instanceof Error ? error.message : String(error),
				},
			],
		};
	}
}

/**
 * Publish THIS process's questions to the node, and bring declared delivery up on
 * top of them.
 *
 * The two are separate acts with separate conditions, and this is the one place
 * that is visible: the hub is always built (the operator's devices are already
 * polling it), and the adapter registry is imported only if a channel is declared —
 * which is what makes the undeclared delivery path free rather than merely quiet.
 */
export async function installDeclaredDelivery(
	options: InstallDeclaredDeliveryOptions,
): Promise<DeclaredDeliveryMount> {
	const warn = options.warn ?? defaultWarn;
	// os-resolution: project — mounts what the workspace tier catalog declares, anchored where the operator stands
	const root = options.root ?? process.cwd();
	const env = options.env ?? process.env;

	const { catalog, issues: catalogIssues } = readDeclaredDeliveryCatalog(root);
	// A declaration the operator wrote and refarm cannot read is exactly D4's worst
	// case in slow motion: say so now, while they are at the terminal. It costs the
	// announcement, never the question — which still goes to the node below.
	for (const issue of catalogIssues) warn(`refarm delivery: ${issue.detail}`);

	// The node's hub, over loopback. Built before any delivery decision because it
	// does not depend on one: see the header.
	const hubOptions: Parameters<typeof createSidecarPromptHub>[0] = {
		baseUrl: options.sidecarUrl ?? resolveSidecarUrl(env),
		env,
		warn,
	};
	if (options.attendedLocally) hubOptions.attendedLocally = options.attendedLocally;
	if (options.fetch) hubOptions.fetch = options.fetch;
	if (options.now) hubOptions.now = options.now;
	const hub = createSidecarPromptHub(hubOptions);

	const declared = catalogIssues.length > 0 || catalog.size > 0;
	let channels: Awaited<ReturnType<typeof resolveChannels>>["channels"] = [];
	let issues: DeliveryChannelIssue[] = [...catalogIssues];
	let attachment: DeliveryAttachment | null = null;

	// D1 — silence is closed. Nothing declared, nothing loaded, nothing announcing,
	// and `./delivery.js` (with the whole adapter registry behind it) never imported.
	if (catalogIssues.length === 0 && catalog.size > 0) {
		const resolved = await resolveChannels(catalog, options, root, warn);
		channels = resolved.channels;
		issues = resolved.issues;
		if (channels.length > 0) {
			const attachOptions: Parameters<typeof resolved.attachDeliveryToHub>[1] = {
				channels,
				warn,
			};
			if (options.attending) attachOptions.attending = options.attending;
			if (options.attendedLocally) attachOptions.attendedLocally = options.attendedLocally;
			if (options.now) attachOptions.now = options.now;
			attachment = resolved.attachDeliveryToHub(hub, attachOptions);
		}
	}

	const publisher: PromptPublisher = {
		/**
		 * A STATEMENT reaches the same hub the questions do.
		 *
		 * Separate from `remote` because announcement has no lifecycle: `remote` is a
		 * factory called per ask, taking a signal, because a question can be
		 * withdrawn, expire or lose a race. A notice can do none of those, so it
		 * would only be borrowing a lifecycle it has no use for.
		 *
		 * Without this the verb reached the terminal and stopped there — which is the
		 * defect the whole slice exists to remove, reproduced one layer up.
		 */
		announce: (notice) => void hub.announce(options.asker, notice),
		remote: (signal) =>
			createRemoteOperatorChannel({
				hub,
				asker: options.asker,
				signal,
				// NO DEADLINE, on purpose. `createRemoteOperatorChannel` defaults to ten
				// minutes, and a peered expiry ends BOTH sides — which would mean
				// declaring delivery silently put a ten-minute timer on every terminal
				// prompt that never had one. The terminal governs; delivery listens.
				timeoutMs: null,
			}),
	};
	const restore = setPromptPublisher(() => publisher);

	let unmounted = false;
	return {
		declared,
		channels: channels.map((channel) => channel.declaration.name),
		issues,
		hub,
		attachment,
		unmount: () => {
			if (unmounted) return;
			unmounted = true;
			restore();
			attachment?.detach();
		},
	};
}

/**
 * Load the adapter registry and bring up what the catalog declared.
 *
 * Split out so the dynamic `import("./delivery.js")` has exactly ONE call site,
 * under exactly one condition — the D1 guarantee is that this function is never
 * entered when nothing is declared, and a guarantee is easier to keep when the
 * thing it is about has a name.
 */
async function resolveChannels(
	catalog: DeliveryCatalog,
	options: InstallDeclaredDeliveryOptions,
	root: string,
	warn: (message: string) => void,
) {
	const { resolveDeliveryChannels, attachDeliveryToHub } = await import("./delivery.js");
	const resolveOptions: Parameters<typeof resolveDeliveryChannels>[1] = { root };
	if (options.env) resolveOptions.env = options.env;
	if (options.factories) resolveOptions.factories = options.factories;
	const { channels, issues } = resolveDeliveryChannels(catalog, resolveOptions);
	for (const issue of issues) {
		warn(`refarm delivery: channel "${issue.channel}" is declared but cannot be used — ${issue.detail}`);
	}
	return { channels, issues, attachDeliveryToHub };
}

/**
 * The asker label a command carries into a notification.
 *
 * What the operator reads on their phone at 3am, so it is the invocation they
 * would recognise — `refarm auth enroll` — and never an internal handler name.
 */
export function askerForCommandPath(argvPath: readonly string[]): PendingPromptAsker {
	const command = ["refarm", ...argvPath].join(" ").trim();
	return { command: command || "refarm", pid: process.pid, host: os.hostname() };
}
