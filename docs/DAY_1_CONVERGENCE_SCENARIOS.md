# Refarm Day 1 Convergence Scenarios

**Purpose**: Demonstrate that Refarm's architecture can evolve into ambitious use cases without breaking its foundations. Think of this as the "stretch goals" that validate architectural choices.

---

## Philosophy: Start Strong, Not Complete

> "You don't build a game engine on Day 1. But you should build a foundation that COULD become a game engine without rewriting everything."

**This document is NOT a roadmap.** These are **thought experiments** to validate that:

1. Offline-first + CRDT + Plugin architecture can handle these
2. We're not painting ourselves into a corner
3. When someone builds these, they won't fight the system

---

## Scenario 1: Collaborative Diagram Editor (Miro/Figma-like)

**User Story**:
> "I want 50 people editing a flowchart in real-time, some logged in, some as guests, some offline. Changes should sync instantly when online. Offline users should see what they can edit, and merge cleanly when back online."

### What Refarm Provides Today (v0.1.0)

✅ **Sovereign Graph**: Nodes as diagram elements (boxes, arrows, text)  
✅ **CRDT Sync**: Yjs handles concurrent edits (position, text, style)  
✅ **Offline-First**: Guest can edit offline, merge later  
✅ **Identity**: Guest mode + persistent identity (Nostr or anonymous)

### What We'd Need (v0.2.0-0.3.0)

⚠️ **Canvas rendering plugin**: Draws nodes as boxes/arrows (uses graph as data source)  
⚠️ **Collaboration cursors plugin**: Shows where other users are  
⚠️ **Permissions plugin**: Who can edit what (uses graph metadata)  
⚠️ **Export plugin**: Export to SVG, PNG, Figma format

### Why It Works

1. **Graph as data model**: Each box = node, each connection = edge
2. **CRDT handles conflicts**: Two users move same box → last-write-wins or vector position merge
3. **Guest mode**: Anonymous users edit without signup, gets persistent DID when they want
4. **Schema evolution**: Can add "style" field to nodes later without breaking old diagrams

### Proof: Example Graph

```json
{
  "nodes": [
    {
      "id": "node-1",
      "type": "flowchart-box",
      "label": "Start",
      "position": { "x": 100, "y": 50 },
      "style": { "color": "blue", "shape": "rounded" }
    },
    {
      "id": "node-2",
      "type": "flowchart-box",
      "label": "Process",
      "position": { "x": 100, "y": 150 }
    }
  ],
  "edges": [
    {
      "id": "edge-1",
      "from": "node-1",
      "to": "node-2",
      "type": "arrow"
    }
  ]
}
```

**Performance Test Target:**

- 10,000 nodes
- 50 concurrent users
- 60fps rendering (canvas plugin)
- < 100ms sync latency (CRDT merge)

### Open Questions

- How to handle viewport (which part of canvas visible)? → Local-only state (not synced)
- How to paginate large diagrams? → Virtual scrolling in canvas plugin
- How to export to Figma? → Plugin reads graph, converts to Figma API format

---

## Scenario 2: Game Engine (Unity/Godot-like)

**User Story**:
> "I want to build a 2D game where entities (player, enemies, items) are nodes in the graph. Plugins handle rendering, physics, input. Game state syncs across devices for multiplayer."

### What Refarm Provides Today (v0.1.0)

✅ **Sovereign Graph**: Entities as nodes (player, enemy, item)  
✅ **CRDT Sync**: Game state syncs (health, position, inventory)  
✅ **Plugin System**: Rendering, physics, input as plugins

### What We'd Need (v0.3.0+)

⚠️ **Rendering plugin**: Draws sprites, animations (canvas/WebGL)  
⚠️ **Physics plugin**: Collision detection, gravity, movement  
⚠️ **Input plugin**: Keyboard, mouse, touch, gamepad  
⚠️ **Audio plugin**: Plays sounds, music  
⚠️ **Scripting plugin**: Lua/JS for game logic (sandboxed)

### Why It Works

1. **Graph as ECS**: Nodes = entities, fields = components (position, velocity, health)
2. **CRDT for multiplayer**: Player actions sync (move, attack, pick up item)
3. **Plugins for systems**: Each plugin reads/writes components (physics reads position, writes velocity)
4. **Offline-first**: Single-player works offline, multiplayer syncs when online

### Proof: Example Graph

```json
{
  "entities": [
    {
      "id": "player-1",
      "type": "player",
      "components": {
        "position": { "x": 100, "y": 200 },
        "velocity": { "x": 0, "y": 0 },
        "health": 100,
        "inventory": ["sword", "potion"]
      }
    },
    {
      "id": "enemy-1",
      "type": "enemy",
      "components": {
        "position": { "x": 300, "y": 200 },
        "velocity": { "x": -1, "y": 0 },
        "health": 50,
        "ai": "chase-player"
      }
    }
  ]
}
```

**Performance Test Target:**

- 1,000 entities
- 60fps rendering
- < 16ms physics tick
- < 50ms multiplayer sync

### Open Questions

- How to handle deterministic simulation (so all players see same thing)? → Use CRDT for state, deterministic physics for interpolation
- How to prevent cheating (client-side authority)? → Future: authoritative server plugin (not Day 1)
- How to handle fast-paced games (FPS)? → Use prediction + rollback (hard, v1.0+ problem)

---

## Scenario 3: Nostr Social App (Decentralized Twitter)

**User Story**:
> "I want to post notes, follow people, see feed. Works offline. Syncs with Nostr relays when online. I control my data."

### What Refarm Provides Today (v0.1.0)

✅ **Sovereign Graph**: Posts = nodes, follows = edges  
✅ **Identity (Nostr)**: User has Nostr keypair  
✅ **Offline-First**: Write posts offline, publish later  
✅ **CRDT Sync**: Merge local + relay data

### What We'd Need (v0.2.0)

⚠️ **Nostr relay plugin**: Fetches/publishes events to relays  
⚠️ **Feed plugin**: Renders timeline (sorts by timestamp)  
⚠️ **Notification plugin**: Alerts on mentions, replies  
⚠️ **Media plugin**: Upload images to IPFS or Nostr media servers

### Why It Works

1. **Graph as social graph**: Nodes = users/posts, edges = follows/replies
2. **Offline-first**: Write posts offline, queue for relay sync
3. **Identity**: Nostr keypair (from ADR-004) signs posts
4. **Privacy**: Local graph is encrypted (ADR-009)

### Proof: Example Graph

```json
{
  "users": [
    {
      "id": "npub1abc...",
      "name": "Alice",
      "bio": "Refarm enthusiast"
    }
  ],
  "posts": [
    {
      "id": "note1xyz...",
      "author": "npub1abc...",
      "content": "Just set up my Refarm instance!",
      "timestamp": 1709856000,
      "replies": []
    }
  ],
  "follows": [
    {
      "from": "npub1abc...",
      "to": "npub1def..."
    }
  ]
}
```

**Performance Test Target:**

- 10,000 posts in local graph
- < 1 second to render feed
- < 5 seconds to sync with relays

### Open Questions

- How to handle spam/moderation? → Plugin-based filters (user configures)
- How to handle large media files? → Plugin uploads to external storage, stores hash in graph
- How to handle relay selection? → User configures relay list, plugin handles sync

---

## Scenario 4: Personal Knowledge Management (Obsidian/Notion-like)

**User Story**:
> "I want to write notes, link them (backlinks), tag them, search them. Works offline. Syncs to my phone. I can export to Markdown anytime."

### What Refarm Provides Today (v0.1.0)

✅ **Sovereign Graph**: Notes = nodes, links = edges  
✅ **Offline-First**: Write notes anywhere  
✅ **CRDT Sync**: Notes sync across devices  
✅ **Schema Evolution**: Can add fields (tags, metadata) later

### What We'd Need (v0.2.0)

⚠️ **Markdown editor plugin**: Edit notes in Markdown  
⚠️ **Backlinks plugin**: Show which notes link to current note  
⚠️ **Search plugin**: Full-text search (uses FTS5 in SQLite)  
⚠️ **Export plugin**: Export to Markdown files

### Why It Works

1. **Graph as knowledge graph**: Notes = nodes, links = edges
2. **Offline-first**: Write notes anywhere, sync later
3. **CRDT**: Merge edits from phone + laptop
4. **Schema evolution**: Add "tags" field without breaking old notes

### Proof: Example Graph

```json
{
  "notes": [
    {
      "id": "note-1",
      "title": "Refarm Architecture",
      "content": "Refarm uses a sovereign graph...",
      "tags": ["architecture", "refarm"],
      "created": 1709856000,
      "modified": 1709859600
    },
    {
      "id": "note-2",
      "title": "CRDT Basics",
      "content": "CRDTs are conflict-free replicated data types...",
      "tags": ["crdt", "theory"]
    }
  ],
  "links": [
    {
      "from": "note-1",
      "to": "note-2",
      "context": "Refarm uses CRDTs for synchronization"
    }
  ]
}
```

**Performance Test Target:**

- 100,000 notes
- < 100ms full-text search
- < 1 second to render note + backlinks

### Open Questions

- How to handle large notes (10MB+)? → Pagination or streaming read
- How to handle binary attachments? → Store in OPFS, reference from graph
- How to handle version history? → Graph versioning (ADR-020)

---

## Scenario 5: Data Analysis Dashboard (Observable/Jupyter-like)

**User Story**:
> "I want to load CSV data, run SQL queries, visualize results (charts, tables). Queries run client-side (DuckDB WASM). Dashboards shareable."

### What Refarm Provides Today (v0.1.0)

✅ **Sovereign Graph**: Data sources + queries as nodes  
✅ **Storage Contract**: Load CSV into SQLite (via storage plugin)  
✅ **Plugin System**: Query plugin, visualization plugin

### What We'd Need (v0.3.0)

⚠️ **Query plugin**: SQL interface to SQLite/DuckDB  
⚠️ **Visualization plugin**: Charts (D3, Vega, Plotly)  
⚠️ **Data import plugin**: CSV, Parquet, JSON  
⚠️ **Export plugin**: Export results as CSV, PNG

### Why It Works

1. **Graph as data model**: Datasets = nodes, queries = computed fields
2. **SQLite backend**: Efficient queries (FTS5, JSON, aggregates)
3. **Offline-first**: Run analysis offline, share later
4. **Plugin system**: Each chart type is a plugin

### Proof: Example Graph

```json
{
  "datasets": [
    {
      "id": "sales-2024",
      "type": "csv",
      "path": "/opfs/sales.csv",
      "rows": 10000
    }
  ],
  "queries": [
    {
      "id": "query-1",
      "sql": "SELECT region, SUM(amount) FROM sales GROUP BY region",
      "result": [
        { "region": "North", "sum": 50000 },
        { "region": "South", "sum": 30000 }
      ]
    }
  ],
  "visualizations": [
    {
      "id": "viz-1",
      "type": "bar-chart",
      "query": "query-1",
      "x": "region",
      "y": "sum"
    }
  ]
}
```

**Performance Test Target:**

- 1M rows in SQLite
- < 100ms SQL query
- < 1 second to render chart

### Open Questions

- How to handle large datasets (1GB+)? → Stream from OPFS, don't load all into memory
- How to handle joins across datasets? → SQLite handles this natively
- How to share dashboards? → Export graph + data as bundle

---

## Scenario 6: Email Client (Proton Mail-like)

**User Story**:
> "I want to read/send email offline. Emails stored locally (encrypted). Syncs with IMAP when online. I control my data."

### What Refarm Provides Today (v0.1.0)

✅ **Sovereign Graph**: Emails = nodes, threads = edges  
✅ **Offline-First**: Read emails offline  
✅ **Encryption**: Local data encrypted (ADR-009)  
✅ **CRDT Sync**: Merge local + IMAP state

### What We'd Need (v0.3.0)

⚠️ **IMAP plugin**: Fetch/send emails via IMAP  
⚠️ **Email renderer plugin**: Display HTML emails (sanitized)  
⚠️ **Search plugin**: Full-text search (FTS5)  
⚠️ **Attachment plugin**: Download/upload attachments to OPFS

### Why It Works

1. **Graph as mailbox**: Emails = nodes, threads = edges (replies)
2. **Offline-first**: Read/compose offline, send when online
3. **Encryption**: Emails encrypted in OPFS (ADR-009)
4. **CRDT**: Merge read status, labels, flags

### Proof: Example Graph

```json
{
  "emails": [
    {
      "id": "email-1",
      "from": "alice@example.com",
      "to": ["bob@example.com"],
      "subject": "Refarm is awesome",
      "body": "I just tried Refarm...",
      "timestamp": 1709856000,
      "read": false,
      "labels": ["inbox"]
    }
  ],
  "threads": [
    {
      "id": "thread-1",
      "emails": ["email-1", "email-2"],
      "subject": "Refarm is awesome"
    }
  ]
}
```

**Performance Test Target:**

- 100,000 emails
- < 100ms search
- < 1 second to render email

### Open Questions

- How to handle spam? → Plugin-based filters
- How to handle large attachments (100MB+)? → Stream to/from OPFS
- How to handle multiple accounts? → Multiple graphs (one per account)

---

## Scenario 7: Project Management (Linear/Asana-like)

**User Story**:
> "I want to create tasks, assign them, track progress. Works offline. Syncs across team. I can customize workflows."

### What Refarm Provides Today (v0.1.0)

✅ **Sovereign Graph**: Tasks = nodes, dependencies = edges  
✅ **Offline-First**: Create tasks offline  
✅ **CRDT Sync**: Merge task updates (status, assignee)  
✅ **Schema Evolution**: Add custom fields (labels, priorities)

### What We'd Need (v0.2.0)

⚠️ **Kanban plugin**: Drag-drop tasks between columns  
⚠️ **Calendar plugin**: Show tasks by due date  
⚠️ **Notification plugin**: Alert on task assignment  
⚠️ **Export plugin**: Export to CSV, GitHub Issues

### Why It Works

1. **Graph as project**: Tasks = nodes, dependencies = edges
2. **Offline-first**: Create tasks offline, sync later
3. **CRDT**: Merge task updates (status changes, comments)
4. **Plugin system**: Custom workflows as plugins

### Proof: Example Graph

```json
{
  "tasks": [
    {
      "id": "task-1",
      "title": "Implement ADR-020",
      "status": "in-progress",
      "assignee": "alice",
      "due": "2024-03-15",
      "priority": "high",
      "dependencies": []
    },
    {
      "id": "task-2",
      "title": "Write tests for ADR-020",
      "status": "not-started",
      "assignee": "bob",
      "dependencies": ["task-1"]
    }
  ]
}
```

**Performance Test Target:**

- 10,000 tasks
- < 100ms to render Kanban board
- < 1 second to render Gantt chart

### Open Questions

- How to handle permissions (who can edit what)? → Permissions plugin (uses identity)
- How to handle notifications? → Notification plugin (push to service worker)
- How to handle integrations (GitHub, Slack)? → Plugin per integration

---

## What Makes These Scenarios Possible?

### 1. **Sovereign Graph** (Universal Data Model)

All scenarios use graph as data model:

- Diagram editor: Boxes/arrows = nodes/edges
- Game: Entities = nodes, components = fields
- Social: Users/posts = nodes
- Notes: Notes/links = nodes/edges
- Dashboard: Datasets/queries = nodes
- Email: Emails/threads = nodes
- PM: Tasks/dependencies = nodes/edges

**One data model, infinite use cases.**

### 2. **Offline-First + CRDT** (Works Anywhere)

All scenarios work offline:

- Create/edit content offline
- Sync when online (CRDT merges conflicts)
- No "waiting for server" UX

**Offline-first is not a feature, it's a foundation.**

### 3. **Plugin System** (Infinite Extensibility)

All scenarios need custom plugins:

- Rendering (canvas, WebGL, SVG)
- Input (keyboard, mouse, gamepad)
- Sync (relays, IMAP, APIs)
- Export (formats, protocols)

**Kernel doesn't know about diagrams or games — plugins do.**

### 4. **Schema Evolution** (Future-Proof)

All scenarios evolve over time:

- Add "priority" field to tasks (backward compatible)
- Add "style" field to diagram boxes
- Add "tags" field to notes

**ADR-010 ensures old data still works.**

### 5. **Identity + Permissions** (User Control)

All scenarios need identity:

- Who created this task?
- Who can edit this diagram?
- Who owns this note?

**ADR-004 (Nostr DID) + plugin-based permissions.**

---

## How to Test if a Scenario is Achievable

Ask these questions:

1. **Can the data model fit in a graph?**  
   → Nodes = entities, edges = relationships, fields = properties

2. **Does offline-first make sense?**  
   → Can user create/edit offline? Does sync make sense?

3. **Can plugins handle domain-specific logic?**  
   → Rendering, input, sync, export = plugins

4. **Does schema evolution work?**  
   → Can we add fields without breaking old data?

5. **Do we need identity/permissions?**  
   → Who owns what? Who can edit what?

If **YES to all 5**, the scenario is achievable.

---

## What This Means for v0.1.0 → v1.0.0

**v0.1.0**: Prove the foundation works

- ✅ Contracts tested (12 tests)
- ✅ CRDT sync works
- ✅ Offline-first works
- ✅ Plugin system works

**v0.2.0**: Prove it scales

- Graph versioning (ADR-020)
- Observability (ADR-007)
- License metadata
- First reference plugins (Resource Observatory, License Selector)

**v0.3.0**: Prove it's resilient

- Self-healing (ADR-021)
- Plugin citizenship (quota enforcement)
- Policy declarations (ADR-022)

**v1.0.0**: Prove it's production-ready

- All invariants tested (100+ tests)
- Multi-device validated
- Third-party plugin ecosystem
- Documentation complete

---

## Final Thought: Don't Build Everything, Build the Path

You're not building a game engine today.  
You're building **a foundation that COULD become a game engine** without rewriting everything.

You're not building Miro today.  
You're building **a foundation that COULD become Miro** with the right plugins.

**That's the difference between a good architecture and wishful thinking.**

And that's why you're spending so much time on:

- Offline-first (works anywhere)
- CRDT (handles conflicts)
- Plugins (infinite extensibility)
- Schema evolution (future-proof)
- Graph versioning (undo/revert)
- Self-healing (survives chaos)

**You're not building features. You're building inevitability.**

---

## References

- [ADR-002: Offline-First](../specs/ADRs/ADR-002-offline-first-architecture.md)
- [ADR-003: CRDT Sync](../specs/ADRs/ADR-003-crdt-synchronization.md)
- [ADR-010: Schema Evolution](../specs/ADRs/ADR-010-schema-evolution.md)
- [ADR-017: Micro-Kernel](../specs/ADRs/ADR-017-studio-micro-kernel-and-plugin-boundary.md)
- [ADR-020: Graph Versioning](../specs/ADRs/ADR-020-sovereign-graph-versioning.md)
- [ADR-021: Self-Healing](../specs/ADRs/ADR-021-self-healing-and-plugin-citizenship.md)
- [ADR-022: Policy Declarations](../specs/ADRs/ADR-022-policy-declarations-in-plugin-manifests.md)
