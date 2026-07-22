# Assimilação: Pears/Holepunch — a fazenda alcançável de qualquer rede

> Status: design (2026-07-22). Direção do operador (Arthur): "quero tirar meu celular da
> mesma rede e tentar via dados móveis". A LAN provou o limite do broadcast (roteador
> filtrando; multicast como segundo dialeto em teste); a pergunta certa é a de cima:
> **como um dispositivo encontra e alcança a fazenda de QUALQUER rede, sem IP, sem
> configuração — com soberania.**

## O que o Pears é (e o que assimilamos dele)

Pears (pears.com, Holepunch) é um runtime P2P. As peças que importam para nós:

| Peça | O que faz | Mapeamento refarm |
|---|---|---|
| **hyperswarm (DHT)** | Dois lados se encontram por um TÓPICO (hash de 32 bytes) numa DHT pública e fazem hole-punching UDP; conexões diretas, criptografadas fim-a-fim | O degrau ACIMA do farm-beacon: mesmo contrato (probe→encontrar→conectar), escopo mundo em vez de LAN. O tópico derivado de um segredo do operador É a capability de descoberta |
| **hypercore/hyperdrive** | Logs/arquivos append-only replicados P2P | Paralelo ao nosso sync Loro — NÃO substitui o CRDT; avaliar apenas como transporte de replicação alternativo, muito depois |
| **bare (runtime)** | JS runtime pequeno, multiplataforma (desktop + mobile) | Candidato a rodar a ponte no Android sem Node/Termux — verificar maturidade antes de prometer |

**Regra de assimilação** (mesma do agents-lab): consumir o que é infra provada
(hyperswarm como dependência da PONTE, processo separado), nunca portar DHT para dentro
do tractor. O runtime não aprende P2P; a ponte traduz.

## A forma: `farm-tunnel` (ponte hyperswarm ↔ daemon)

Um processo Node pequeno e GOVERNADO (padrão `refarm discover announce`: detached,
pidfile, log, status/stop) em cada lado:

- **Lado fazenda**: junta-se ao tópico `hash("refarm-farm:" + segredo)` na DHT; para
  cada conexão P2P entrante, abre `ws://127.0.0.1:42000` local e faz pipe de bytes
  (mesmo desenho do proxy `/sync` do `web serve` — provado hoje).
- **Lado dispositivo**: junta-se ao mesmo tópico; expõe `ws://127.0.0.1:42000` LOCAL
  no dispositivo; o `farm-hello`/hub apontam para localhost e nem sabem que existe DHT.
- O segredo nasce de um comando (`refarm tunnel init` → grava em `.refarm/`), e o
  dispositivo o recebe UMA vez (QR/cópia) — é a chave da fazenda, não um IP.

Por que essa forma: zero mudança nos contratos existentes (o daemon continua servindo
`ws://localhost`), a ponte é opt-in e descartável, e o mesmo desenho serve Termux hoje
(Node existe lá — provado) e bare amanhã.

## Rail complementar: Cloudflare pontual (administrado, não P2P)

O operador perguntou "cloudflare workers pontualmente?" — sim, como TRILHO GERIDO
paralelo, não como substituto do P2P:

- `cloudflared tunnel` dá um hostname estável → `refarm web serve` (hub, TLS real de
  borda — resolve o contexto seguro sem mkcert) e/ou sidecar. O bloco
  `packages/infra-cloudflare` já existe (provider + wrangler); um serviço
  `tunnel` segue o mesmo padrão do `turbo-cache` provisioner.
- Custo: dependência de conta/terceiro e tráfego passando pela borda deles (TLS
  termina lá) — aceitável "se tudo for bem administrado" (palavras do operador), mas o
  P2P continua sendo o caminho soberano por padrão.

## Fatias (cada uma verificável)

1. **Verificação de premissas** (pesquisa, sem código): versões/API atuais de
   hyperswarm; comportamento em CGNAT de operadora móvel (hole-punch UDP através de
   NAT de celular — taxa de sucesso e fallback por relay da DHT); bare no Android —
   estado real. Saída: este doc atualizado com fatos citados.
2. **`scripts/farm-tunnel.mjs` mínimo** (fazenda + dispositivo no mesmo arquivo, flag
   de papel): hyperswarm como ÚNICA dependência nova; pipe tópico↔ws. Gate: farm-hello
   no dispositivo via `127.0.0.1` com a ponte ativa, atravessando redes distintas
   (celular em 4G) — o teste que o operador pediu.
3. **Governança**: `refarm tunnel` (init/start/status/stop) espelhando `discover
   announce`; segredo em `.refarm/`, nunca em argv.
4. **(depois) Rail Cloudflare**: serviço `tunnel` no infra-cloudflare, mesma pegada do
   turbo-cache provisioner.

## Segurança (postura desde o desenho)

- O tópico da DHT é derivado de segredo — quem não tem o segredo não ENCONTRA a fazenda
  (descoberta já é capability), e as conexões hyperswarm são cifradas fim-a-fim.
- A ponte expõe apenas o que o daemon já expõe em localhost; a abertura do sidecar
  continua decisão explícita à parte.
- Processo governado: nada de ponte pendurada — pidfile, status, stop, log.
- Rotação do segredo = trocar de tópico; revogação barata por design.
