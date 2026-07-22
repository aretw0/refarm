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

```bash
# alcançar (auto-descoberta; ou passe o nome/IP)
node scripts/farm-hello.mjs [serpro-1577853]

# usar — o daily driver no bolso
FARM_HOST=serpro-1577853 node scripts/farm-ask.mjs "sua pergunta"
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
