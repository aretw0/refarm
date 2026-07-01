import {
	planSessionContextFold,
	type PlanSessionContextFoldOptions,
	type SessionContextFoldPlan,
	type SessionEntry,
} from "@refarm.dev/session-contract-v1";
import type { ContextEntry, ContextProvider, ContextRequest } from "../types.js";
import { CONTEXT_CAPABILITY } from "../types.js";

export type SessionContextFoldEntryLoader =
	| SessionEntry[]
	| ((request: ContextRequest) => SessionEntry[] | Promise<SessionEntry[]>);

export interface SessionContextFoldProviderOptions
	extends PlanSessionContextFoldOptions {
	entries: SessionContextFoldEntryLoader;
	priority?: number;
	foldedRefPreviewCount?: number;
}

function resolveEntries(
	loader: SessionContextFoldEntryLoader,
	request: ContextRequest,
): SessionEntry[] | Promise<SessionEntry[]> {
	if (typeof loader === "function") {
		return loader(request);
	}
	return loader;
}

function formatDigest(plan: SessionContextFoldPlan): string {
	return `${plan.fold.digest.algorithm}:${plan.fold.digest.value}`;
}

function formatEntryRefPreview(
	plan: SessionContextFoldPlan,
	previewCount: number,
): string[] {
	const refs = plan.fold.folded_entry_refs.slice(0, previewCount);
	const lines = refs.map(
		(ref) =>
			`- ${ref.entry_id} kind=${ref.kind} ts=${ref.timestamp_ns} digest=${ref.content_digest.value}`,
	);
	const remaining = plan.fold.folded_entry_refs.length - refs.length;
	if (remaining > 0) {
		lines.push(`- ... ${remaining} more folded entries`);
	}
	return lines;
}

export class SessionContextFoldProvider implements ContextProvider {
	readonly name = "session_context_fold";
	readonly capability = CONTEXT_CAPABILITY;

	private readonly entries: SessionContextFoldEntryLoader;
	private readonly priority: number;
	private readonly foldedRefPreviewCount: number;
	private readonly foldOptions: PlanSessionContextFoldOptions;

	constructor(options: SessionContextFoldProviderOptions) {
		this.entries = options.entries;
		this.priority = options.priority ?? 18;
		this.foldedRefPreviewCount = options.foldedRefPreviewCount ?? 8;
		this.foldOptions = {
			protectedTailCount: options.protectedTailCount,
			nowNs: options.nowNs,
			id: options.id,
			summary: options.summary,
		};
	}

	async provide(request: ContextRequest): Promise<ContextEntry[]> {
		const entries = await resolveEntries(this.entries, request);
		const plan = planSessionContextFold(entries, this.foldOptions);
		if (!plan) return [];

		return [
			{
				label: "session_context_fold",
				priority: this.priority,
				content: this.buildContent(plan),
			},
		];
	}

	private buildContent(plan: SessionContextFoldPlan): string {
		const protectedTail = plan.fold.protected_tail_entry_ids.map(
			(id) => `- ${id}`,
		);
		const preview = formatEntryRefPreview(
			plan,
			this.foldedRefPreviewCount,
		);
		return [
			"# Session context fold",
			`fold_id: ${plan.fold["@id"]}`,
			`session_id: ${plan.fold.session_id}`,
			`folded_range: ${plan.fold.range.from_entry_id}..${plan.fold.range.to_entry_id} (${plan.fold.range.entry_count} entries)`,
			`fold_digest: ${formatDigest(plan)}`,
			plan.fold.summary ? `summary: ${plan.fold.summary}` : null,
			"protected_tail_entry_ids:",
			...protectedTail,
			"folded_entry_refs_preview:",
			...preview,
			"unfold_policy: folded entries are omitted from prompt; use a consumer-owned unfold tool or session store lookup when exact detail is needed.",
		]
			.filter((line): line is string => line !== null)
			.join("\n");
	}
}
