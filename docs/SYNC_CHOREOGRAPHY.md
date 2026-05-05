# Sync Choreography: Offline → Online

Este documento descreve o que acontece em cada fase do ciclo de vida de sincronização no Refarm — do write local até a convergência entre dispositivos. É a referência para agentes que precisam entender as garantias de consistência e o comportamento durante transições de rede.

**ADRs relacionados**: ADR-002, ADR-045, ADR-028

---

## Garantias fundamentais (ADR-002)

Antes de qualquer detalhe de implementação, estas garantias nunca são violadas:

| Garantia | O que significa |
|---|---|
| **Zero network on boot** | A aplicação abre sem nenhuma chamada de rede. Lê diretamente do SQLite local. |
| **Writes always succeed** | Um `tractor.storeNode()` nunca falha por falta de rede. Persiste localmente e enfileira sync. |
| **Read-your-writes** | Após escrever um node, qualquer query local retorna o dado imediatamente. |
| **Sync queue survives restarts** | Se o processo encerra antes de sincronizar, os deltas pendentes são reenviados na próxima conexão. |
| **Graceful degradation** | Se o daemon não está acessível, o browser continua funcional em modo local. |

---

## Arquitetura CQRS (ADR-045)

```
Write model: LoroDoc (CRDT)
  ↓ Projector (microseconds)
Read model:  SQLite (materialized view)
  ↓ queries
UI / Plugins / Agentes
```

**Regra crítica**: nunca escreva diretamente no SQLite. Todo write passa pelo LoroDoc — o Projector materializa para SQL automaticamente. Escrever diretamente no SQLite quebra a convergência CRDT.

---

## Ciclo de vida: write path

```
1. Chamada: tractor.storeNode(node) ou storage.put(record)
2. LoroCRDTStorage.storeNode():
   a. LoroDoc.getMap('nodes').set(id, node)     ← write CRDT
   b. Projector.onUpdate() dispara               ← subscription automática
   c. SQLite.upsert(node)                        ← read model atualizado
3. Retorna imediatamente — zero await de rede
```

**Por que o Projector é microseconds**: LoroDoc.subscribe() é síncrono dentro do mesmo processo. Não há I/O entre o write CRDT e o update SQL.

---

## Ciclo de vida: read path

```
1. Query: storage.get(id) ou storage.query({ type: "Task" })
2. SQL: SELECT * FROM nodes WHERE ...
3. Retorna — zero rede, zero CRDT overhead
```

Todas as queries são contra SQLite. O LoroDoc nunca é consultado diretamente em read path.

---

## Ciclo de vida: sync path

### Offline → conectado (BrowserSyncClient)

```typescript
// packages/sync-loro/src/browser-sync-client.ts
new BrowserSyncClient(storage, "ws://localhost:42000").connect()
```

**Na conexão:**
```
1. storage.getUpdate() → Uint8Array (estado completo ou delta do LoroDoc)
2. Envia ao daemon via WebSocket
3. Daemon faz doc.import(bytes) → merge CRDT no lado servidor
```

**Ongoing (após conectado):**
```
Local write:
  LoroDoc.onUpdate(bytes) → WS send(bytes)   ← delta incremental

Remote update:
  WS onmessage(bytes) → doc.import(bytes) → Projector → SQLite
```

**Na desconexão:**
```
1. Writes locais continuam normalmente (LoroDoc não precisa de rede)
2. Acumula deltas internamente no LoroDoc
3. Na reconexão: storage.getUpdate() captura todos os deltas pendentes em um único Uint8Array
4. Envia tudo de uma vez — sem replay manual necessário
```

**Retry automático:**
```
On close/error → setTimeout(connect, 5000)
```
O daemon pode reiniciar; o cliente reconecta silenciosamente.

---

## Resolução de conflitos

O Loro CRDT garante convergência automática sem intervenção do usuário ou do agente:

| Cenário | Comportamento |
|---|---|
| Dois devices editam o mesmo campo simultaneamente | Last-write-wins baseado em HLC (Hybrid Logical Clock) |
| Device A offline cria node X; Device B cria node com mesmo ID | Merge sem perda — ambos coexistem se IDs diferentes; LWW se mesmo ID |
| Reordenação de lista (árvore) | Movable tree do Loro detecta ciclos e resolve automaticamente |
| Sync parcial (crash no meio) | Deltas são idempotentes — reenviar não duplica dados |

**Regra para agentes**: não implemente lógica de merge manual. Se dois valores podem conflitar, use IDs únicos (URNs) por operação ao invés de patches sobre um ID compartilhado.

---

## Snapshots e dispositivos com restrição de memória (RPi/IoT)

Para dispositivos com storage limitado, o Loro suporta shallow snapshots:

```typescript
// Exportar snapshot compacto (não inclui histórico completo)
const snapshot = doc.export({ mode: 'shallow-snapshot' });

// Importar em outro device
const newDoc = new LoroDoc();
newDoc.import(snapshot);

// Deltas subsequentes são calculados a partir do snapshot
// (não a partir do histórico completo)
```

**Quando usar**: daemons Farmhand em RPi, ambientes com SQLite em OPFS com quota limitada (ADR-009).

---

## Ports e protocolos

| Porta | Protocolo | Propósito |
|---|---|---|
| `42000` | WebSocket | Sync CRDT binário (browser ↔ daemon) |
| `42001` | HTTP / SSE / WS | Farmhand sidecar: task API + stream transport |

**Importante**: porta 42000 é sync CRDT (binary `Uint8Array`). Porta 42001 é HTTP/SSE/WS para streaming de eventos e task API. São canais distintos — não misture.

---

## Op-log e convergência SQLite (ADR-028)

Além do LoroDoc, o `storage-sqlite` mantém um `crdt_ops` append-only:

```sql
-- Estrutura simplificada
crdt_ops (
  id TEXT PRIMARY KEY,
  subject_id TEXT,      -- node @id
  predicate TEXT,       -- campo
  object TEXT,          -- valor
  hlc_timestamp TEXT,   -- Hybrid Logical Clock
  actor_id TEXT         -- quem escreveu
)
```

Este op-log é a fonte de verdade para replay e auditoria. A tabela `nodes` é uma projeção materializada — pode ser reconstruída integralmente a partir de `crdt_ops`.

---

## Diagrama: browser conecta após período offline

```
[Offline]                    [Reconnect]                [Online]

Browser writes              BrowserSyncClient           Daemon
─────────────               connects to :42000          ──────
storeNode(A)                      │                     ...
storeNode(B)    ──────────────────►  send getUpdate()   import(bytes)
storeNode(C)                      │                     merge A, B, C
                                  │◄─── remote deltas── send deltas
                              import(remote)
                              Projector → SQLite
                              UI atualiza
```

---

## O que agentes NÃO devem fazer

- **Não** fazer polling de `storage.get()` esperando um sync remoto — writes locais são imediatos, sync é eventual.
- **Não** assumir que `getUpdate()` vazio significa "nada a sincronizar" — pode haver state local que o daemon ainda não tem.
- **Não** comparar clocks wall-time entre devices para resolver conflitos — use o HLC do LoroDoc.
- **Não** escrever diretamente na tabela `nodes` do SQLite — quebra o CRDT.

---

## Referências

- [ADR-002](../specs/ADRs/ADR-002-offline-first-architecture.md) — garantias offline-first
- [ADR-045](../specs/ADRs/ADR-045-loro-crdt-adoption.md) — adoção do Loro, CQRS, shallow snapshots
- [ADR-028](../specs/ADRs/ADR-028-crdt-sqlite-convergence.md) — op-log triple-based, convergência SQLite
- [packages/sync-loro/README.md](../packages/sync-loro/README.md)
- [packages/storage-sqlite/README.md](../packages/storage-sqlite/README.md)
