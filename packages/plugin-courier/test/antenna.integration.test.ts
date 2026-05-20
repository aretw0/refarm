import type { RuntimeQueryTarget } from "@refarm.dev/runtime";
import { describe, expect, it } from "vitest";
import { AntennaPlugin } from "../src/index";

function createQueryHost(nodes: Record<string, unknown>[] = []): RuntimeQueryTarget {
  return {
    async queryNodes() {
      return nodes;
    },
  };
}

describe("Antenna Plugin (SDD/BDD)", () => {
  it("GIVEN a public WebPage node in the graph, WHEN the Antenna receives a GET request for its route, THEN it should return materialistic HTML with 200 OK", async () => {
    const host = createQueryHost([{
      "@id": "refarm:node:webpage:1",
      "@type": "WebPage",
      "@context": "https://refarm.dev/ns/v1",
      name: "Landing Page",
      url: "/home",
      content: "This is the refarm homepage.",
    }]);

    const antenna = new AntennaPlugin(host, { enableEasterEggs: true });

    const req = new Request("http://localhost.refarm/home");
    const response = await antenna.handleRequest(req);

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/html");
    
    const html = await response.text();
    expect(html).toContain("Landing Page");
    expect(html).toContain("This is the refarm homepage.");
  });

  it("GIVEN the Easter Egg is enabled, WHEN a user requests the sovereign signal route, THEN it returns the ASCII art", async () => {
    const antenna = new AntennaPlugin(createQueryHost(), { enableEasterEggs: true });

    const req = new Request("http://localhost.refarm/.well-known/sovereign-signal");
    const response = await antenna.handleRequest(req);

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/plain");
    
    const body = await response.text();
    expect(body).toContain("R E F A R M   S O V E R E I G N");
    expect(body).toContain("You have intercepted the signal.");
  });

  it("GIVEN a request for a non-existent node, WHEN the Antenna processes it, THEN it returns 404", async () => {
    const antenna = new AntennaPlugin(createQueryHost());

    const req = new Request("http://localhost.refarm/ghosts-of-the-past");
    const response = await antenna.handleRequest(req);

    expect(response.status).toBe(404);
  });
});
