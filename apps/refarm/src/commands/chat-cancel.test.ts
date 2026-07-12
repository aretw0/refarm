import { EventEmitter } from "node:events";

import { describe, expect, it, vi } from "vitest";

import type { CancelEffortResult } from "./cancel-effort.js";
import { armEscapeCancel, createTurnCancelController, type KeypressStdin } from "./chat-cancel.js";

/** A fake stdin that emits keypress events, standing in for a TTY. */
function fakeStdin(isTTY = true): KeypressStdin & { press(name: string): void } {
	const em = new EventEmitter();
	return {
		isTTY,
		on: (event, listener) => em.on(event, listener as (...a: unknown[]) => void),
		off: (event, listener) => em.off(event, listener as (...a: unknown[]) => void),
		press: (name: string) => em.emit("keypress", "", { name }),
	};
}

describe("armEscapeCancel — the ESC keypress binding", () => {
	it("fires onEscape when Escape is pressed", () => {
		const stdin = fakeStdin();
		const onEscape = vi.fn();
		armEscapeCancel({ stdin, onEscape, emitKeypressEvents: () => {} });
		stdin.press("escape");
		expect(onEscape).toHaveBeenCalledTimes(1);
	});

	it("ignores other keys", () => {
		const stdin = fakeStdin();
		const onEscape = vi.fn();
		armEscapeCancel({ stdin, onEscape, emitKeypressEvents: () => {} });
		stdin.press("return");
		stdin.press("a");
		expect(onEscape).not.toHaveBeenCalled();
	});

	it("fires onEscape at most once per arm (a cancel is already in flight)", () => {
		const stdin = fakeStdin();
		const onEscape = vi.fn();
		armEscapeCancel({ stdin, onEscape, emitKeypressEvents: () => {} });
		stdin.press("escape");
		stdin.press("escape");
		expect(onEscape).toHaveBeenCalledTimes(1);
	});

	it("disarm() detaches — a later Escape does nothing", () => {
		const stdin = fakeStdin();
		const onEscape = vi.fn();
		const disarm = armEscapeCancel({ stdin, onEscape, emitKeypressEvents: () => {} });
		disarm();
		stdin.press("escape");
		expect(onEscape).not.toHaveBeenCalled();
	});

	it("disarm() is idempotent", () => {
		const stdin = fakeStdin();
		const disarm = armEscapeCancel({ stdin, onEscape: () => {}, emitKeypressEvents: () => {} });
		expect(() => {
			disarm();
			disarm();
		}).not.toThrow();
	});

	it("returns a no-op disarm on a non-TTY stdin (nothing to listen for)", () => {
		const stdin = fakeStdin(false);
		const onEscape = vi.fn();
		const disarm = armEscapeCancel({ stdin, onEscape, emitKeypressEvents: () => {} });
		stdin.press("escape"); // even if something emitted, no listener was attached
		expect(onEscape).not.toHaveBeenCalled();
		expect(() => disarm()).not.toThrow();
	});
});

describe("createTurnCancelController — ESC cancels the in-flight effort", () => {
	const ok: CancelEffortResult = { status: "cancelled", message: "Cancelled." };

	it("does nothing on Escape before the effort id is known", () => {
		const cancel = vi.fn(async () => ok);
		const ctl = createTurnCancelController({ cancel });
		ctl.onEscape(); // no effort yet
		expect(cancel).not.toHaveBeenCalled();
		expect(ctl.wasRequested()).toBe(false);
	});

	it("cancels the effort id on Escape once it is set", async () => {
		const cancel = vi.fn(async () => ok);
		const onResult = vi.fn();
		const ctl = createTurnCancelController({ cancel, onResult });
		ctl.setEffortId("eff-1");
		ctl.onEscape();
		expect(cancel).toHaveBeenCalledWith("eff-1");
		expect(ctl.wasRequested()).toBe(true);
		await vi.waitFor(() => expect(onResult).toHaveBeenCalledWith(ok));
	});

	it("cancels at most once even on repeated Escape", () => {
		const cancel = vi.fn(async () => ok);
		const ctl = createTurnCancelController({ cancel });
		ctl.setEffortId("eff-1");
		ctl.onEscape();
		ctl.onEscape();
		expect(cancel).toHaveBeenCalledTimes(1);
	});
});
