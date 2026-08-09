import { describe, expect, it } from "vitest";
import type { WorkItem, WorkItemAdapter } from "./contract.js";

export interface AdapterContractFixture {
	/** An id that already exists in the backing document. */
	existingId: string;
	/** How many items the backing document holds. */
	count: number;
	/** A NEW item this backend must accept. */
	newItem: WorkItem;
	/** Fields the document carries that the contract does not know. */
	expectedExtraFields: string[];
}

/** EVERY adapter must pass this suite. A contract that passes with only one fixture has failed —
 * that is the whole reason this is a function and not a test file. */
export function describeAdapterContract(
	name: string,
	makeAdapter: () => WorkItemAdapter,
	fixture: AdapterContractFixture,
): void {
	describe(`work-item adapter contract: ${name}`, () => {
		it("lists every item in the document", () => {
			const result = makeAdapter().list();
			expect(result.ok).toBe(true);
			expect(result.items).toHaveLength(fixture.count);
			expect(result.error).toBeNull();
		});

		it("reports unknown fields as extras rather than failing", () => {
			const result = makeAdapter().list();
			expect(result.extraFields.sort()).toEqual([...fixture.expectedExtraFields].sort());
		});

		it("declares a support state for every contract field", () => {
			const table = makeAdapter().capabilities();
			for (const field of Object.values(table)) {
				expect(["native", "emulated", "unsupported"]).toContain(field);
			}
		});

		it("refuses a duplicate id instead of writing it", () => {
			const adapter = makeAdapter();
			const result = adapter.add({ ...fixture.newItem, id: fixture.existingId });
			expect(result.ok).toBe(false);
			expect(result.error?.reason).toBe("duplicate_id");
			expect(adapter.list().items).toHaveLength(fixture.count);
		});

		it("adds an item and reads it back", () => {
			const adapter = makeAdapter();
			expect(adapter.add(fixture.newItem).ok).toBe(true);
			const read = adapter.list();
			expect(read.items).toHaveLength(fixture.count + 1);
			expect(read.items.find((item) => item.id === fixture.newItem.id)?.title).toBe(
				fixture.newItem.title,
			);
		});

		it("refuses resolve without resolvedBy", () => {
			const adapter = makeAdapter();
			const result = adapter.setStatus(fixture.existingId, "resolved");
			expect(result.ok).toBe(false);
			expect(result.error?.reason).toBe("resolved_by_required");
		});

		it("resolves with resolvedBy", () => {
			const adapter = makeAdapter();
			const result = adapter.setStatus(fixture.existingId, "resolved", "abc1234");
			expect(result.ok).toBe(true);
			expect(result.item?.status).toBe("resolved");
			expect(result.item?.resolvedBy).toBe("abc1234");
		});

		it("refuses an unknown id", () => {
			const result = makeAdapter().setStatus("no-such-id-xyz", "deferred");
			expect(result.ok).toBe(false);
			expect(result.error?.reason).toBe("unknown_id");
		});

	});
}
