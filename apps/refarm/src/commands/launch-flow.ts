import type { RefarmStatusJson } from "@refarm.dev/cli/status";
import {
	printRefarmLaunchBanner,
	type RefarmLaunchExperience,
} from "./brand.js";
import { launchDryRunMessage, launchStartMessage } from "./launch-feedback.js";
import { assertLaunchAllowed } from "./launch-policy.js";

export interface ExecuteRendererLaunchFlowOptions<
	TSpec extends { display: string },
> {
	launch?: boolean;
	dryRun?: boolean;
	status: RefarmStatusJson;
	launchGuardTarget: string;
	bannerExperience: RefarmLaunchExperience;
	dryRunRuntimeLabel: string;
	startRuntimeLabel: string;
	resolveLaunchSpec: () => TSpec;
	launchProcess: (spec: TSpec) => Promise<number>;
	onDryRun?: (spec: TSpec) => void | Promise<void>;
	onLaunchStarted?: (spec: TSpec) => void | Promise<void>;
	log?: (message: string) => void;
	setExitCode?: (code: number) => void;
}

export async function executeRendererLaunchFlow<
	TSpec extends { display: string },
>(options: ExecuteRendererLaunchFlowOptions<TSpec>): Promise<void> {
	if (!options.launch) {
		return;
	}

	assertLaunchAllowed(options.status, options.launchGuardTarget);
	printRefarmLaunchBanner(options.bannerExperience);

	const spec = options.resolveLaunchSpec();
	const log = options.log ?? console.log;

	if (options.dryRun) {
		log(launchDryRunMessage(options.dryRunRuntimeLabel, spec.display));
		await options.onDryRun?.(spec);
		return;
	}

	log(launchStartMessage(options.startRuntimeLabel, spec.display));
	const launchPromise = options.launchProcess(spec);
	await options.onLaunchStarted?.(spec);
	const code = await launchPromise;

	if (code !== 0) {
		(
			options.setExitCode ??
			((exitCode) => {
				process.exitCode = exitCode;
			})
		)(code);
	}
}
