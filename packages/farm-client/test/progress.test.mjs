import assert from "node:assert/strict";
import { test } from "node:test";
import { createSpinner, formatSpinnerLine, SPINNER_FRAMES } from "../src/progress.mjs";

/** A fake stream that records writes, so we can assert on the spinner's output. */
function fakeStream(isTTY) {
	const writes = [];
	return { isTTY, writes, write: (s) => (writes.push(s), true) };
}

test("formatSpinnerLine omits elapsed under 1s, shows it after", () => {
	assert.equal(formatSpinnerLine("⠋", "aguardando", 0), "⠋ aguardando");
	assert.equal(formatSpinnerLine("⠙", "aguardando", 5), "⠙ aguardando (5s)");
});

test("a non-TTY stream stays completely silent (no escape codes in a pipe/log)", () => {
	const stream = fakeStream(false);
	const spinner = createSpinner({ stream, label: "x" }).start();
	spinner.setLabel("y");
	spinner.stop();
	assert.deepEqual(stream.writes, []);
});

test("a non-TTY stop still prints a final line when asked", () => {
	const stream = fakeStream(false);
	createSpinner({ stream }).start("x").stop("pronto");
	assert.deepEqual(stream.writes, ["pronto\n"]);
});

test("a TTY stream paints the label immediately and clears on stop", () => {
	const stream = fakeStream(true);
	const spinner = createSpinner({ stream, label: "aguardando", now: () => 0 }).start();
	// one immediate paint carrying the first frame + label
	assert.equal(stream.writes.length, 1);
	assert.ok(stream.writes[0].includes("aguardando"));
	assert.ok(stream.writes[0].startsWith("\r"));
	assert.ok(stream.writes[0].includes(SPINNER_FRAMES[0]));
	spinner.stop();
	// stop clears the line
	assert.ok(stream.writes.at(-1).includes("\x1b[K"));
});

test("start is idempotent and stop is safe to call without start", () => {
	const stream = fakeStream(true);
	const spinner = createSpinner({ stream, now: () => 0 });
	spinner.stop(); // no throw before start
	spinner.start("a");
	const afterFirst = stream.writes.length;
	spinner.start("b"); // second start is a no-op (already running)
	assert.equal(stream.writes.length, afterFirst);
	spinner.stop();
});
