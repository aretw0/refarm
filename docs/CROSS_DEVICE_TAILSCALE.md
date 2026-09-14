# Alcançar a fazenda de qualquer rede — Tailscale (primeiro rail cross-device)

> O rail primário para "meu celular alcança a fazenda de qualquer rede, privado, sem
> mudar o app". Escolhido em [`docs/superpowers/specs/2026-07-22-cross-network-transport-rails.md`](superpowers/specs/2026-07-22-cross-network-transport-rails.md).
> Funciona nesta máquina APESAR do EDR corporativo (`ds_agent`): a conexão da Tailscale é
> de SAÍDA, e o agente só filtra entrada.

## Por que Tailscale resolve sem tocar em código

Tailscale põe host e celular numa mesma rede WireGuard privada. O celular ganha um IP
estável na faixa `100.64.0.0/10` (e um nome via MagicDNS). A partir daí ele alcança
`host:42000` (sync), `host:42001` (sidecar) e o hub **como se estivesse na LAN** — o
`refarm discover announce --status` já reconhece esse endereço como `mesh` e o coloca
primeiro na lista, porque é o que funciona de 4G.

## Passo a passo

### 1. Host (a máquina da fazenda)

```bash
# Instalação (Debian/Ubuntu; precisa de sudo — pode haver política corporativa):
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up           # abre um link de login no navegador; autentique
tailscale ip -4             # anote o IP 100.x — este é o "de qualquer rede"
```

Deixe a fazenda de pé (daemon + anunciante governado):

```bash
refarm runtime status                 # daemon rust ativo?
refarm discover announce              # anunciante governado (pidfile/status/stop)
refarm discover announce --status     # confirma; o IP 100.x aparece como "mesh"
```

### 2. Celular (Android/Termux)

- Instale o app **Tailscale** (Play Store) e faça login na MESMA conta → o telefone
  entra na tailnet.
- No Termux, teste o alcance direto pelo nome ou IP mesh do host (o `100.x` do passo 1).
  Os clientes são o pacote `@refarm.dev/farm-client` (rode do `git pull`, sem instalar):

```bash
node packages/farm-client/bin/farm-hello.mjs serpro-1577853   # pelo nome MagicDNS
# (o atalho de compat `node scripts/farm-hello.mjs …` também funciona)
```

O sync `ws://100.x.y.z:42000` (ou pelo nome: `ws://serpro-1577853:42000`) conecta de
qualquer rede — inclusive com o Wi-Fi desligado, só nos dados móveis. Alcançar o **sync
já é entrar na malha da fazenda** — a travessia cross-device essencial. ✅ comprovado do
Android em Wi-Fi e 5G.

### Dirigir a fazenda daqui (opcional): expor o sidecar

O `sync` (`:42000`) é a malha CRDT. O `sidecar` (`:42001`, plano de controle — efforts,
chat) fica em **loopback por padrão, de propósito**. Para dirigir a fazenda a partir do
celular, o daemon precisa ouvir o sidecar além do loopback — e desde
`docs/superpowers/specs/2026-07-29-declared-surfaces-design.md` (S1) isso exige uma
declaração em `.refarm/config.json`, não só a flag: um bind não-loopback sem
`surfaces.sidecar-http` declarado é recusado na largada, política configurada ou não.

```bash
# 1. declare a exposição (uma vez; fica em .refarm/config.json, do operador, gitignored):
#    "surfaces": { "sidecar-http": { "expose": "host:0.0.0.0", "gate": "device-token" } }
# 2. credencial por dispositivo — NADA de export: o gate declarado já deriva o caminho
#    da política (<refarm-dir>/auth-policy.json, o mesmo arquivo que o enroll escreve):
refarm auth enroll
# 3. no host, reinicie o runtime — SEM REFARM_HTTP_HOST: com a flag ausente
#    (packages/tractor's --http-host é Option, sem default) a declaração decide:
bash scripts/tractor-start.sh --background
```

Entre o passo 1 e o passo 2 o daemon SOBE e a superfície BINDA — negando tudo (401 em
toda requisição) até existir uma credencial. Isso é deliberado: negar tudo é a forma mais
estrita de cumprir o gate declarado, e é melhor que um runtime que se recusa a iniciar. O
log diz isso na largada, nomeando o caminho derivado e o `refarm auth enroll`.

`REFARM_AUTH_POLICY` continua existindo, como OVERRIDE: use só para apontar para um
arquivo de política em outro lugar. Não é mais requisito para o gate valer.

Por que `0.0.0.0` e não o IP mesh específico: o tooling LOCAL do refarm fala com
`127.0.0.1:42001`; bindar só no IP mesh quebraria tudo que roda no próprio host. `0.0.0.0`
cobre loopback (local) E a tailnet (celular) de uma vez.

**Nota de soberania — honesta:** `0.0.0.0` também escuta na LAN e na VPN. NESTA máquina
isso é contido pelo EDR corporativo (`ds_agent`), que descarta inbound na LAN/VPN — então
o sidecar fica de fato alcançável só em loopback + tailnet. Numa máquina SEM esse filtro
de entrada, `0.0.0.0` exporia o sidecar (sem autenticação) para toda a LAN. A resposta
soberana geral é dual-bind (loopback + IP mesh) no daemon — um follow-on rastreado — ou
pôr o sidecar atrás do proxy same-origin (`refarm serve --host`) bindado só na mesh.

Depois do restart, `farm-hello <nome>` mostra sidecar ✅ e o hub/efforts funcionam do
celular.

- Para o HUB no navegador do celular: `https://<nome-magicdns-do-host>` depois de servir
  com `refarm web serve apps/me/dist --host 0.0.0.0 --tls-cert … --tls-key …` (ou, com
  Tailscale HTTPS habilitado na tailnet, o próprio nome MagicDNS já traz TLS válido —
  resolve o contexto seguro sem mkcert).

## Descoberta dentro da tailnet

O beacon UDP (broadcast/multicast) NÃO atravessa a tailnet — descoberta lá é por
**MagicDNS** (nomes estáveis), não por broadcast. Então no rail mesh você usa o nome ou
o IP `100.x` diretamente (o `farm-hello <host>` aceita ambos). O `discover --status` do
host é onde você lê qual é esse endereço.

## Soberania: Headscale

Se a dependência do control-plane da Tailscale incomodar, `Headscale` é o servidor de
coordenação open-source: você o roda, e nada da sua mesh toca infra de terceiro —
soberania total, mesmo protocolo (WireGuard). É o upgrade natural quando quiser fechar
esse último elo. Documentar como fatia própria quando for a hora.

## Quando NÃO é Tailscale

- **Compartilhar o hub publicamente** (link para alguém fora da sua mesh) → Cloudflare
  tunnel (rail de ingresso, TLS de borda). Ver a spec guarda-chuva.
- **Mesma rede doméstica amigável** → o beacon LAN que já temos é mais rápido e sem
  instalar nada.
- **Soberania máxima sem servidor de coordenação** → Pears/hyperswarm (spec dedicada).
