import {
	createPrompt,
	isEnterKey,
	makeTheme,
	useKeypress,
	usePrefix,
	useState,
} from "@inquirer/core";

export interface SecretInputConfig {
	message: string;
	/** Number of trailing characters to keep visible. Default: 4. */
	visibleTail?: number;
}

function maskWithTail(value: string, visible: number): string {
	if (value.length <= visible) return "•".repeat(value.length);
	return "•".repeat(value.length - visible) + value.slice(-visible);
}

/**
 * Password-style prompt that shows the last N characters of the value in
 * real-time — matching the convention used by tools like Claude Code.
 * The full value is captured silently; only the tail is displayed.
 */
export const secretInput = createPrompt<string, SecretInputConfig>(
	(config, done) => {
		const visible = config.visibleTail ?? 4;
		const theme = makeTheme({});
		const [value, setValue] = useState("");
		const [status, setStatus] = useState<"idle" | "done">("idle");
		const prefix = usePrefix({ status, theme });

		useKeypress((key, rl) => {
			if (status !== "idle") return;
			if (isEnterKey(key)) {
				setStatus("done");
				done(value);
			} else {
				setValue(rl.line);
			}
		});

		const masked = maskWithTail(value, visible);
		const message = theme.style.message(config.message, status);
		const displayValue =
			status === "done" ? theme.style.answer(masked) : masked;

		return [`${prefix} ${message} ${displayValue}`, undefined];
	},
);
