# Spec: Refarm Backend Protocol + Managed Service Primitives

**Status:** DRAFT — spec in progress, not ready for implementation  
**Authors:** Arthur Silva  
**Date:** 2026-05-16

---

## Context & Motivation

`refarm ask`, `refarm tree`, e outros comandos dependem do `farmhand` como backend de execução. Hoje essa dependência é acoplada: os comandos sabem que precisam do `farmhand` e sabem como falar com ele diretamente.

O problema:
- Usuários podem ter farmhands remotos (cloud-hosted)
- Usuários podem construir seus próprios farmhands (mesmo protocolo, plugins diferentes)
- Podem existir múltiplos farmhands (um por projeto)
- O lifecycle (start/stop/health) está implícito e duplicado em vários lugares
- Processos ficam dangling; não há idempotência garantida

A solução: definir o **Refarm Backend Protocol** — o contrato mínimo que qualquer backend deve satisfazer — e construir **primitivas de lifecycle** genéricas sobre esse contrato. `farmhand` vira uma implementação, não o único alvo.

### Inspiração e posicionamento

Este design é informado pelo trabalho battle-tested do **[wasmCloud](https://wasmcloud.com)** (ver [INSPIRATIONS.md](../docs/INSPIRATIONS.md)). A lição central que absorvemos: *o host deve ser um protocolo, não uma implementação*. O wasmCloud provou isso em escala distribuída com NATS como backbone. Nós aplicamos o mesmo princípio ao caso local-first com HTTP simples.

**Onde divergimos intencionalmente do wasmCloud:**

| Decisão | wasmCloud | Refarm (esta spec) | Razão |
|---------|-----------|-------------------|-------|
| Transport | NATS (distribuído) | HTTP + SSE (local) | Complexidade zero para o caso de uso principal |
| Link Definitions | Explícitas, gerenciadas pelo host | Implícitas via `requires/provides` (evoluir depois) | DX first — não bloquear o usuário com fiação manual hoje |
| Provider discovery | Lattice-wide antes de boot | Health-check simples | Sem coordenação distribuída no scope atual |
| Múltiplos hosts | Nativo | Fase 2 desta spec | Um host, um projeto, uma responsabilidade |

O que **não** vamos reinventar: o modelo `BackendDescriptor` é deliberadamente análogo ao `HostConfig` do wasmCloud. Quando chegarmos a múltiplos backends, a migração conceitual será natural.

---

## 1. Refarm Backend Protocol

### O que é um backend?

Qualquer processo ou serviço que satisfaça:

```
BackendDescriptor {
  // Como iniciar (opcional — omitir para backends já-rodando / remotos)
  command?:   string[]        // ex: ["node", "apps/farmhand/dist/index.js"]
  env?:       Record<string, string>

  // Como conectar
  httpUrl:    string          // ex: "http://127.0.0.1:42001"
  wsUrl?:     string          // ex: "ws://127.0.0.1:42000"  (opcional)

  // Como provar que está pronto
  healthPath: string          // ex: "/efforts/summary"  (HTTP GET, espera 2xx)
  healthTimeout: number       // ms — ex: 2000

  // Identidade
  name:       string          // ex: "farmhand"
  version?:   string
}
```

### Capabilities mínimas (HTTP API)

Um backend conforme ao protocolo DEVE expor:

| Endpoint | Método | Descrição |
|----------|--------|-----------|
| `GET  {healthPath}` | — | Health check. Retorna 2xx quando pronto |
| `POST /efforts` | `{ task, pluginId, payload }` | Submete um effort/task |
| `GET  /efforts/:id` | — | Consulta status de um effort |
| `GET  /efforts/summary` | — | `{ total, active, done, failed, pending }` |
| `GET  /streams/:id` | SSE | Stream de chunks de um effort |

Capabilities opcionais (extensíveis):
- `GET /plugins` — lista plugins carregados
- `GET /sessions` — lista sessões ativas
- WebSocket em `wsUrl` — sync CRDT (para Studio)

### O que NÃO faz parte do protocolo

- Qual LLM usar
- Quais plugins carregar
- Como armazenar state internamente
- Se é local ou remoto

---

## 2. Managed Service Primitives

### BackendHandle

```typescript
interface BackendHandle {
  descriptor: BackendDescriptor
  httpUrl: string
  wsUrl?: string

  // Verifica se o backend está respondendo
  isHealthy(): Promise<boolean>

  // Faz HTTP request autenticada contra o backend
  fetch(path: string, init?: RequestInit): Promise<Response>
}
```

### LifecyclePolicy

```typescript
type LifecycleMode =
  | 'managed'   // default: refarm inicia se necessário, para ao sair
  | 'attached'  // TUI: inicia junto, para quando TUI fechar
  | 'detached'  // daemon explícito: persiste além do processo refarm

interface LifecyclePolicy {
  mode:              LifecycleMode   // default: 'managed'
  idleTimeoutMs?:    number          // default: 300_000 (5min). 0 = sem timeout
  startTimeoutMs?:   number          // default: 10_000
  bootLogLevel?:     'silent' | 'info' | 'verbose'  // default: 'info'
}
```

### ManagedBackend

```typescript
interface ManagedBackend {
  // Garante que o backend está pronto. Inicia se necessário.
  // Idempotente — segunda chamada é no-op se já pronto.
  ensureReady(): Promise<BackendHandle>

  // Para o backend (se foi iniciado por este processo)
  shutdown(): Promise<void>

  // Lê o estado atual sem iniciar
  probe(): Promise<'running' | 'stale-pid' | 'stopped'>
}
```

### ProcessManager (genérico)

```typescript
interface ProcessManager {
  // Inicia um processo e aguarda health check
  start(descriptor: BackendDescriptor, policy: LifecyclePolicy): Promise<BackendHandle>

  // Para com SIGTERM graceful + timeout
  stop(handle: BackendHandle): Promise<void>

  // PID tracking idempotente
  // Lê PID file, faz kill -0, limpa stale PIDs automaticamente
  readPid(pidFile: string): Promise<number | null>
  writePid(pidFile: string, pid: number): Promise<void>
  clearStalePid(pidFile: string): Promise<void>
}
```

---

## 3. CLI Surface

### `refarm daemon` subcommand

```
refarm daemon start    # inicia em modo detached (persiste além do terminal)
refarm daemon stop     # SIGTERM graceful
refarm daemon restart  # stop + start atomicamente
refarm daemon status   # mesmo que farm-status, mas como output estruturado do CLI
refarm daemon logs     # tail -f do log do backend
```

### Auto-lifecycle em comandos

```
refarm ask "..."
  → FarmhandClient.ensureReady()
      ├─ HTTP probe em :42001 → pronto? usa.
      ├─ PID stale? → limpa + inicia.
      └─ stopped? → inicia (log: "⚡ farmhand starting...")
                  → aguarda health
                  → log: "⚡ farmhand ready (1.2s)"
                  → registra cleanup handler (SIGINT, process.exit)
```

### Status line (configurável)

```bash
REFARM_FARMHAND_LOG=silent   # sem output sobre infraestrutura
REFARM_FARMHAND_LOG=info     # "⚡ farmhand starting..." / "⚡ farmhand ready (1.2s)"  [DEFAULT]
REFARM_FARMHAND_LOG=verbose  # "⚡ farmhand ready pid=1234 ws=42000 http=42001 (1.2s)"
```

---

## 4. Idempotência por Design

- **Health-first**: sempre proba HTTP antes de confiar no PID file
- **Atomic PID write**: escreve PID file SÓ depois do health check passar
- **Stale PID cleanup automático**: `kill -0` falha → deleta PID → inicia novo
- **Exit handler**: `process.on('exit')` + `SIGINT`/`SIGTERM` registrados quando `managed`
- **Modo `managed`**: farmhand NUNCA fica dangling após o processo refarm encerrar
- **Modo `detached`**: farmhand persiste — gerenciamento explícito via `refarm daemon stop`

---

## 5. Extensibilidade

O `BackendDescriptor` é a fronteira. Qualquer backend que satisfaça o protocolo HTTP funciona:

```typescript
// Nosso farmhand local
const localFarmhand: BackendDescriptor = {
  name: 'farmhand',
  command: ['node', '--import', '...loader.mjs', 'apps/farmhand/dist/index.js'],
  httpUrl: 'http://127.0.0.1:42001',
  wsUrl: 'ws://127.0.0.1:42000',
  healthPath: '/efforts/summary',
  healthTimeout: 2000,
}

// Farmhand remoto (cloud)
const remoteFarmhand: BackendDescriptor = {
  name: 'farmhand-remote',
  // sem command — já está rodando
  httpUrl: 'https://farmhand.myproject.refarm.dev',
  healthPath: '/efforts/summary',
  healthTimeout: 5000,
}

// Farmhand customizado do usuário
const userFarmhand: BackendDescriptor = {
  name: 'my-farmhand',
  command: ['./my-custom-backend'],
  httpUrl: 'http://127.0.0.1:9000',
  healthPath: '/health',
  healthTimeout: 3000,
}
```

---

## 6. Arquivos a criar/modificar

| Arquivo | Ação | Responsabilidade |
|---------|------|-----------------|
| `packages/cli/src/backend/descriptor.ts` | criar | `BackendDescriptor` type |
| `packages/cli/src/backend/handle.ts` | criar | `BackendHandle` implementation |
| `packages/cli/src/backend/process-manager.ts` | criar | PID tracking, start/stop, health check |
| `packages/cli/src/backend/managed-backend.ts` | criar | `ManagedBackend` — `ensureReady()`, lifecycle modes |
| `packages/cli/src/backend/farmhand-descriptor.ts` | criar | `BackendDescriptor` concreto para nosso farmhand |
| `apps/refarm/src/commands/daemon.ts` | criar | `refarm daemon start|stop|restart|status|logs` |
| `apps/refarm/src/commands/ask.ts` | modificar | usar `ManagedBackend.ensureReady()` em vez de conexão direta |
| `apps/refarm/src/index.ts` | modificar | registrar subcommand `daemon` |

---

## 7. O que NÃO implementar nesta spec

- Múltiplos backends simultâneos (um por projeto) — fase 2
- Discovery automático de backends remotos — fase 2  
- Backend registry / marketplace — fase 3
- Autenticação entre refarm CLI e backend remoto — fase 2

### Gaps conscientes (comparado ao wasmCloud)

Os itens abaixo são deliberadamente deixados para fases futuras. Documentamos aqui para que a decisão seja visível, não acidental:

| Gap | wasmCloud tem | Nossa posição |
|-----|--------------|---------------|
| **Link Definitions explícitas** | O host valida que toda `requires` de um componente tem um provider registrado antes de boot | Hoje: validação em runtime, post-boot. Fase 2: validação em `ensureReady()` — o `ManagedBackend` inspeciona o backend antes de retornar o handle |
| **Provider capability routing** | O host faz routing automático de chamadas WIT para o provider correto | Hoje: tractor resolve `requires` via `globalThis.__REFARM_PLUGIN_IMPORTS__`. Fase 2: routing declarativo baseado em WIT interface names |
| **Host-level policy enforcement** | Policy service separado que o host consulta por chamada | Hoje: `TrustManager` + `PluginRegistry` valida no load, não por chamada. Fase 2: `BackendHandle.fetch()` pode carregar um `PolicyService` plugável |
| **Multi-host lattice** | Qualquer número de hosts pode formar um lattice via NATS | Fase 2: múltiplos `BackendDescriptor` por projeto, com routing de capability entre eles |

---

## Próximos passos

1. Review desta spec com Arthur
2. Escrever ADR formalizando a decisão de separar protocolo de implementação
3. Plano de implementação (subagent-driven-development)
4. Tasks: ProcessManager → ManagedBackend → farmhand descriptor → CLI integration → daemon subcommand
