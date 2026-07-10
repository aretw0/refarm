import { pathToFileURL } from "node:url";

export interface ParseableCapabilityHostProgram {
	parseAsync(argv?: readonly string[], parseOptions?: unknown): Promise<unknown>;
}

export interface CapabilityHostCliEntrypointOptions {
	argv?: string[];
	compiledFileName?: string;
}

export interface RunCapabilityHostCliOptions extends CapabilityHostCliEntrypointOptions {
	consoleError?: (error: unknown) => void;
	process?: { exitCode?: number };
}

export function isCapabilityHostCliEntrypoint(
	importMetaUrl: string,
	options: CapabilityHostCliEntrypointOptions = {},
): boolean {
	const argv = options.argv ?? process.argv;
	const scriptPath = argv[1];
	if (!scriptPath) return false;
	if (importMetaUrl === pathToFileURL(scriptPath).href) return true;
	return options.compiledFileName ? importMetaUrl.endsWith(`/${options.compiledFileName}`) : false;
}

export async function runCapabilityHostCli(
	importMetaUrl: string,
	createProgram: () => ParseableCapabilityHostProgram,
	options: RunCapabilityHostCliOptions = {},
): Promise<boolean> {
	const argv = options.argv ?? process.argv;
	if (
		!isCapabilityHostCliEntrypoint(importMetaUrl, {
			argv,
			compiledFileName: options.compiledFileName,
		})
	) {
		return false;
	}

	try {
		await createProgram().parseAsync(argv);
	} catch (error) {
		(options.consoleError ?? console.error)(error);
		(options.process ?? process).exitCode = 1;
	}
	return true;
}
