/**
 * Matrix Bridge — Example Refarm Plugin
 *
 * Demonstrates how a plugin implements the `refarm:plugin/integration` WIT world.
 * This TypeScript version shows the contract for documentation and testing purposes.
 *
 * In a real Rust/Go→WASM implementation, bindings would be auto-generated from WIT.
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
 * Matrix Bridge Plugin
 *
 * This class implements the `integration` WIT export interface.
 * The Kernel calls setup() → ingest() → teardown() in sequence.
 *
 * KEY CONSTRAINT: The plugin NEVER has direct access to:
 *   - window / document (DOM)
 *   - fetch() directly (must use bridge.fetch with capability grant)
 *   - SQLite connection (must use bridge.storeNode / bridge.queryNodes)
 *
 * Security model: All network operations must request capability grants first.
 */
export class MatrixBridgePlugin {
  private bridge: KernelBridge;
  private homeserverUrl: string = "";

  constructor(bridge: KernelBridge) {
    this.bridge = bridge;
  }

  // ── WIT export: integration.setup ─────────────────────────────────────────
  // Security: Request capability to access a Matrix homeserver

  async setup(): Promise<void> {
    this.bridge.log("info", "[matrix-bridge] setup() called");

    // In a real scenario, the homeserver URL would come from user configuration
    // For now, we request generic Matrix homeserver access
    const granted = this.bridge.requestPermission(
      "network:matrix://homeserver",
      "Matrix Bridge needs access to sync messages and user profiles from your homeserver(s)"
    );

    if (!granted) {
      throw new Error("Permission denied by user");
    }

    this.bridge.log("info", "[matrix-bridge] Homeserver capability granted ✓");
  }

  // ── WIT export: integration.ingest ────────────────────────────────────────
  // Fetches rooms, members, and recent messages from Matrix

  async ingest(): Promise<number> {
    this.bridge.log("info", "[matrix-bridge] ingest() started");

    // 1. Fetch joined rooms (requires prior /sync and access token)
    // For this example, we'll fetch public rooms as proof-of-concept
    const roomsResult = await this.bridge.fetch({
      method: "get",
      url: "https://matrix.org/_matrix/client/v3/publicRooms",
      headers: [["Accept", "application/json"]],
      body: null,
    });

    if (roomsResult.tag === "err") {
      throw new Error(`Fetch rooms failed: ${JSON.stringify(roomsResult.val)}`);
    }

    const rawRooms = JSON.parse(
      new TextDecoder().decode(roomsResult.val.body)
    ) as { chunk: MatrixRoom[] };

    let stored = 0;

    // 2. For each room, extract metadata and recent messages
    for (const room of rawRooms.chunk ?? []) {
      const roomNode = normaliseRoom(room);
      const result = await this.bridge.storeNode(JSON.stringify(roomNode));
      if (result.tag === "ok") stored++;
      else this.bridge.log("warn", `[matrix-bridge] Failed to store room: ${JSON.stringify(result.val)}`);

      // 3. Extract members as Person nodes
      if (room.avatar_url) {
        const memberNode = normaliseMember(room);
        const memberResult = await this.bridge.storeNode(JSON.stringify(memberNode));
        if (memberResult.tag === "ok") stored++;
        else this.bridge.log("warn", `[matrix-bridge] Failed to store member: ${JSON.stringify(memberResult.val)}`);
      }
    }

    this.bridge.log("info", `[matrix-bridge] Stored ${stored} nodes`);
    return stored;
  }

  // ── WIT export: integration.push ──────────────────────────────────────────
  // Sends a message to a Matrix room

  async push(payload: string): Promise<void> {
    this.bridge.log("info", "[matrix-bridge] push() called");
    const node = JSON.parse(payload) as {
      "@type": string;
      text?: string;
      "refarm:matrixRoom"?: string;
    };

    if (node["@type"] !== "Message" || !node.text) {
      throw new Error("push: unsupported payload type");
    }

    const roomId = node["refarm:matrixRoom"] || "!example:matrix.org";

    // In a real implementation, this would use the Matrix client API
    // For now, we log the intent
    this.bridge.log("info", `[matrix-bridge] Would send to room ${roomId}: "${node.text}"`);
  }

  // ── WIT export: integration.teardown ──────────────────────────────────────

  teardown(): void {
    this.bridge.log("info", "[matrix-bridge] teardown()");
  }

  // ── WIT export: integration.metadata ─────────────────────────────────────

  metadata(): PluginMetadata {
    return {
      name: "Matrix Bridge",
      version: "1.0.0",
      description: "Ingests Matrix room messages and member profiles into the Refarm sovereign graph",
      supportedTypes: ["Message", "Person", "ChatRoom"],
      requiredCapabilities: ["network:matrix://homeserver"],
    };
  }
}

// ─── Normalisation Helpers ────────────────────────────────────────────────────

interface MatrixRoom {
  room_id: string;
  name?: string;
  topic?: string;
  avatar_url?: string;
  num_joined_members: number;
}

interface MatrixMember {
  user_id: string;
  displayname?: string;
  avatar_url?: string;
}

/** Normalise a Matrix room to a JSON-LD ChatRoom node. */
function normaliseRoom(raw: MatrixRoom) {
  return {
    "@context": "https://schema.org/",
    "@type": "ChatRoom",
    "@id": `urn:matrix-bridge:room-${encodeURIComponent(raw.room_id)}`,
    name: raw.name || raw.room_id,
    description: raw.topic,
    image: raw.avatar_url,
    "refarm:sourcePlugin": "matrix-bridge",
    "refarm:ingestedAt": new Date().toISOString(),
    "refarm:matrixRoomId": raw.room_id,
    "refarm:memberCount": raw.num_joined_members,
  };
}

/** Normalise a Matrix room as proxy for member (when member info not available). */
function normaliseMember(raw: MatrixRoom) {
  return {
    "@context": "https://schema.org/",
    "@type": "Person",
    "@id": `urn:matrix-bridge:room-admin-${encodeURIComponent(raw.room_id)}`,
    name: `${raw.name || "Unknown"} (room)`,
    image: raw.avatar_url,
    "refarm:sourcePlugin": "matrix-bridge",
    "refarm:ingestedAt": new Date().toISOString(),
  };
}

export default MatrixBridgePlugin;
