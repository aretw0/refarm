# Plugin Developer Stories

> **"Você não instala extensões de terceiros. Você cultiva extensões do seu próprio solo."**

Este documento conta a história de quem **constrói** plugins para o Refarm — do desenvolvedor
que escreve um script para si mesmo até quem publica algo que qualquer instância Refarm pode
descobrir e usar.

Não é um guia técnico. Para código, consulte o [Plugin Developer Playbook](PLUGIN_DEVELOPER_PLAYBOOK.md).
Aqui você entende **por que** o modelo funciona assim e qual caminho percorrer.

---

## A Proposta: Extensibilidade Sem Dependência

A maioria dos sistemas de plugins tem um dono. Você publica na loja deles, segue as regras deles, e um dia eles decidem tirar o seu plugin — ou a loja toda — do ar. Seus usuários ficam sem nada.

O Refarm parte de uma premissa diferente:

> **Um plugin é um arquivo WASM servido de uma URL. Isso é tudo.**

Não há registro central obrigatório. Não há aprovação prévia. Não há chave de API. Se você consegue servir um arquivo `.wasm` via HTTPS, você pode distribuir um plugin para qualquer instância Refarm que queira instalá-lo.

A partir daí, o ecossistema oferece camadas opcionais — curadoria, descoberta via Nostr, verificação de integridade — para quem quer mais confiança sem abrir mão de soberania.

---

## Nível 0 — O Plugin Solitário

*"Quero automatizar algo no meu Refarm. Só eu vou usar."*

**Persona: Marco**, desenvolvedor Rust que acumula notas em arquivos Markdown no Obsidian
e quer que elas apareçam como nós no seu grafo soberano — sem passar por nenhum servidor.

Marco não quer publicar nada. Não quer uma conta. Não quer permissão de ninguém.

### O que Marco faz

Ele escreve um plugin Rust que:

1. Lê arquivos `.md` do diretório `~/obsidian/vault/`
2. Converte cada nota para um nó JSON-LD
3. Chama `store-node` via a bridge do Tractor

```rust
// validations/simple-wasm-plugin/src/lib.rs (padrão de referência)
impl plugin::Guest for Plugin {
    fn ingest() -> Result<u32, String> {
        // Lê arquivos locais e armazena no grafo soberano
        // O Tractor injeta a tractor-bridge como import WASI
        Ok(42) // 42 notas importadas
    }

    fn metadata() -> PluginMetadata {
        PluginMetadata {
            name: "Obsidian Bridge".to_string(),
            version: "0.1.0".to_string(),
            description: "Importa notas Markdown do Obsidian".to_string(),
            supported_types: vec!["Note".to_string()],
            required_capabilities: vec![],
        }
    }
}
```

Depois de compilar (`cargo component build --release`), o manifest dele é simples:

```json
{
  "id": "@marco/obsidian-bridge",
  "name": "Obsidian Bridge",
  "version": "0.1.0",
  "entry": "file:///home/marco/.refarm/plugins/obsidian-bridge.wasm",
  "capabilities": {
    "provides": ["notes:import"],
    "requires": []
  },
  "permissions": ["storage:write"],
  "observability": {
    "hooks": ["onLoad", "onInit", "onRequest", "onError", "onTeardown"]
  },
  "targets": ["server"],
  "certification": {
    "license": "MIT",
    "a11yLevel": 0,
    "languages": ["pt"]
  }
}
```

Marco carrega o plugin na sua instância local:

```typescript
await tractor.plugins.load(manifest, wasmHash);
```

**O código é dele. Os dados são dele. O WASM fica no disco dele.**
Nunca precisa sair da máquina.

> **Mecanismo suportado hoje:** `entry: "file://..."` — o Tractor usa `fs.readFile()`
> diretamente. Funciona apenas em contexto Node.js (servidor local, script, CLI).

---

## Nível 1 — A Instância Própria

*"Tenho o Refarm rodando como PWA no meu domínio. Quero que meu plugin funcione lá."*

**Persona: Beatriz**, fullstack que hospeda o Refarm em `https://beatriz.dev` como
Progressive Web App. Ela quer um plugin que sincronize suas tarefas do Notion —
mas só para ela, na sua instância.

### O desafio do browser

No browser não existe `file://`. O plugin precisa ser servido via HTTPS.
Beatriz coloca o arquivo compilado no servidor dela:

```
https://beatriz.dev/plugins/notion-sync.wasm
```

O manifest atualizado:

```json
{
  "id": "@beatriz/notion-sync",
  "name": "Notion Sync",
  "version": "0.2.0",
  "entry": "https://beatriz.dev/plugins/notion-sync.wasm",
  "capabilities": {
    "provides": ["tasks:import"],
    "requires": [],
    "allowedOrigins": ["https://api.notion.com"]
  },
  "permissions": ["network:fetch", "storage:write"],
  "observability": {
    "hooks": ["onLoad", "onInit", "onRequest", "onError", "onTeardown"]
  },
  "targets": ["browser"],
  "trust": {
    "profile": "strict"
  },
  "certification": {
    "license": "AGPL-3.0-only",
    "a11yLevel": 1,
    "languages": ["pt", "en"]
  }
}
```

### Instalação no browser

No browser, o fluxo é diferente: o WASM precisa ser transpilado pelo JCO e
armazenado em OPFS antes de poder ser usado. Isso acontece **na instalação**, não
no boot. Veja [ADR-044](../specs/ADRs/ADR-044-wasm-plugin-loading-browser-strategy.md).

```typescript
// Instala uma vez (transpile JCO → cache OPFS)
await installPlugin(manifest, wasmHash);

// Usa em qualquer boot subsequente (dynamic import do OPFS)
await tractor.plugins.load(manifest);
```

### Verificação de integridade

O campo `wasmHash` é o SHA-256 do arquivo `.wasm`. O Tractor verifica antes de
instalar — se o hash não bater, a instalação é bloqueada. Beatriz gera o hash
localmente:

```bash
sha256sum notion-sync.wasm
# → a3f4c8e2... (inclui no manifest ou passa como parâmetro)
```

> **Mecanismo suportado hoje:** `entry: "https://..."` + `wasmHash` para verificação.
> O plugin roda apenas na instância da Beatriz. Qualquer URL HTTPS funciona.

---

## Nível 2 — Compartilhado com Confiança

*"Meu amigo também usa Refarm. Quero que ele possa instalar meu plugin."*

**Persona: Beatriz** (continuação) quer compartilhar o plugin com seu amigo **Rafael**,
que tem sua própria instância Refarm em `https://rafael.io`.

### Como funciona hoje

Beatriz compartilha três coisas com Rafael:

1. **A URL do WASM**: `https://beatriz.dev/plugins/notion-sync.wasm`
2. **O manifest JSON**: o arquivo acima, pode ser enviado por qualquer canal
3. **O SHA-256**: `a3f4c8e2...` para que Rafael verifique a integridade

Rafael copia o manifest para o seu Refarm e instala. O Tractor baixa o WASM
da URL da Beatriz, verifica o hash, transpila no contexto do Rafael, e guarda
no OPFS do Rafael.

```
Beatriz            Canal (WhatsApp, email, git...)            Rafael
─────────          ───────────────────────────────          ─────────
[WASM em HTTPS] → → manifest.json + hash SHA-256 → → instala no Refarm dele
```

**A confiança é pessoal.** Rafael confia na Beatriz, não em uma loja. Se ele
não confiar na URL, ele não instala. Não há intermediário que possa falsificar
o plugin, porque o hash garante que o arquivo que chegou é exatamente o que
a Beatriz publicou.

Isso é **o mecanismo mais básico que suportamos hoje** — e é suficiente para
ecossistemas pequenos de confiança direta.

> Este é o modelo "primitivo" e soberano. Sem infraestrutura extra.
> Qualquer coisa acima disso é uma conveniência, não uma necessidade.

---

## Nível 3 — Curadoria Refarm

*"Quero que outros usuários Refarm descubram meu plugin sem me conhecerem pessoalmente."*

**Persona: Beatriz** (continuação). Depois de alguns meses, o plugin dela é estável
e bem testado. Ela quer que a comunidade Refarm possa encontrá-lo.

### O que é a curadoria Refarm

O Refarm oferece um **diretório curado** (`refarm.dev/plugins`) como serviço —
não como monopólio. A curadoria é:

- **Consultoria**, não controle: a equipe Refarm revisa o plugin e oferece feedback
- **Transparência**: critérios públicos (manifesto válido, hash verificável, licença aberta, conformance tests)
- **Confiança editorial**: um selo de qualidade, não uma barreira de entrada

Beatriz submete o plugin via PR ou formulário. A equipe Refarm valida:

| Critério | Verificação |
|---|---|
| Manifesto válido | `validatePluginManifest(manifest)` sem erros |
| Hash verificável | SHA-256 do `.wasm` bate com o declarado |
| Conformance tests | Plugin passa nos testes do `plugin-manifest` |
| Licença aberta | Campo `certification.license` presente e reconhecido |
| Observabilidade | 5 hooks (`onLoad`, `onInit`, `onRequest`, `onError`, `onTeardown`) implementados |

Se aprovado, o plugin aparece no diretório público. Usuários instalam com um
clique — mas o WASM ainda vem da URL da Beatriz. O Refarm não hospeda nada.

> **Status atual:** A curadoria está **em construção**. O formato de submissão
> e o diretório público estão sendo desenhados. O mecanismo técnico (URL + hash)
> já existe.

---

## Nível 4 — Ecossistema P2P

> ⚡ **Sneak peek** — o que está por vir, não o que existe hoje.

### Nostr: Descoberta Descentralizada

O Nostr é o protocolo de identidade e mensagens que o Refarm usa para sincronização
entre dispositivos. Faz sentido natural que o ecossistema de plugins também use Nostr
para distribuição — e é para aí que estamos indo.

O fluxo será:

```
1. Desenvolvedor compila o plugin → WASM binary
2. Gera SHA-256 do arquivo
3. Publica o WASM em qualquer servidor (seu próprio, IPFS, GitHub Releases...)
4. Cria evento Nostr NIP-94 kind:1063:
     → arquivo: plugin.wasm
     → hash: sha256:a3f4c8...
     → url: https://beatriz.dev/plugins/notion-sync.wasm
     → mimetype: application/wasm
5. Cria evento Nostr NIP-89 kind:31990 (handler announcement):
     → "Eu processo dados do tipo: tasks:import"
     → aponta para o evento NIP-94
6. Qualquer instância Refarm que queira pode descobrir via query ao relay:
     "Quais plugins existem para tasks:import?"
```

**Por que Nostr faz sentido aqui:**

- **Sem ponto único de falha**: se um relay cair, os eventos vivem em outros relays
- **Sem controle central**: qualquer um pode publicar um evento NIP-89
- **Verificação mantida**: o hash SHA-256 do NIP-94 garante integridade mesmo sem confiar no servidor
- **Identidade**: o desenvolvedor assina o evento com sua chave Nostr — é rastreável e auditável
- **Compatível com soberania**: instâncias Refarm escolhem *quais relays consultar* — podem ter uma lista curada de relays confiáveis

O WIT do SDK já documenta a intenção:

```wit
/// Then distribute it via Nostr NIP-94 and announce it with NIP-89.
world refarm-plugin { ... }
```

> **Status:** Planejado como próximo passo natural. Não implementado ainda.
> A implementação técnica do NIP-89/94 está na camada de `identity-nostr`.

### Outras formas que talvez suportaremos

| Mecanismo | Motivação | Notas |
|---|---|---|
| **Self-hosted relay** | Organizações com plugins internos | Você opera seu próprio relay Nostr; só seus usuários consultam |
| **IPFS / Arweave** | URL permanente sem servidor | O WASM fica "forever" em endereço de conteúdo |
| **Headless Tractor (VPS)** | Plugin sempre-on, sem browser | [ADR-037 Fase 3](../specs/ADRs/ADR-037-infrastructure-escalation-strategy.md): Tractor rodando em Raspberry Pi ou VPS |
| **Server-side plugins** | Processamento pesado, sem WebAssembly no browser | [ADR-037 Fase 4+](../specs/ADRs/ADR-037-infrastructure-escalation-strategy.md): Astro API layer — ainda conceitual |

---

## O Contrato: O Que Todo Plugin Deve Implementar

Todo plugin implementa a interface `integration` definida em `wit/refarm-sdk.wit`.
É o contrato que o Tractor espera — independente de linguagem (Rust, Go, TypeScript).

```wit
interface integration {
    // Chamado uma vez após instanciação.
    // Use para setup inicial: OAuth, leitura de config, handshake.
    setup: func() -> result<_, plugin-error>;

    // Chamado periodicamente ou sob demanda.
    // Pull de dados externos → armazena no grafo soberano via store-node.
    // Retorna: número de itens importados.
    ingest: func() -> result<u32, plugin-error>;

    // Chamado quando o usuário dispara uma ação de push.
    // payload: JSON-LD descrevendo a ação (ex: resposta a uma mensagem).
    push: func(payload: json-ld-node) -> result<_, plugin-error>;

    // Chamado antes do plugin ser descarregado.
    // Limpe conexões, cancele timers, libere recursos.
    teardown: func();

    // Retorna nós de ajuda semântica para o Sistema de Ajuda global.
    get-help-nodes: func() -> result<list<json-ld-node>, plugin-error>;

    // Retorna nome, versão, descrição para exibição no Studio.
    metadata: func() -> plugin-metadata;

    // Chamado quando um evento de sistema ocorre (ex: "system:switch-tier").
    on-event: func(event: string, payload: option<string>);
}
```

O Tractor injetar as **capabilities** como imports WASI — o plugin só consegue
o que o manifesto declarou e o usuário aprovou:

```wit
interface tractor-bridge {
    store-node: func(node: json-ld-node) -> result<node-id, plugin-error>;
    get-node: func(id: node-id) -> result<json-ld-node, plugin-error>;
    query-nodes: func(node-type: string, limit: u32) -> result<list<json-ld-node>, plugin-error>;
    request-permission: func(capability: string, reason: string) -> bool;
    get-identity: func() -> result<identity-info, plugin-error>;
    emit-telemetry: func(event: string, payload: option<string>);
}
```

---

## O Manifesto: O Contrato Social do Plugin

O `PluginManifest` é o que o usuário vê antes de instalar. Cada campo é uma promessa:

```json
{
  "id": "@autor/nome-do-plugin",
  "name": "Nome Legível",
  "version": "1.0.0",
  "entry": "https://autor.dev/plugins/meu-plugin.wasm",

  "capabilities": {
    "provides": ["tasks:import"],
    "requires": ["storage:write"],
    "providesApi": ["TasksApi"],
    "allowedOrigins": ["https://api.external-service.com"]
  },

  "permissions": ["network:fetch", "storage:write"],

  "observability": {
    "hooks": ["onLoad", "onInit", "onRequest", "onError", "onTeardown"]
  },

  "targets": ["browser", "server"],

  "trust": {
    "profile": "strict"
  },

  "certification": {
    "license": "MIT",
    "a11yLevel": 1,
    "languages": ["pt", "en"]
  }
}
```

| Campo | Significado para o usuário |
|---|---|
| `id` | Identidade única e auditável — `@autor/plugin` |
| `entry` | De onde vem o código — você sabe de onde instala |
| `capabilities.provides` | O que o plugin oferece ao seu grafo |
| `capabilities.requires` | O que o plugin precisa de outros plugins |
| `permissions` | O que o plugin vai pedir ao usuário (network, storage…) |
| `targets` | Onde roda: no browser, no servidor, ou remotamente |
| `trust.profile` | `strict` = sandbox total; `trusted-fast` = você aprova explicitamente |
| `certification.license` | Licença do código — você sabe o que aceita |

---

## Tabela de Distribuição: Onde Estamos, Para Onde Vamos

| Mecanismo | Status | O que é necessário |
|---|---|---|
| `file://` URL (Node.js/local) | ✅ Hoje | Apenas um arquivo `.wasm` no disco |
| `https://` URL + SHA-256 | ✅ Hoje | Servidor HTTPS qualquer + hash do arquivo |
| Compartilhamento manual (manifest JSON) | ✅ Hoje | Nada além do que já existe |
| Curadoria Refarm (`refarm.dev/plugins`) | 🚧 Em construção | Manifesto válido + conformance tests |
| Nostr NIP-94 + NIP-89 | 🔭 Próximo passo | Integração com `identity-nostr` |
| Self-hosted relay Nostr | 🔭 Planejado | Relay próprio + NIP-89 |
| IPFS / Arweave | 💡 Possível | URL de conteúdo permanente |
| Headless Tractor (VPS/RPi) | 🔭 ADR-037 Fase 3 | Node.js sempre-on com Tractor |
| Server-side plugins (SSR) | 💡 Conceitual | ADR-037 Fase 4+ |

---

## Referências

- [Plugin Developer Playbook](PLUGIN_DEVELOPER_PLAYBOOK.md) — guia técnico: WIT, templates Rust/Go/TS, testes, segurança
- [WASM & JCO Architecture](WASM_JCO_ARCHITECTURE.md) — como o WASM roda no browser e no servidor
- [User Story](USER_STORY.md) — perspectiva do usuário final que instala e usa plugins
- [ADR-017: Micro-Kernel e Fronteira de Plugin](../specs/ADRs/ADR-017-studio-micro-kernel-and-plugin-boundary.md)
- [ADR-018: Contratos de Capacidade](../specs/ADRs/ADR-018-capability-contracts-and-observability-gates.md)
- [ADR-032: Segurança e Assinatura Obrigatória](../specs/ADRs/ADR-032-proton-security-mandatory-signing.md)
- [ADR-037: Estratégia de Escalada de Infraestrutura](../specs/ADRs/ADR-037-infrastructure-escalation-strategy.md)
- [ADR-044: Plugin Loading no Browser](../specs/ADRs/ADR-044-wasm-plugin-loading-browser-strategy.md)
- [WIT Interface do Plugin](../wit/refarm-sdk.wit)
