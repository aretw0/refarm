export interface TurboCacheRunSummary {
	tool: "turbo";
	cached: number;
	total: number;
	hitRate: number;
	status: "full-hit" | "partial-hit" | "miss";
	tasksSuccessful?: number;
	tasksTotal?: number;
}

export function parseTurboCacheRunSummary(output: string): TurboCacheRunSummary | null {
	const tasksMatch = output.match(/Tasks:\s+(\d+)\s+successful,\s+(\d+)\s+total/);
	const cachedMatch = output.match(/Cached:\s+(\d+)\s+cached,\s+(\d+)\s+total/);
	if (!cachedMatch) return null;

	const cached = Number(cachedMatch[1]);
	const total = Number(cachedMatch[2]);
	if (!Number.isFinite(cached) || !Number.isFinite(total) || total < 0) {
		return null;
	}

	const hitRate = total === 0 ? 0 : cached / total;
	return {
		tool: "turbo",
		cached,
		total,
		hitRate,
		status: cached === 0 ? "miss" : cached === total ? "full-hit" : "partial-hit",
		...(tasksMatch
			? {
					tasksSuccessful: Number(tasksMatch[1]),
					tasksTotal: Number(tasksMatch[2]),
				}
			: {}),
	};
}
