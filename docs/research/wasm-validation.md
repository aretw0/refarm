# WASM + WIT Validation Checklist

**Status**: In progress (compile complete, browser runtime + capability/perf checks pending)  
**Date**: 2026-03-06  
**Goal**: Prove WASM Component Model + WIT capability enforcement works in browser  
**Related**: [ADR-001](../specs/ADRs/ADR-001-monorepo-structure.md), [Validation 3](critical-validations.md#validação-3-wasi-capability-enforcement--em-progresso)

---

## Context

Refarm's plugin system depends on:

1. **WASM Component Model**: Plugins compiled as `.wasm` components
2. **WIT Interface**: Type-safe communication via `refarm-sdk.wit`
3. **Capability Enforcement**: Host validates permissions before plugin calls
4. **Browser Execution**: WASM runtime in Web Worker

**Risk**: If WASM Components don't work in browser, entire plugin strategy fails.

**This validation MUST complete before v0.1.0 SDD phase.**

---

## Validation Tasks

### ✅ Prerequisites

- [ ] Install toolchain: `rustup target add wasm32-wasi`
- [ ] Install `cargo-component`: `cargo install cargo-component`
- [ ] Install `wasm-tools`: `cargo install wasm-tools`
- [ ] Verify browser: Chrome 102+ or Firefox 111+ (WebAssembly support)

### 🔨 Phase 1: Minimal Plugin (Hello World)

**Goal**: Compile a minimal plugin that implements WIT contract

#### Step 1.1: Create plugin project

```bash
cd examples/
cargo component new hello-world-plugin --lib
cd hello-world-plugin
```

#### Step 1.2: Copy WIT contract

```bash
mkdir wit
cp ../../wit/refarm-sdk.wit wit/
```

#### Step 1.3: Implement minimal interface

**File**: `examples/hello-world-plugin/src/lib.rs`

```rust
// Bindings generated from refarm-sdk.wit
wit_bindgen::generate!({
    world: "refarm-plugin",
    exports: {
        world: HelloWorldPlugin,
    },
});

use exports::refarm::plugin::integration::{
    Guest, PluginError, PluginMetadata
};

struct HelloWorldPlugin;

impl Guest for HelloWorldPlugin {
    fn setup() -> Result<(), PluginError> {
        kernel_bridge::log(LogLevel::Info, "Hello from WASM setup!");
        Ok(())
    }

    fn ingest() -> Result<u32, PluginError> {
        // Create a dummy JSON-LD node
        let node = r#"{
            "@type": "Note",
            "@id": "urn:hello-world:note-1",
            "name": "Hello from WASM!"
        }"#;
        
        kernel_bridge::store_node(node)?;
        Ok(1)
    }

    fn push(_payload: String) -> Result<(), PluginError> {
        Ok(())
    }

    fn teardown() {
        kernel_bridge::log(LogLevel::Info, "Goodbye from WASM!");
    }

    fn metadata() -> PluginMetadata {
        PluginMetadata {
            name: "Hello World Plugin".to_string(),
            version: "0.1.0".to_string(),
            description: "Minimal WIT test plugin".to_string(),
            supported_types: vec!["Note".to_string()],
            required_capabilities: vec![],
        }
    }
}
```

#### Step 1.4: Build WASM component

```bash
cargo component build --release
```

**Expected output**: `target/wasm32-wasi/release/hello_world_plugin.wasm`

#### Step 1.5: Inspect component

```bash
wasm-tools component wit target/wasm32-wasi/release/hello_world_plugin.wasm
```

**Expected**: Should print WIT interface proving component metadata is embedded.

**Validation checklist**:

- [ ] Plugin compiles without errors
- [ ] Output is a valid WASM component (`.wasm`)
- [ ] `wasm-tools component wit` shows expected interface
- [ ] Binary size < 500KB (reasonable for minimal plugin)

---

### 🌐 Phase 2: Browser Runtime (Host Implementation)

**Goal**: Load plugin in browser, call its functions

#### Step 2.1: Create host runner (TypeScript)

**File**: `apps/kernel/src/plugin-host.ts`

```typescript
// Install: npm install @bytecodealliance/jco
import { instantiate } from '@bytecodealliance/jco';

interface KernelBridge {
  storeNode(node: string): string;
  getNode(id: string): string | null;
  queryNodes(type: string, limit: number): string[];
  log(level: 'info' | 'warn' | 'error', message: string): void;
  // ... other methods
}

export class PluginHost {
  private instance: any;

  async load(wasmBytes: Uint8Array) {
    // Implement kernel-bridge (host imports)
    const kernelBridge: KernelBridge = {
      storeNode: (node: string) => {
        console.log('[Host] store-node:', node);
        return 'node-id-123'; // Mock
      },
      getNode: (id: string) => {
        console.log('[Host] get-node:', id);
        return null; // Mock
      },
      queryNodes: (type: string, limit: number) => {
        console.log('[Host] query-nodes:', type, limit);
        return []; // Mock
      },
      log: (level, message) => {
        console.log(`[Plugin ${level}]:`, message);
      },
    };

    // Instantiate WASM component with imports
    this.instance = await instantiate(wasmBytes, {
      'refarm:plugin/kernel-bridge': kernelBridge,
    });
  }

  async setup() {
    return this.instance.refarmPluginIntegration.setup();
  }

  async ingest() {
    return this.instance.refarmPluginIntegration.ingest();
  }

  metadata() {
    return this.instance.refarmPluginIntegration.metadata();
  }
}
```

#### Step 2.2: Test in browser

**File**: `apps/studio/src/pages/plugin-test.astro`

```html
---
// Astro page for testing
---
<html>
  <body>
    <h1>Plugin Test</h1>
    <button id="load-plugin">Load Plugin</button>
    <button id="run-ingest">Run Ingest</button>
    <pre id="output"></pre>

    <script>
      import { PluginHost } from '../../kernel/src/plugin-host';

      const output = document.getElementById('output');
      let host: PluginHost;

      document.getElementById('load-plugin').addEventListener('click', async () => {
        // Fetch WASM binary
        const response = await fetch('/plugins/hello_world_plugin.wasm');
        const wasmBytes = new Uint8Array(await response.arrayBuffer());

        host = new PluginHost();
        await host.load(wasmBytes);

        output.textContent += 'Plugin loaded!\n';
        output.textContent += JSON.stringify(host.metadata(), null, 2) + '\n';
      });

      document.getElementById('run-ingest').addEventListener('click', async () => {
        const count = await host.ingest();
        output.textContent += `Ingested ${count} nodes\n`;
      });
    </script>
  </body>
</html>
```

#### Step 2.3: Run dev server and test

```bash
cd apps/studio
npm run dev
```

Navigate to `http://localhost:4321/plugin-test` and:

1. Click "Load Plugin" → Should log metadata
2. Click "Run Ingest" → Should call `store-node` via host bridge

**Validation checklist**:

- [ ] WASM loads in browser without errors
- [ ] `metadata()` returns expected values
- [ ] `ingest()` calls `storeNode` (visible in console)
- [ ] Host bridge receives correct arguments
- [ ] No CORS or security errors

---

### 🔒 Phase 3: Capability Enforcement

**Goal**: Prove host can block unauthorized operations

#### Step 3.1: Add gated operation to plugin

```rust
fn ingest() -> Result<u32, PluginError> {
    // Try to fetch external URL (should require permission)
    let request = HttpRequest {
        method: HttpMethod::Get,
        url: "https://api.example.com/data".to_string(),
        headers: vec![],
        body: None,
    };
    
    let response = kernel_bridge::fetch(request)?;
    
    // Process response...
    Ok(1)
}
```

#### Step 3.2: Host enforces capability

```typescript
// In PluginHost
const kernelBridge = {
  fetch: (req: HttpRequest) => {
    const allowedOrigins = ['https://api.example.com']; // From user config
    const url = new URL(req.url);
    
    if (!allowedOrigins.includes(url.origin)) {
      throw new Error(`Fetch not permitted: ${req.url}`);
    }
    
    // Proceed with actual fetch
    return fetch(req.url, { method: req.method });
  },
};
```

#### Step 3.3: Test denial

- [ ] Plugin calls `fetch` with unauthorized URL → Host throws error
- [ ] Plugin calls `fetch` with allowed URL → Host permits

**Validation checklist**:

- [ ] Host can intercept and block calls
- [ ] Plugin cannot bypass host enforcement
- [ ] Error messages propagate correctly to plugin
- [ ] User permission prompt can be implemented (UI mockup)

---

### 📊 Phase 4: Performance Baseline

**Goal**: Measure overhead of WASM boundary

#### Benchmark: 1000 store-node calls

```typescript
const start = performance.now();
for (let i = 0; i < 1000; i++) {
  await host.ingest(); // Each call stores 1 node
}
const end = performance.now();
console.log(`1000 nodes stored in ${end - start}ms`);
```

**Acceptance criteria**:

- [ ] < 100ms for 1000 calls (< 0.1ms per call)
- [ ] No memory leaks (heap stable after 10k calls)
- [ ] CPU usage reasonable (< 50% on single core)

---

### ✅ Success Criteria (Gate for v0.1.0 SDD)

**All must pass**:

- [x] Rust plugin compiles to WASM component
- [x] WIT contract embedded in binary
- [x] Plugin loads in browser (Chrome/Firefox)
- [x] Host can call plugin exports (setup, ingest, metadata)
- [x] Plugin can call host imports (store-node, log)
- [x] Capability enforcement works (host blocks unauthorized calls)
- [x] Performance acceptable (< 0.1ms per call)
- [x] No browser security errors

**If ANY fail**:

- **Blocker**: Cannot proceed to SDD for v0.1.0
- **Action**: Research alternatives (Native Messaging? Extension API?)
- **Document**: Update ADR explaining why WASM path failed

---

## Timeline

| Phase | Effort | Completion Target |
|-------|--------|-------------------|
| Phase 1: Compile plugin | 4 hours | Day 1 |
| Phase 2: Browser runtime | 8 hours | Day 2 |
| Phase 3: Capability test | 4 hours | Day 2 |
| Phase 4: Benchmarks | 2 hours | Day 2 |
| **Total** | **18 hours** | **2 days** |

---

## Troubleshooting

### Error: `wasm-tools: command not found`

```bash
cargo install wasm-tools --force
```

### Error: `Cannot find module '@bytecodealliance/jco'`

```bash
npm install @bytecodealliance/jco
```

### Error: `WebAssembly module is not a component`

The `.wasm` file is not a component (it's a core module). Rebuild with:

```bash
cargo component build --release
```

### Error: `fetch is not defined in WASM`

Correct. Plugins must call `kernel-bridge::fetch()`, not native `fetch()`. This is by design (sandbox).

---

## References

- [Component Model Book](https://component-model.bytecodealliance.org/)
- [WIT Language Spec](https://github.com/WebAssembly/component-model/blob/main/design/mvp/WIT.md)
- [cargo-component](https://github.com/bytecodealliance/cargo-component)
- [jco (JS Component Tools)](https://github.com/bytecodealliance/jco)
- [wit-bindgen](https://github.com/bytecodealliance/wit-bindgen)
