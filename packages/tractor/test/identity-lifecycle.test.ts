import { beforeEach, describe, expect, it } from "vitest";
import { Tractor } from "../src/index";
import { MockIdentityAdapter, MockStorageAdapter } from "./test-utils";

describe("Tractor Identity Lifecycle & Mandatory Signing", () => {
  let storage: MockStorageAdapter;
  let identity: MockIdentityAdapter;
  let tractor: Tractor;

  beforeEach(async () => {
    storage = new MockStorageAdapter();
    identity = new MockIdentityAdapter();
    identity.publicKey = undefined; // Force Visitor mode
    
    tractor = await Tractor.boot({
      storage,
      identity,
    });
  });

  it("should start in Visitor mode (no keys) and block storeNode", async () => {
    const node = {
      "@context": "https://schema.org/",
      "@type": "Note",
      "@id": "urn:refarm:test:1",
      "text": "Hello Visitor"
    };

    // Should throw because no ephemeral key is generated yet
    await expect(tractor.storeNode(node)).rejects.toThrow(
      "[tractor] Action blocked: You must be in Guest or Permanent mode to sign and store data."
    );
  });

  it("should transition to Guest mode and sign nodes", async () => {
    // 1. Enable Guest Mode
    const pubKey = await tractor.enableGuestMode();
    expect(pubKey).toBeDefined();
    expect(pubKey.length).toBeGreaterThan(0);

    // 2. Store a node
    const node = {
      "@context": "https://schema.org/",
      "@type": "Note",
      "@id": "urn:refarm:test:2",
      "text": "Hello Guest"
    };

    await tractor.storeNode(node);

    // 3. Verify signing
    const storedNodes = await storage.queryNodes("Note");
    expect(storedNodes.length).toBe(1);
    
    const storedNode = JSON.parse(storedNodes[0].payload);
    expect(storedNode["refarm:signature"]).toBeDefined();
    expect(storedNode["refarm:signature"].pubkey).toBe(pubKey);
    expect(storedNode["refarm:signature"].alg).toBe("ed25519");
    expect(storedNode["refarm:signature"].sig).toBeDefined();
  });

  it("should maintain the same identity once enabled", async () => {
    const firstPubKey = await tractor.enableGuestMode();
    const secondPubKey = await tractor.enableGuestMode();
    
    expect(firstPubKey).toBe(secondPubKey);
  });

  it("should allow connecting a permanent identity and generate IdentityConversion", async () => {
    // 1. Start as Guest
    const guestPubKey = await tractor.enableGuestMode();
    
    // 2. Connect Permanent Identity
    const permanentIdentity = new MockIdentityAdapter();
    permanentIdentity.publicKey = "did:nostr:pubkey_permanent_123";
    
    await tractor.connectIdentity(permanentIdentity);
    
    // 3. Verify identity change
    expect(tractor.identity.publicKey).toBe("did:nostr:pubkey_permanent_123");
    
    // 4. Verify IdentityConversion node was generated and stored
    const allConversions = await storage.queryNodes("IdentityConversion");
    expect(allConversions.length).toBe(1);
    
    const conversionNode = JSON.parse(allConversions[0].payload);
    expect(conversionNode["@type"]).toBe("IdentityConversion");
    expect(conversionNode.guestPubkey).toBe(guestPubKey);
    expect(conversionNode.permanentPubkey).toBe("did:nostr:pubkey_permanent_123");
    
    // It should be signed by the permanent identity (final signature)
    expect(conversionNode["refarm:signature"]).toBeDefined();
    expect(conversionNode["refarm:signature"].pubkey).toBe("did:nostr:pubkey_permanent_123");

    // 5. Storing a new node should now use the permanent identity
    const node = {
      "@context": "https://schema.org/",
      "@type": "Note",
      "@id": "urn:refarm:test:3",
      "text": "Hello Permanent"
    };

    await tractor.storeNode(node);

    // 6. Verify signing with permanent identity
    const allNotes = await storage.queryNodes("Note");
    const permanentNote = JSON.parse(allNotes.find((n: any) => n.id === "urn:refarm:test:3").payload);
    
    expect(permanentNote["refarm:signature"]).toBeDefined();
    expect(permanentNote["refarm:signature"].pubkey).toBe("did:nostr:pubkey_permanent_123");
    expect(permanentNote["refarm:signature"].alg).toBe("external");
    expect(permanentNote["refarm:signature"].sig).toBe("delegated");
  });
});
