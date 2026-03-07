# ADR-026: Externalized Storage Schema and Shared Blueprints

**Date**: 2026-03-07
**Status**: Proposed (Refined)
**Context**:
O `Tractor` (núcleo) não deve conter SQL. No entanto, se movermos as migrações SQL puramente para cada adaptador individual (`storage-sqlite`, `storage-pglite`), corremos o risco de **duplicação de lógica** e **caos de manutenção**, pois o "Coração do Refarm" (as tabelas `nodes`, `plugins`, `crdt_log`) é o mesmo para qualquer banco SQL no navegador.

Além disso, a descoberta do **PGlite** (PostgreSQL em WASM com suporte a OPFS) valida que o Refarm pode escalar para além do SQLite no mesmo ambiente "sandbox" do navegador.

**Decision**:
Vamos externalizar o schema físico para um local compartilhado, mas fora do núcleo.

1. **`@refarm.dev/storage-contract-v1` como Autoridade de Schema**: Este pacote passará a exportar um objeto `PHYSICAL_SCHEMA_V1` contendo os templates SQL ANSI-compatíveis.
2. **Abstração no Tractor**: O `Tractor` continua sem saber SQL. Ele apenas chama `adapter.ensureSchema()`.
3. **Reuso nos Adaptadores**: Adaptadores baseados em SQL (SQLite, PGlite) importarão esse `PHYSICAL_SCHEMA_V1` do contrato para inicializar suas tabelas, garantindo que o Refarm tenha a mesma estrutura independente do motor. Adaptadores NoSQL (IndexedDB) ignorarão o SQL e implementarão sua própria lógica baseada no contrato.

**Consequences**:
- **Positivas:** 
  - **DRY (Don't Repeat Yourself)**: O schema central do Refarm é definido em um único lugar.
  - **Agnóstico**: O Tractor permanece puro e sem strings SQL.
  - **Futuro Pródigo**: Facilita a criação de novos adaptadores (basta "plugar" o schema padrão).
- **Negativas:** 
  - Cria uma dependência de "build-time" entre os adaptadores e o pacote de contrato (o que já existe e é desejado).
