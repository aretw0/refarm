const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export interface SpinnerOptions {
	stream?: NodeJS.WriteStream;
	intervalMs?: number;
}

export interface ProgressIndicator {
	update(message: string): void;
	stop(): void;
}

export function startSpinner(message: string, options: SpinnerOptions = {}): () => void {
	const indicator = startProgressIndicator(message, options);
	return () => indicator.stop();
}

export function startProgressIndicator(
	message: string,
	options: SpinnerOptions = {},
): ProgressIndicator {
	const stream = options.stream ?? process.stdout;
	const intervalMs = options.intervalMs ?? 80;
	let i = 0;
	let currentMessage = message;
	let stopped = false;

	if (!stream.isTTY) {
		stream.write(`  ${currentMessage}\n`);
		return {
			update(nextMessage: string) {
				currentMessage = nextMessage;
				stream.write(`  ${currentMessage}\n`);
			},
			stop() {
				stopped = true;
			},
		};
	}

	const render = () => {
		stream.write(`\r\x1b[2K  ${FRAMES[i++ % FRAMES.length]} ${currentMessage}`);
	};
	render();
	const id = setInterval(render, intervalMs);

	return {
		update(nextMessage: string) {
			currentMessage = nextMessage;
			render();
		},
		stop() {
			if (stopped) return;
			stopped = true;
			clearInterval(id);
			stream.write("\r\x1b[2K");
		},
	};
}

export async function withProgress<T>(
	message: string,
	work: (progress: ProgressIndicator) => Promise<T>,
	options: SpinnerOptions = {},
): Promise<T> {
	const progress = startProgressIndicator(message, options);
	try {
		return await work(progress);
	} finally {
		progress.stop();
	}
}
