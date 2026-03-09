# ADR-029: Native Browser Permissions as Capabilities

**Date**: 2026-03-07
**Status**: Accepted
**Context**:
O kernel do Refarm roda os plugins em um sandbox WebAssembly (WASM). Plugins não possuem acesso direto à API do DOM (Document Object Model) ou às APIs nativas do navegador (como `navigator.geolocation` ou `navigator.mediaDevices.getUserMedia`).
Surgiu o questionamento: Se um plugin precisar de acesso à câmera ou à localização do usuário, como lidamos com as permissões nativas do navegador?

**Decision**:
As **Capabilities (Permissões Refarm)** atuarão como um **superset (superconjunto)** das permissões nativas do navegador. O Kernel Refarm será o único intermediário ("proxy") entre o plugin e as APIs do navegador.

1. **Manifest Declaration**: Plugins devem declarar no seu manifesto (e na struct `plugin-metadata` do WIT) necessidades como `native:camera` ou `native:geolocation`.
2. **Kernel Proxying**: Quando o plugin tenta utilizar o recurso (via métodos definidos no `kernel-bridge` do WIT, como `capture-media()` ou `get-location()`), o Kernel fará a chamada real à API do browser.
3. **Traceability e Auditoria**: Isso permite que a UI do "Refarm Studio" diga exatamente *qual plugin* está usando a câmera ou solicitando a localização. Se deixássemos o plugin acessar o DOM diretamente, o navegador apenas alertaria "Refarm Studio quer usar sua câmera", sem granularidade. Sendo o Kernel o intermediário, podemos injetar uma tela de consentimento prévia: "O Plugin XYZ quer acesso à sua câmera. Permitir?".
4. **Revogação Específica**: O usuário pode revogar o acesso à câmera *apenas para o Plugin XYZ*, mantendo ativo para o Plugin ABC. Isso seria impossível contando apenas com a permissão global do navegador.

**Consequences**:

- **Positivas**: Segurança extrema, transparência e controle total do usuário sobre qual módulo (plugin) faz o que. Auditoria em nível de componente e UX aprimorada em relação à privacidade.
- **Negativas**: O contrato WIT (`refarm-sdk.wit`) precisará crescer ("inchar" controladamente) para prover abstrações sobre as APIs do navegador na medida em que plugins precisarem delas (ex: `get-geolocation() -> result<location>`).

**Proof of Status**:
Aprovado durante a fase de validação (Pre-Sprint 1) por proposição do desenvolvedor principal. Integrado ao Workflow SDD.
