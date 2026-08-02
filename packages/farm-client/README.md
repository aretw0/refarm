# Farm Client Kit — alcançar, anunciar e usar uma fazenda, de qualquer dispositivo

Um conjunto de primitivas **zero-dependência** para um dispositivo falar com uma fazenda
Refarm. Roda de um `git pull` puro em Termux (Android), Raspberry Pi ou laptop — nada
instalado além de `git` e `node ≥ 22` (usa `fetch`, `WebSocket`, `crypto`, `dgram`
nativos).

## Princípio: só o contrato de wire

O kit fala **apenas o contrato de wire** de uma fazenda — nada mais:

- **sync** — `ws://<host>:42000` — a malha CRDT (entrar/replicar).
- **sidecar** — `http://<host>:42001` — o plano de controle: `POST /efforts`,
  `GET /efforts/:id`, `GET /plugins`.

Por isso é um **bloco reutilizável e desacoplado**: não importa `apps/refarm` nem nenhum
pacote de workspace — só builtins do Node e seus próprios irmãos em `./lib`. Qualquer
projeto refarm-like (ou qualquer um montando o seu) pode usar, copiar, ou reimplementar a
partir daqui. O invariante é guardado por `scripts/ci/test-farm-client-decoupled.mjs`:
se alguém acoplar o kit ao monorepo, o teste falha.

> **Workloads, não só IA.** Um `effort` é um workload qualquer — um verb de plugin,
> computação determinística, orquestração. O `farm-ask` dirige o agente
> (`@refarm/agent`, `fn: respond`) porque é o workload mais comum hoje, mas o
> `effort-result` e o contrato de effort são **workload-neutros**. A fazenda coordena
> trabalho; a IA é um tipo de trabalho.

## Os verbos (dispositivo)

| Script | Verbo | O que faz |
|---|---|---|
| `farm-hello.mjs` | alcançar | descobre a fazenda (tailnet → LAN broadcast/multicast → varredura) e prova sync + sidecar |
| `farm-announce.mjs` | anunciar | (no host) responde probes de descoberta na LAN — opt-in |
| `farm-ask.mjs` | usar | submete um effort e imprime a resposta do agente |
| `farm-attend.mjs` | atender | responde, daqui, as perguntas que a fazenda deixou pendentes |
| `farm-start.mjs` | começar/acompanhar | lista e inicia operações declaradas; consulta o estado pela identidade da execução |
| `farm-update.mjs` | atualizar | puxa o kit do servidor de malha da fazenda (manifesto + sha256) |

```bash
# alcançar (auto-descoberta; ou passe o nome/IP)
farm-hello [serpro-1577853]

# usar — o daily driver no bolso
farm-ask "sua pergunta"

# atender — a fazenda perguntou e você não está na mesa
farm-attend            # responde o que estiver pendente e sai
farm-attend --watch    # fica de plantão (intervalo declarado + backoff)
farm-attend --list     # só olha; não responde

# começar uma operação admitida pelo nó e acompanhar seu desfecho
farm-start
farm-start "<operation-id>"
farm-start --status <run-id>
```

Todo assistente do refarm pergunta pelo mesmo contrato (`OperatorChannel`), então
`farm-attend` atende **qualquer** um deles — inclusive os que ainda não existem — sem
que nenhum assistente mude uma linha. O prompt é desenhado pelo bloco carregado em
`vendor/prompt-contract-v1/dist/index.js`, o mesmo arquivo que o nó usa no terminal: mesma cara,
mesmo Ctrl+C.

Uma pergunta de **segredo** avisa, antes de você digitar, que a resposta atravessa a
rede (autenticada por aparelho, dentro da tailnet). Quem preferir ir até a mesa fica
sabendo na hora certa. O valor nunca é escrito em log, eco ou linha de desfecho —
nem aqui, nem no nó.

Uma pergunta vive enquanto quem perguntou viver: se o comando do outro lado morreu ou
o prazo dele passou, a pergunta some, porque não há mais ninguém esperando a resposta.

## O kit PERGUNTA o nome da fazenda

O caminho que alcança uma fazenda de **qualquer** rede é o **nome** (MagicDNS) — não
depende de enumerar peers nem de estar na mesma LAN. Mas num celular a CLI `tailscale`
não existe (o Android roda o APP), então enumerar ali é estruturalmente impossível e o
kit **não tem como descobrir esse nome sozinho**.

Então ele pergunta, em vez de explicar:

```
🌱 Não sei o nome da sua fazenda — e é o NOME que alcança de qualquer rede, sem enumerar nada.
Como se chama a sua fazenda? (nome MagicDNS, ex.: serpro-1577853)
```

- **Uma vez por aparelho** — a resposta vai para `.farm-host`, onde o kit já lembra a
  fazenda de onde veio.
- **Só com terminal** — sem TTY (script, pipe, cron) ele **nunca** pergunta: entrega o
  erro honesto e a dica do alcance por nome, como antes.
- **Ctrl+C sai limpo** — o bloco de prompt rejeita com `OperatorPromptCancelledError` e o
  kit responde com uma linha e o código 130, nunca com um stack trace.

A pergunta vem do bloco `@refarm.dev/prompt-contract-v1`, **carregado** em
`vendor/prompt-contract-v1/dist/index.js` — não reimplementada aqui. Zero-dependência é "nada a
instalar", não "nada a reusar": o bloco tem zero dependências e importa só
`node:readline`, então viaja dentro do kit e é distribuído com manifesto + sha256 como
qualquer outro arquivo. `node scripts/vendor.mjs --check` (e `test/vendor.test.mjs`)
garantem que a cópia é byte a byte o build do bloco — se divergir, o teste fica vermelho.

## Atalhos no PATH

O `install.mjs` (e todo `farm-update`) planta lançadores `farm-ask`, `farm-attend`,
`farm-hello` e `farm-update` em `~/.local/bin` — a convenção por usuário que existe tanto num Linux
normal quanto no Termux, onde não há `/usr/local/bin` nem `sudo`. `FARM_BIN_DIR` manda
em tudo.

O instalador **diz** se esse diretório está no seu `PATH` e, se não estiver, qual é a
única linha a acrescentar — e para aí. Ele **nunca** edita o seu perfil de shell:

```
export PATH="$HOME/.local/bin:$PATH"
```

## As primitivas (`./lib`, puras e testadas)

| Lib | Superfície | Teste |
|---|---|---|
| `farm-beacon.mjs` | descoberta LAN (probe/announce UDP; broadcast+multicast; varredura /24) | `test-farm-beacon.mjs` |
| `tailnet.mjs` | descoberta por overlay (peers via `tailscale status`; nome MagicDNS) | `test-tailnet.mjs` |
| `effort-result.mjs` | ler a resposta de um `EffortResult` (workload-neutro) | `test-effort-result.mjs` |

## Rails de alcance (por contexto)

O kit descobre/alcança por vários caminhos; qual usar depende da rede — mapa completo em
[`docs/superpowers/specs/2026-07-22-cross-network-transport-rails.md`](../../docs/superpowers/specs/2026-07-22-cross-network-transport-rails.md):
LAN beacon (mesma rede amigável), overlay Tailscale (qualquer rede, privado — ver
[`docs/CROSS_DEVICE_TAILSCALE.md`](../../docs/CROSS_DEVICE_TAILSCALE.md)), ingress
Cloudflare (superfície pública), P2P Pears (soberano descentralizado).

## Promoção a pacote

Estas primitivas estão no proving ground (`scripts/lib`). Pela regra de composição
(`COMUM = 2+ consumidores → vira bloco`), já há três consumidores (os verbos acima) — a
promoção a um pacote publicável (`@refarm.dev/farm-client`, com naming product-neutral) é
o próximo passo natural quando um consumidor EXTERNO (um projeto refarm-like, o wizard do
hub) provar o reuso. O pacote não teria dependências de runtime — os `.mjs` já são ESM
puro — preservando a propriedade de rodar do `git pull`.
