import type { BaseSurfaceModel } from "@refarm.dev/operator-state";
import chalk from "chalk";

export function formatBaseSurfaceModel(model: BaseSurfaceModel): string {
	const lines: string[] = [];
	lines.push(chalk.bold(`Refarm base: ${model.ok ? "ready" : "blocked"}`));
	for (const unit of model.units) {
		const label = unit.id.padEnd(8);
		const state = unit.state.padEnd(9);
		lines.push(`${label} ${state} ${unit.summary}`);
		for (const evidence of unit.evidence.slice(0, 3)) {
			lines.push(chalk.dim(`  ${evidence.label}: ${evidence.value}`));
		}
		if (unit.actions[0]) {
			lines.push(chalk.dim(`  next: ${unit.actions[0].command}`));
		}
	}
	if (model.nextCommand) {
		lines.push("");
		lines.push(chalk.dim(`Next command: ${model.nextCommand}`));
	}
	return lines.join("\n");
}
