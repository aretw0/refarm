import type { DispatchStep, PlaybookDispatch } from "./types.js";

/**
 * The REAL DispatchStep — bridges the pure interpreter to refarm's canonical dispatch spine.
 * A playbook step becomes a dispatch Effort (the SAME shape buildDispatchEffort produces: one
 * task `{pluginId, fn, args}` with a `replyRef` = the effort id), submitted through the host,
 * and its result is read back the way the agent's `invoke_tool` and SPI `call_plugin` do it:
 * poll the graph for the plugin's `dispatch-result` node keyed by that replyRef.
 *
 * Everything it needs is injected structurally (no runtime dependency here): `submit` is the
 * host's effort submit, `queryNodes` is the host's graph read. So this is testable with fakes,
 * and in production it's wired to a RuntimeHost (`submit`→effort adapter, `queryNodes`→graph).
 */

/** A dispatch-result node, as stored by a plugin: it carries the replyRef it answers and a
 * result/error. Field names are matched flexibly (camel/kebab) since plugins vary. */
export interface DispatchResultNode {
	[key: string]: unknown;
}

export interface DispatchBridgeOptions {
	/** Submit a dispatch Effort; returns the effort id. The host's effort submit. */
	submit: (effort: DispatchEffort) => Promise<string>;
	/** Read graph nodes of a type. The host's `queryNodes`. Polled for the result node. */
	queryNodes: (type: string) => Promise<DispatchResultNode[]>;
	/** Mint an id (effort id / task id). Injected so this stays deterministic in tests. */
	newId: () => string;
	/** Current time as ISO. Injected. */
	nowIso: () => string;
	/** The node type to poll for the result (default "DispatchResult"). */
	resultNodeType?: string;
	/** How long to wait for the result before giving up, ms (default 30_000). */
	timeoutMs?: number;
	/** Poll interval, ms (default 250). */
	pollMs?: number;
	/** Sleep fn (injected so tests don't wait real time). */
	sleep?: (ms: number) => Promise<void>;
	/** Clock for the timeout (injected; defaults to Date.now). */
	now?: () => number;
}

/** The dispatch Effort shape (a subset of effort:v1) this bridge builds — kept structural so
 * the package stays dependency-free; it is exactly what buildDispatchEffort emits. */
export interface DispatchEffort {
	id: string;
	direction: "dispatch";
	tasks: Array<{ id: string; pluginId: string; fn: string; args: Record<string, unknown> }>;
	source: string;
	submittedAt: string;
}

const REPLY_REF_KEYS = ["replyRef", "reply-ref", "reply_ref"];
const RESULT_KEYS = ["result", "value", "payload"];
const ERROR_KEYS = ["error", "err", "message"];

function readField(node: DispatchResultNode, keys: string[]): unknown {
	for (const key of keys) {
		if (key in node && node[key] != null) return node[key];
	}
	return undefined;
}

/** Build the canonical dispatch Effort for a request (mirrors buildDispatchEffort). */
export function toDispatchEffort(
	request: PlaybookDispatch,
	newId: () => string,
	nowIso: () => string,
): DispatchEffort {
	const effortId = newId();
	return {
		id: effortId,
		direction: "dispatch",
		tasks: [
			{
				id: newId(),
				pluginId: request.pluginId,
				fn: request.verb,
				args: { ...request.args, replyRef: effortId },
			},
		],
		source: "playbook",
		submittedAt: nowIso(),
	};
}

/**
 * Create a DispatchStep wired to the canonical spine: submit the effort, then poll the graph
 * for the dispatch-result node whose replyRef matches, until the timeout. Returns the node's
 * result; throws on a plugin-reported error or on timeout. Feed this to `runPlaybook`.
 */
export function createDispatchStep(options: DispatchBridgeOptions): DispatchStep {
	const resultNodeType = options.resultNodeType ?? "DispatchResult";
	const timeoutMs = options.timeoutMs ?? 30_000;
	const pollMs = options.pollMs ?? 250;
	const sleep = options.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
	const now = options.now ?? (() => Date.now());

	return async (request: PlaybookDispatch): Promise<unknown> => {
		const effort = toDispatchEffort(request, options.newId, options.nowIso);
		const replyRef = effort.id;
		await options.submit(effort);

		const deadline = now() + timeoutMs;
		for (;;) {
			const nodes = await options.queryNodes(resultNodeType);
			const match = nodes.find((node) => {
				const ref = readField(node, REPLY_REF_KEYS);
				return typeof ref === "string" && ref === replyRef;
			});
			if (match) {
				const error = readField(match, ERROR_KEYS);
				if (typeof error === "string" && error.length > 0) {
					throw new Error(`${request.pluginId}:${request.verb} failed: ${error}`);
				}
				return readField(match, RESULT_KEYS) ?? match;
			}
			if (now() >= deadline) {
				throw new Error(
					`DISPATCH_TIMEOUT: no dispatch-result for ${request.pluginId}:${request.verb} ` +
						`(replyRef ${replyRef}) within ${timeoutMs}ms`,
				);
			}
			await sleep(pollMs);
		}
	};
}
