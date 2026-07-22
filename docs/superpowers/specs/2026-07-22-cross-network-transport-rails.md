# Rails de transporte: como um dispositivo alcança a fazenda

> Status: design (2026-07-22). Guarda-chuva das estratégias de alcance dispositivo↔fazenda.
> Nasce da jornada com o Android do operador, mas é DELIBERADAMENTE agnóstico de máquina:
> cada rail vale para um contexto; nenhum invalida o outro.

## Princípio: rails complementares, não um vencedor

O contrato é sempre o mesmo — um dispositivo alcança `ws://…:42000` (sync) e
`http://…:42001` (sidecar) da fazenda. O que muda é o MEIO, e cada meio tem um
contexto onde é o melhor. **Um rail bloqueado num host não apaga os outros.**

| Rail | Como alcança | Melhor quando | Limite |
|---|---|---|---|
| **LAN beacon** (temos) | broadcast/multicast/varredura unicast na sub-rede | mesma rede, roteador permite tráfego entre clientes | não cruza isolamento de cliente, firewall de host, EDR, nem sai da LAN |
| **Overlay mesh** (Tailscale/Headscale) | ambos entram numa rede WireGuard privada; o telefone vira "peer da LAN" com IP estável | qualquer rede, incluindo 4G; privado; zero mudança no app | ambos instalam o cliente; coordenação por terceiro (ou Headscale self-hosted) |
| **Ingress tunnel** (Cloudflare/cloudflared) | host abre conexão de SAÍDA; hostname https público | expor o HUB publicamente com TLS real; compartilhar com quem NÃO está na sua mesh | TLS termina na borda do provedor (eles veem o plaintext); público por padrão |
| **P2P** (Pears/hyperswarm) | hole-punch de saída via DHT pública; tópico = segredo | soberania máxima, sem servidor de coordenação; fim-a-fim | integração mais nova; sucesso sob CGNAT móvel a verificar (spec Pears) |

**Todos exceto o LAN beacon fazem conexão de SAÍDA** — por isso vencem o muro de
INBOUND que encontramos nesta máquina (Trend Micro Deep Security, `ds_agent`,
política corporativa). O EDR filtra o que ENTRA; nenhum desses precisa de furo de
entrada.

## A pergunta do operador: Tailscale ou Cloudflare?

Não é ou-um-ou-outro — servem intenções diferentes. Mas se for para escolher UM
primeiro, a recomendação é **Tailscale primeiro**, Cloudflare como rail
complementar de superfície pública.

### Por que Tailscale como rail primário

- **É o que a comunidade já usa** para exatamente este problema ("alcançar meus
  serviços de casa pelo celular"). O operador pediu "o que todos já buscam usar" —
  no mundo self-host/homelab, a resposta é Tailscale.
- **Zero mudança no app.** Uma vez na tailnet, o telefone recebe um IP estável
  (`100.x.y.z`) e um nome (MagicDNS). Ele alcança `host:42000`/`:42001`/o hub como
  se estivesse na LAN — o beacon, o `web serve`, o sidecar, tudo funciona sem tocar
  em uma linha. O que construímos para a LAN passa a valer em qualquer rede.
- **Soberano no dado.** É WireGuard: tráfego cifrado fim-a-fim. A Tailscale coordena
  (control plane) e, no pior caso, relaya via DERP — mas mesmo relayado o tráfego
  continua cifrado; eles NÃO leem. Contraste com o ingress tunnel, onde o TLS
  termina no terceiro.
- **Self-hostável = soberania total.** `Headscale` é o control-server open-source:
  você roda a coordenação, e nada da sua mesh toca infra de terceiro. É o caminho de
  upgrade quando/se a dependência do control plane da Tailscale incomodar.
- **Individual E coletivo.** Uma tailnet é uma malha de dispositivos e de pessoas —
  exatamente o "plataforma individual mas também coletiva" que o operador descreveu.
- **Parente pragmático do Pears.** Tailscale é "WireGuard mesh gerido"; Pears é
  "P2P totalmente descentralizado". Mesma direção (dispositivo↔dispositivo, saída,
  cifrado), num eixo de maturidade: Tailscale entrega HOJE; Pears é o estado-final
  sem servidor de coordenação nenhum.

### Onde Cloudflare ganha (rail complementar, não substituto)

- **Superfície PÚBLICA com TLS real.** `cloudflared tunnel` dá um hostname https na
  borda deles — resolve o muro do contexto seguro do hub SEM mkcert, para qualquer
  navegador, inclusive de quem não está na sua mesh.
- **Compartilhar para fora.** Quando o alvo é alguém que você NÃO vai colocar na sua
  tailnet, o link público é o caminho.
- **Custo de soberania explícito:** o TLS termina na Cloudflare (eles veem o plaintext
  no edge) e é público por padrão até você somar Cloudflare Access. Aceitável "se bem
  administrado" (palavras do operador) — mas por isso é o rail de EXPOSIÇÃO, não o
  rail de acesso soberano pessoal.

### Veredito

- **Acesso pessoal/coletivo privado, de qualquer rede, hoje:** Tailscale (→ Headscale
  quando quiser control-plane próprio).
- **Expor o hub publicamente com TLS de verdade:** Cloudflare tunnel sobre o bloco
  `infra-cloudflare` existente.
- **Estado-final soberano sem coordenação:** Pears/hyperswarm (spec dedicada).
- **Mesma LAN, rede amigável:** o beacon que já temos — continua sendo o mais rápido.

## Como o refarm assimila cada rail (padrão comum)

Cada rail entra como PONTE/ADAPTADOR governado, nunca alterando o daemon:

- **Tailscale/Headscale:** nem precisa de ponte no app — é camada de rede. O refarm
  contribui com um `refarm discover` que reconhece o IP `100.x`/nome MagicDNS e um
  doc de setup. Possível fatia: `refarm net status` que reporta tailnet detectada.
- **Cloudflare:** serviço `tunnel` no `packages/infra-cloudflare`, mesma pegada do
  provisioner de turbo-cache; governado (pidfile/status/stop) como o `discover announce`.
- **Pears:** ponte `farm-tunnel` (spec Pears) — tópico↔ws, processo governado.

Todos herdam a regra de governança já provada: nada de processo pendurado — pidfile,
status, stop, log sob `.refarm/`.

## Fatias (ordem sugerida, cada uma verificável)

1. **Tailscale como caminho documentado + reconhecido** (menor esforço, maior alcance):
   doc de setup (host + Android), e `refarm discover announce --status` /
   `farm-hello` reconhecendo interface `tailscale0` / IP `100.64.0.0/10` como
   "alcançável via mesh". Gate: telefone na tailnet roda `farm-hello` (ou aponta o
   hub) e o sync conecta de 4G. Este é o PRIMEIRO demo cross-device que deve funcionar
   nesta máquina apesar do EDR.
2. **Cloudflare tunnel** para o hub público (serviço no infra-cloudflare).
3. **Pears** (spec dedicada) — o estado-final descentralizado.
4. **Headscale** documentado como upgrade soberano do control-plane.

## Nota de escopo permanente

O beacon LAN é CORRETO e permanece. Foi bloqueado NESTA máquina por um EDR corporativo
(`ds_agent`), não por falha de design. Em um roteador doméstico comum ele volta a ser
o caminho mais rápido e sem dependências. Rails são um menu por contexto — o operador
(ou um wizard futuro) escolhe pelo que a rede permite.
