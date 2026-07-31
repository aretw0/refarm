import os from "node:os";
import { loadRawSovereignConfig } from "@refarm.dev/config";
import {
	parseDeliveryCatalog,
	type DeliveryAdapterFactory,
	type DeliveryCatalog,
} from "@refarm.dev/delivery-contract-v1";
import {
	createPendingPromptHub,
	createRemoteOperatorChannel,
	setPromptPublisher,
	type PendingPromptAsker,
	type PendingPromptHub,
	type PromptPublisher,
} from "@refarm.dev/prompt-contract-v1";
import type { DeliveryAttachment, DeliveryChannelIssue } from "./delivery.js";

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
 * ── WHAT IT COSTS WHEN NOTHING IS DECLARED (D1) ───────────────────────────────
 *
 * Nothing. `installDeclaredDelivery` reads the `delivery` block and, finding it
 * absent, installs NO publisher and returns before the adapter registry is even
 * imported. `createStdioOperatorChannel` then returns exactly what it returned
 * before any of this existed. An operator who never wants to be notified is not
 * merely un-notified; they are running the same code path.
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
	/** Present only when at least one channel came up. */
	hub: PendingPromptHub | null;
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
	/** Injected in tests so routing can be exercised without the filesystem (D8). */
	attending?: () => boolean;
	now?: () => number;
}

function defaultWarn(message: string): void {
	// stderr, never stdout — stdout belongs to the command the operator ran.
	process.stderr.write(`${message}\n`);
}

/** An inert mount. Returned whenever nothing is (or can be) announcing. */
function inert(issues: DeliveryChannelIssue[] = [], declared = false): DeclaredDeliveryMount {
	return {
		declared,
		channels: [],
		issues,
		hub: null,
		attachment: null,
		unmount: () => {},
	};
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
 * Bring declared delivery up for THIS process and this asker.
 *
 * Returns without installing anything when nothing is declared — including
 * without importing the adapter registry, which is what makes the undeclared
 * path free rather than merely quiet.
 */
export async function installDeclaredDelivery(
	options: InstallDeclaredDeliveryOptions,
): Promise<DeclaredDeliveryMount> {
	const warn = options.warn ?? defaultWarn;
	const root = options.root ?? process.cwd();

	const { catalog, issues: catalogIssues } = readDeclaredDeliveryCatalog(root);
	if (catalogIssues.length > 0) {
		// A declaration the operator wrote and refarm cannot read is exactly D4's
		// worst case in slow motion: say so now, while they are at the terminal.
		for (const issue of catalogIssues) warn(`refarm delivery: ${issue.detail}`);
		return inert(catalogIssues, true);
	}
	// D1 — silence is closed. Nothing declared, nothing loaded, nothing installed.
	if (catalog.size === 0) return inert();

	// Only now is the adapter registry worth loading.
	const { resolveDeliveryChannels, attachDeliveryToHub } = await import("./delivery.js");
	const resolveOptions: Parameters<typeof resolveDeliveryChannels>[1] = { root };
	if (options.env) resolveOptions.env = options.env;
	if (options.factories) resolveOptions.factories = options.factories;
	const { channels, issues } = resolveDeliveryChannels(catalog, resolveOptions);
	for (const issue of issues) {
		warn(`refarm delivery: channel "${issue.channel}" is declared but cannot be used — ${issue.detail}`);
	}
	if (channels.length === 0) return inert(issues, true);

	const hub = createPendingPromptHub();
	const attachOptions: Parameters<typeof attachDeliveryToHub>[1] = { channels, warn };
	if (options.attending) attachOptions.attending = options.attending;
	if (options.now) attachOptions.now = options.now;
	const attachment = attachDeliveryToHub(hub, attachOptions);

	const publisher: PromptPublisher = {
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
		declared: true,
		channels: channels.map((channel) => channel.declaration.name),
		issues,
		hub,
		attachment,
		unmount: () => {
			if (unmounted) return;
			unmounted = true;
			restore();
			attachment.detach();
		},
	};
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
