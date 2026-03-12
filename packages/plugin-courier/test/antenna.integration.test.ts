import { Tractor } from "@refarm.dev/tractor";
import { MockIdentityAdapter, MockStorageAdapter } from "@refarm.dev/tractor/test/test-utils";
import { describe, expect, it } from "vitest";
import { AntennaPlugin } from "../src/index";

describe("Antenna Plugin (SDD/BDD)", () => {
  it("GIVEN a public WebPage node in the graph, WHEN the Antenna receives a GET request for its route, THEN it should return materialistic HTML with 200 OK", async () => {
    // 1. Setup the Tractor Engine
    const mockStorage = new MockStorageAdapter();
    const mockIdentity = new MockIdentityAdapter();
    const tractor = await Tractor.boot({ storage: mockStorage, identity: mockIdentity, namespace: "test-courier" });

    // 2. Plant the Sovereign Seed (Store the WebPage node)
    await tractor.storeNode({
      "@id": "refarm:node:webpage:1",
      "@type": "WebPage",
      "@context": "https://refarm.dev/ns/v1",
      name: "Sovereign Landing Page",
      url: "/home",
      content: "This is the refarm homepage.",
    });

    // 3. Initialize the Antenna
    const antenna = new AntennaPlugin(tractor, { enableEasterEggs: true });

    // 4. Fire the HttpRequest
    const req = new Request("http://localhost.refarm/home");
    const response = await antenna.handleRequest(req);

    // 5. Verify the Harvest
    
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/html");
    
    const html = await response.text();
    expect(html).toContain("Sovereign Landing Page");
    expect(html).toContain("This is the refarm homepage.");

    await tractor.shutdown();
  });

  it("GIVEN the Easter Egg is enabled, WHEN a user requests the sovereign signal route, THEN it returns the ASCII art", async () => {
    const tractor = await Tractor.boot({ storage: new MockStorageAdapter(), identity: new MockIdentityAdapter(), namespace: "test-courier-easter" });
    const antenna = new AntennaPlugin(tractor, { enableEasterEggs: true });

    const req = new Request("http://localhost.refarm/.well-known/sovereign-signal");
    const response = await antenna.handleRequest(req);

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/plain");
    
    const body = await response.text();
    expect(body).toContain("R E F A R M   S O V E R E I G N");
    expect(body).toContain("You have intercepted the signal.");

    await tractor.shutdown();
  });

  it("GIVEN a request for a non-existent node, WHEN the Antenna processes it, THEN it returns 404", async () => {
    const tractor = await Tractor.boot({ storage: new MockStorageAdapter(), identity: new MockIdentityAdapter(), namespace: "test-courier-404" });
    const antenna = new AntennaPlugin(tractor);

    const req = new Request("http://localhost.refarm/ghosts-of-the-past");
    const response = await antenna.handleRequest(req);

    expect(response.status).toBe(404);
    
    await tractor.shutdown();
  });
});
