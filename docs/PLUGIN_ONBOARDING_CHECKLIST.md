# Plugin Onboarding Checklist

Guia prático para criar um plugin Refarm-compatible do zero. Complementa o [PLUGIN_DEVELOPER_PLAYBOOK.md](./PLUGIN_DEVELOPER_PLAYBOOK.md) com um checklist executável e os critérios de aceitação que qualquer plugin deve satisfazer antes de publicação.

---

## Pré-requisitos

- [ ] Leu o [PLUGIN_DEVELOPER_PLAYBOOK.md](./PLUGIN_DEVELOPER_PLAYBOOK.md) (fluxo completo, exemplos em TS/Go/Rust)
- [ ] Tem o WIT canônico: `packages/refarm-plugin-wit/`
- [ ] Decidiu a linguagem: TypeScript (JCO), Go (TinyGo), Rust (recomendado para prod)
- [ ] Entende o modelo Effort/Task/Result — ver [farmhand-task-execution.md](../specs/features/farmhand-task-execution.md)

---

## 1. Estrutura de arquivos mínima

```
my-plugin/
├── plugin.json          ← manifest (obrigatório)
├── src/
│   └── lib.rs           ← (ou .ts / .go)
├── wit/
│   └── world.wit        ← importa do refarm-plugin-wit canônico
├── Cargo.toml           ← (ou package.json)
└── README.md            ← obrigatório para publicação
```

### plugin.json obrigatório

```json
{
  "name": "@mycompany/my-plugin",
  "version": "0.1.0",
  "description": "O que faz em uma linha",
  "entry": "dist/my-plugin.wasm",
  "capabilities": ["network:read", "filesystem:read"],
  "guestMode": {
    "supported": false,
    "reason": "requer keypair para assinar eventos"
  },
  "supportedTypes": ["MyNode"],
  "exports": ["respond", "ingest"]
}
```

---

## 2. Checklist de implementação

### Contrato WIT

- [ ] Importa `tractor-bridge` (store_node, query_nodes, log)
- [ ] Declara apenas as capabilities necessárias (princípio do menor privilégio)
- [ ] Exporta pelo menos uma função de entry: `respond`, `ingest`, ou `setup`
- [ ] Retorna `result<T, plugin-error>` — nunca panic/throw não capturado

### Ciclo de vida

- [ ] `setup()` solicita permissions via `bridge.requestPermission()`
- [ ] `ingest()` normaliza dados para JSON-LD antes de `bridge.storeNode()`
- [ ] `teardown()` libera recursos (conexões, file handles)
- [ ] `metadata()` retorna name, version, supportedTypes, requiredCapabilities

### Guest mode

Preencha a matriz antes de publicar:

| Capability | Guest suportado? | Motivo se não |
|---|---|---|
| read / query | ✅ (se storage persistente) | — |
| write / store | ✅ (se storage persistente) | — |
| network fetch | ✅ | — |
| Nostr publish | ❌ | precisa keypair para assinar |
| bridge / relay | ❌ | precisa identity verificada |

Declare no `plugin.json` e no `metadata()` — sem declaração explícita, agentes assumem guest não suportado.

---

## 3. Checklist de segurança (obrigatório)

- [ ] **Nenhuma credencial no WASM** — keys, tokens e API keys vivem no Tractor. Use WIT para solicitar operações autenticadas ao host.
- [ ] **Sem network calls diretas** — toda rede passa por `bridge.fetch()` (capability-gated). WASM sandboxado não tem acesso direto à rede.
- [ ] **Filesystem via agent-fs** — não use `std::fs` diretamente; use o WIT `agent-fs` (WASI-mapped, policy-gated).
- [ ] **Subprocess via agent-shell** — timeout 30s aplicado automaticamente pelo host; argv não pode ser vazio.
- [ ] **Writes estruturados validam antes de gravar** — use `structured-io` para JSON/TOML/YAML; falha de parse não modifica o arquivo.
- [ ] **Integridade WASM declarada** — ao publicar via Nostr (NIP-94), inclua o SHA-256 do `.wasm` no evento.

---

## 4. Checklist de testes

- [ ] **Conformance suite** — se implementar um contrato versioned (storage:v1, task:v1, etc.), rode `runXxxV1Conformance(adapter)` e garanta `pass: true`
- [ ] **Teste de guest mode** — se `guestMode.supported: true`, teste com `identity.type === "guest"`
- [ ] **Teste offline** — plugin funciona sem daemon acessível (modo local-only)
- [ ] **Teste de teardown** — sem resource leak após teardown

```typescript
// Exemplo: conformance + guest test mínimo
import { runTaskV1Conformance } from "@refarm.dev/task-contract-v1";
import { createMyTaskAdapter } from "./my-plugin";

test("conforms to task:v1", async () => {
  const result = await runTaskV1Conformance(createMyTaskAdapter());
  expect(result.pass).toBe(true);
});
```

---

## 5. Checklist de publicação

### README obrigatório (mínimo)

- [ ] O que o plugin faz (uma linha)
- [ ] Quando usar (e quando não usar)
- [ ] Capabilities solicitadas e por quê
- [ ] Guest mode: suportado ou não, com motivo
- [ ] Exemplo de uso mínimo

### Publicação via Nostr (NIP-89)

```typescript
import { NostrIdentityManager } from "@refarm.dev/identity-nostr";

const identity = new NostrIdentityManager();
await identity.loadKeypair(myKeypair);

await identity.publishPluginHandler({
  name: "@mycompany/my-plugin",
  wasmUrl: "https://cdn.mycompany.com/my-plugin.wasm",
  integrityHash: "sha256:abc123...",  // SHA-256 do .wasm
  capabilities: ["network:read"],
  kind: "task-manager",
}, ["wss://relay.damus.io"]);
```

### Publicação via npm

```bash
# Garante que dist/ existe e está atualizado
pnpm build

# Valida exports/types
pnpm type-check:dist

# Publica
npm publish --access public
```

---

## 6. O que o Farmhand verifica no auto-boot

Quando Farmhand carrega `~/.refarm/plugins/my-plugin/`:

1. `plugin.json` existe e tem `entry`, `name`, `version`
2. `plugin.wasm` existe no path declarado em `entry`
3. Se `integrityHash` presente no manifest: verifica SHA-256 antes de executar
4. Capabilities declaradas são aprovadas pelo security mode ativo (ADR-032)
5. `metadata()` responde em < 100ms (timeout do Farmhand)

Se qualquer check falhar, o plugin é colocado em quarentena e aparece em `refarm plugin status` com o motivo.

---

## Referências

- [PLUGIN_DEVELOPER_PLAYBOOK.md](./PLUGIN_DEVELOPER_PLAYBOOK.md) — walkthrough completo com exemplos
- [ADR-017](../specs/ADRs/ADR-017-microkernel-boundary.md) — fronteira host/guest, sandbox
- [ADR-018](../specs/ADRs/ADR-018-capability-contracts.md) — contrato de capabilities
- [ADR-032](../specs/ADRs/ADR-032-proton-security.md) — signing obrigatório, WASM security
- [packages/refarm-plugin-wit/](../packages/refarm-plugin-wit/) — WIT canônico
- [packages/identity-nostr/README.md](../packages/identity-nostr/README.md) — publicação via Nostr
