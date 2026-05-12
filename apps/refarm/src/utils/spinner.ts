const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export function startSpinner(message: string): () => void {
	let i = 0;
	process.stdout.write(`  ${FRAMES[0]} ${message}`);
	const id = setInterval(() => {
		process.stdout.write(`\r  ${FRAMES[i++ % FRAMES.length]} ${message}`);
	}, 80);
	return () => {
		clearInterval(id);
		process.stdout.write("\r\x1b[2K"); // clear the spinner line
	};
}
