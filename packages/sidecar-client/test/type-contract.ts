import type { NormalisedNode } from "@refarm.dev/node-contract-v1";
import type { SidecarGraphClient } from "../src/index.js";

async function acceptsSidecarGraphClient(
	client: SidecarGraphClient,
): Promise<void> {
	const node: NormalisedNode | null = await client.getNode("urn:node:one");
	const nodes: NormalisedNode[] = await client.queryNodes("Config");
	void node;
	void nodes;
}

void acceptsSidecarGraphClient;
