/**
 * SessionDigestContextProvider — session_start moment (ADR-058 Principle 1)
 *
 * Injects a pointer-first digest of recent agent activity. The agent sees
 * effort counts and IDs only; full detail is fetched on-demand via tool calls.
 *
 * Worst-case token contribution: ~15 tokens (3 effort lines + header).
 * Silently returns empty if farmhand sidecar is unavailable.
 */
import { CONTEXT_CAPABILITY } from "../types.js";
import type { ContextEntry, ContextProvider, ContextRequest } from "../types.js";

export interface EffortResult {
	id: string;
	status: string;
	submittedAt?: string;
	tasks?: Array<{ id: string; status: string }>;
}

export interface SessionDigestOptions {
	/** Farmhand HTTP sidecar URL (default: http://127.0.0.1:42001) */
	sidecarUrl?: string;
	/** Max recent efforts to surface (default: 5) */
	recentCount?: number;
	/** Request timeout in ms (default: 1500) */
	timeoutMs?: number;
}

export class SessionDigestContextProvider implements ContextProvider {
	readonly name = "session_digest";
	readonly capability = CONTEXT_CAPABILITY;

	private readonly sidecarUrl: string;
	private readonly recentCount: number;
	private readonly timeoutMs: number;

	constructor(options: SessionDigestOptions = {}) {
		this.sidecarUrl = options.sidecarUrl ?? "http://127.0.0.1:42001";
		this.recentCount = options.recentCount ?? 5;
		this.timeoutMs = options.timeoutMs ?? 1500;
	}

	async provide(_request: ContextRequest): Promise<ContextEntry[]> {
		try {
			const efforts = await this.fetchRecentEfforts();
			if (efforts.length === 0) return [];

			const lines = efforts.map((e) => {
				const taskCount = e.tasks?.length ?? "?";
				const date = e.submittedAt
					? e.submittedAt.slice(0, 10)
					: "unknown";
				return `- ${e.id}  status=${e.status}  tasks=${taskCount}  date=${date}`;
			});

			const content = [
				`# Recent agent efforts (last ${efforts.length}, full detail via task_status)`,
				...lines,
			].join("\n");

			return [{ label: "session_digest", content, priority: 20 }];
		} catch {
			return [];
		}
	}

	private async fetchRecentEfforts(): Promise<EffortResult[]> {
		const signal = AbortSignal.timeout(this.timeoutMs);
		const res = await fetch(`${this.sidecarUrl}/efforts`, { signal });
		if (!res.ok) return [];
		const all = (await res.json()) as EffortResult[];
		return all.slice(-this.recentCount).reverse();
	}
}
