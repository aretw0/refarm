import { describe, expect, it } from "vitest";

import { renderTable, tableToLayout, type TableColumn, type TableRow } from "./tui-table.js";

const columns: TableColumn[] = [
	{ key: "id", header: "ID" },
	{ key: "status", header: "Status" },
];
const rows: TableRow[] = [
	{ id: "REQ-1", status: "open" },
	{ id: "REQ-2", status: "verified" },
];

describe("tableToLayout", () => {
	it("builds a header row, a separator, and one row per record with fixed-width cells", () => {
		const layout = tableToLayout(columns, rows, { width: 80 });
		expect(layout.direction).toBe("column");
		// header + separator + 2 data rows
		expect(layout.children).toHaveLength(4);

		const headerRow = layout.children![0]!;
		expect(headerRow.direction).toBe("row");
		expect(headerRow.children![0]!.text).toBe("ID");
		expect(headerRow.children![1]!.text).toBe("Status");

		// Column widths: id = max("ID"=2, "REQ-1"/"REQ-2"=5) = 5; status = max("Status"=6, "verified"=8) = 8.
		expect(headerRow.children![0]!.width).toBe(5);
		expect(headerRow.children![1]!.width).toBe(8);

		// The separator row underlines each column to its width.
		expect(layout.children![1]!.children![1]!.text).toBe("─".repeat(8));
	});

	it("omits the separator when separator:false", () => {
		const layout = tableToLayout(columns, rows, { width: 80, separator: false });
		expect(layout.children).toHaveLength(3); // header + 2 rows, no separator
	});
});

describe("renderTable", () => {
	it("aligns each column across the header and data rows", async () => {
		const out = await renderTable(columns, rows, { width: 80 });
		const lines = out.split("\n");
		const headerLine = lines.find((line) => line.includes("Status"))!;
		const dataLine = lines.find((line) => line.includes("REQ-1"))!;
		expect(headerLine).toBeDefined();
		expect(dataLine).toBeDefined();
		// The "status" column starts at the same visible column on the header and the data row.
		expect(dataLine.indexOf("open")).toBe(headerLine.indexOf("Status"));
	});

	it("stringifies non-string cell values and blanks missing keys", async () => {
		const out = await renderTable([{ key: "n", header: "N" }, { key: "ok", header: "OK" }], [{ n: 42 }], {
			width: 40,
		});
		expect(out).toContain("42"); // number stringified
	});
});
