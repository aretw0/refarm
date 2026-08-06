import type { NormalisedNode } from "@refarm.dev/node-contract-v1";
import type { SidecarGraphClient } from "../src/index.js";

async function acceptsSidecarGraphClient(
	client: SidecarGraphClient,
): Promise<void> {
	const node: NormalisedNode | null = await client.getNode("urn:node:one");
	const { nodes, stored, truncated } = await client.queryNodes("Config");
	const typedNodes: NormalisedNode[] = nodes;
	// `stored`/`truncated` must stay optional/undefined-shaped at the type
	// level — a caller cannot be handed `false`/`nodes.length` as if they
	// were known. See QueryGraphNodesResult's doc in src/index.ts.
	const typedStored: number | undefined = stored;
	const typedTruncated: boolean | undefined = truncated;
	void node;
	void typedNodes;
	void typedStored;
	void typedTruncated;
}

void acceptsSidecarGraphClient;
