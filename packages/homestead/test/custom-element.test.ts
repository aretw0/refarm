/** @vitest-environment jsdom */
import { describe, expect, it, vi } from "vitest";
import {
	connectHomesteadReactiveElement,
	defineHomesteadReactiveElement,
	type HomesteadReactiveElement,
} from "../src/sdk/custom-element";

describe("defineHomesteadReactiveElement", () => {
	it("defines a reusable lifecycle boundary for live Homestead islands", () => {
		const disposeFirst = vi.fn();
		const disposeSecond = vi.fn();
		const connect = vi
			.fn()
			.mockReturnValueOnce({ dispose: disposeFirst })
			.mockReturnValueOnce({ dispose: disposeSecond });

		defineHomesteadReactiveElement({
			name: "refarm-test-reactive-element",
			connect,
		});
		defineHomesteadReactiveElement({
			name: "refarm-test-reactive-element",
			connect,
		});

		const element = document.createElement(
			"refarm-test-reactive-element",
		) as HomesteadReactiveElement<{ label: string }>;
		document.body.appendChild(element);

		const first = connectHomesteadReactiveElement(element, { label: "first" });
		const second = connectHomesteadReactiveElement(element, {
			label: "second",
		});

		expect(connect).toHaveBeenCalledTimes(2);
		expect(connect).toHaveBeenNthCalledWith(1, element, { label: "first" });
		expect(connect).toHaveBeenNthCalledWith(2, element, { label: "second" });
		expect(first).not.toBe(second);
		expect(disposeFirst).toHaveBeenCalledTimes(1);
		document.body.removeChild(element);
		expect(disposeSecond).toHaveBeenCalledTimes(1);
	});
});
