import { createInMemoryStorageProvider } from "@refarm.dev/storage-contract-v1";
import { createNodeView } from "@refarm.dev/storage-node-view";
import { describe, expect, it } from "vitest";

import { graphToSvg } from "./svg.js";
import { getConnections, traverseGraph, type SovereignNode } from "./traverse.js";

/**
 * The sovereign-graph axis proven against the REAL store — not the in-memory fake from the unit
 * test, but a genuine NodeView over a genuine StorageProvider. This is the canonical consumer that
 * forces the traversal to work end to end: store nodes → query by @type → resolve edges from a
 * connection field → {nodes,links} → SVG. If the store-of-truth path breaks, this fails.
 */

const resolveConnections = (node: SovereignNode): string[] =>
	Array.isArray(node.related) ? (node.related as string[]) : [];

describe("traverseGraph over a real NodeView + StorageProvider (sovereign axis, e2e)", () => {
	async function seededView() {
		const view = createNodeView(createInMemoryStorageProvider());
		await view.storeNode({
			"@context": "https://refarm.dev/contexts/records/v1",
			"@type": "Requirement",
			"@id": "req:rn1",
			title: "Identificador do CNPJ",
			related: ["req:rn2", "req:cdu1"],
		});
		await view.storeNode({
			"@context": "https://refarm.dev/contexts/records/v1",
			"@type": "Requirement",
			"@id": "req:rn2",
			title: "Formato do CNPJ",
			related: ["req:cdu1"],
		});
		await view.storeNode({
			"@context": "https://refarm.dev/contexts/records/v1",
			"@type": "Requirement",
			"@id": "req:cdu1",
			title: "Receber Aviso",
			related: ["req:rn1"],
		});
		return view;
	}

	it("traverses stored nodes into a graph with stats", async () => {
		const view = await seededView();
		// The real NodeView satisfies NodeSource structurally — no adapter.
		const graph = await traverseGraph(view, { types: "Requirement", resolveConnections });
		expect(graph.nodes.map((n) => n.id).sort()).toEqual(["req:cdu1", "req:rn1", "req:rn2"]);
		expect(graph.stats.nodeCount).toBe(3);
		expect(graph.stats.edgeCount).toBe(4); // rn1→rn2, rn1→cdu1, rn2→cdu1, cdu1→rn1
		// rn1 is the hub (out 2 + in 1).
		expect(graph.nodes.find((n) => n.id === "req:rn1")?.degree).toBe(3);
	});

	it("renders the stored graph to SVG (store → traverse → layout → SVG)", async () => {
		const view = await seededView();
		const graph = await traverseGraph(view, { types: "Requirement", resolveConnections });
		const svg = graphToSvg(graph, {
			labelFor: (id) => graph.byId.get(id)?.title as string,
			title: `Grafo Soberano (${graph.stats.nodeCount})`,
		});
		expect(svg).toContain("<svg");
		expect((svg.match(/<circle/g) ?? []).length).toBe(3);
		expect(svg).toContain(">Identificador do CNPJ<");
	});

	it("get-connections reads one stored node's neighbors from the store", async () => {
		const view = await seededView();
		const conns = await getConnections(view, "req:rn1", { types: "Requirement", resolveConnections });
		expect(conns.outgoing.sort()).toEqual(["req:cdu1", "req:rn2"]);
		expect(conns.incoming).toEqual(["req:cdu1"]);
	});
});
