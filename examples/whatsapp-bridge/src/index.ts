/**
 * WhatsApp Bridge — Example Refarm Plugin
 *
 * Demonstrates how a plugin implements the `refarm:plugin/integration` WIT world.
 *
 * In a real Rust/WASM implementation this file would be auto-generated from the
 * WIT definitions.  This TypeScript version shows the same contract for
 * documentation and testing purposes.
 *
 * WIT world: refarm:plugin/refarm-plugin (see /wit/refarm-sdk.wit)
 */

// ─── Types mirroring the WIT interface ───────────────────────────────────────

/** Mirrors the `kernel-bridge` WIT import interface. */
export interface KernelBridge {
  storeNode(jsonLd: string): Promise<{ tag: "ok"; val: string } | { tag: "err"; val: PluginError }>;
  getNode(id: string): Promise<{ tag: "ok"; val: string } | { tag: "err"; val: PluginError }>;
  queryNodes(nodeType: string, limit: number): Promise<{ tag: "ok"; val: string[] } | { tag: "err"; val: PluginError }>;
  fetch(req: HttpRequest): Promise<{ tag: "ok"; val: HttpResponse } | { tag: "err"; val: PluginError }>;
  log(level: "debug" | "info" | "warn" | "error", message: string): void;
  requestPermission(capability: string, reason: string): boolean;
}

export interface HttpRequest {
  method: "get" | "post" | "put" | "patch" | "delete";
  url: string;
  headers: [string, string][];
  body: Uint8Array | null;
}

export interface HttpResponse {
  status: number;
  headers: [string, string][];
  body: Uint8Array;
}

export type PluginError =
  | { tag: "not-permitted"; val: string }
  | { tag: "not-found"; val: string }
  | { tag: "invalid-schema"; val: string }
  | { tag: "network-error"; val: string }
  | { tag: "internal"; val: string };

export interface PluginMetadata {
  name: string;
  version: string;
  description: string;
  supportedTypes: string[];
  requiredCapabilities: string[];
}

// ─── Plugin Implementation ────────────────────────────────────────────────────

/**
 * WhatsApp Bridge Plugin
 *
 * This class implements the `integration` WIT export interface.
 * The Kernel calls setup() → ingest() → teardown() in sequence.
 *
 * KEY CONSTRAINT: The plugin NEVER has direct access to:
 *   - window / document (DOM)
 *   - fetch() directly (must use bridge.fetch with capability grant)
 *   - SQLite connection (must use bridge.storeNode / bridge.queryNodes)
 */
export class WhatsAppBridgePlugin {
  private bridge: KernelBridge;

  constructor(bridge: KernelBridge) {
    this.bridge = bridge;
  }

  // ── WIT export: integration.setup ─────────────────────────────────────────

  async setup(): Promise<void> {
    this.bridge.log("info", "[whatsapp-bridge] setup() called");

    const granted = this.bridge.requestPermission(
      "network:https://api.whatsapp.example.com",
      "WhatsApp Bridge needs access to read your messages"
    );

    if (!granted) {
      throw new Error("Permission denied by user");
    }

    this.bridge.log("info", "[whatsapp-bridge] Permission granted ✓");
  }

  // ── WIT export: integration.ingest ────────────────────────────────────────

  async ingest(): Promise<number> {
    this.bridge.log("info", "[whatsapp-bridge] ingest() started");

    // 1. Fetch data through the kernel bridge (capability-gated)
    const fetchResult = await this.bridge.fetch({
      method: "get",
      url: "https://api.whatsapp.example.com/v1/messages",
      headers: [["Accept", "application/json"]],
      body: null,
    });

    if (fetchResult.tag === "err") {
      throw new Error(`Fetch failed: ${JSON.stringify(fetchResult.val)}`);
    }

    const rawData = JSON.parse(
      new TextDecoder().decode(fetchResult.val.body)
    ) as { messages: RawMessage[]; contacts: RawContact[] };

    let stored = 0;

    // 2. Normalise contacts to JSON-LD Person nodes
    for (const contact of rawData.contacts ?? []) {
      const node = normaliseContact(contact);
      const result = await this.bridge.storeNode(JSON.stringify(node));
      if (result.tag === "ok") stored++;
      else this.bridge.log("warn", `[whatsapp-bridge] Failed to store contact: ${JSON.stringify(result.val)}`);
    }

    // 3. Normalise messages to JSON-LD Message nodes
    for (const msg of rawData.messages ?? []) {
      const node = normaliseMessage(msg);
      const result = await this.bridge.storeNode(JSON.stringify(node));
      if (result.tag === "ok") stored++;
      else this.bridge.log("warn", `[whatsapp-bridge] Failed to store message: ${JSON.stringify(result.val)}`);
    }

    this.bridge.log("info", `[whatsapp-bridge] Stored ${stored} nodes`);
    return stored;
  }

  // ── WIT export: integration.push ──────────────────────────────────────────

  async push(payload: string): Promise<void> {
    this.bridge.log("info", "[whatsapp-bridge] push() called");
    const node = JSON.parse(payload) as { "@type": string; text?: string };

    if (node["@type"] !== "Message" || !node.text) {
      throw new Error("push: unsupported payload type");
    }

    // TODO: POST to WhatsApp API via bridge.fetch
    this.bridge.log("info", `[whatsapp-bridge] Would send message: "${node.text}"`);
  }

  // ── WIT export: integration.teardown ──────────────────────────────────────

  teardown(): void {
    this.bridge.log("info", "[whatsapp-bridge] teardown()");
  }

  // ── WIT export: integration.metadata ─────────────────────────────────────

  metadata(): PluginMetadata {
    return {
      name: "WhatsApp Bridge",
      version: "1.0.0",
      description: "Ingests WhatsApp messages and contacts into the Refarm sovereign graph",
      supportedTypes: ["Message", "Person"],
      requiredCapabilities: ["network:https://api.whatsapp.example.com"],
    };
  }
}

// ─── Normalisation Helpers ────────────────────────────────────────────────────

interface RawContact {
  wa_id: string;
  name: string;
  phone: string;
}

interface RawMessage {
  id: string;
  from_wa_id: string;
  body: string;
  timestamp: number;
}

/** Normalise a raw WhatsApp contact to a JSON-LD Person node. */
function normaliseContact(raw: RawContact) {
  return {
    "@context": "https://schema.org/",
    "@type": "Person",
    "@id": `urn:whatsapp-bridge:contact-${raw.wa_id}`,
    name: raw.name,
    telephone: raw.phone,
    "refarm:sourcePlugin": "whatsapp-bridge",
    "refarm:ingestedAt": new Date().toISOString(),
    "refarm:rawReference": {
      "@type": "refarm:RawCapture",
      "refarm:pluginPayload": raw,
      "refarm:capturedAt": new Date().toISOString(),
    },
  };
}

/** Normalise a raw WhatsApp message to a JSON-LD Message node. */
function normaliseMessage(raw: RawMessage) {
  return {
    "@context": "https://schema.org/",
    "@type": "Message",
    "@id": `urn:whatsapp-bridge:msg-${raw.id}`,
    text: raw.body,
    dateSent: new Date(raw.timestamp * 1000).toISOString(),
    sender: {
      "@type": "Person",
      "@id": `urn:whatsapp-bridge:contact-${raw.from_wa_id}`,
    },
    "refarm:sourcePlugin": "whatsapp-bridge",
    "refarm:ingestedAt": new Date().toISOString(),
  };
}

export default WhatsAppBridgePlugin;
