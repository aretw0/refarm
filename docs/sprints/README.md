# Sprint Documentation

Este diretório contém documentação executável para cada sprint do projeto Refarm.

---

## Estrutura

Cada sprint tem um arquivo markdown que cobre todas as fases do workflow:

```
sprints/
  ├── README.md           ← Este arquivo
  ├── sprint-1.md         ← v0.1.0 MVP Core
  ├── sprint-2.md         ← (futuro)
  └── ...
```

---

## Formato de Sprint

Cada arquivo de sprint segue o workflow **SDD → BDD → TDD → DDD**:

### 1. SDD (Specification Driven Development)
- Specs e ADRs a criar/refinar
- Interfaces e contratos a definir
- Quality gate: Specs completas, peer reviewed

### 2. BDD (Behavior Driven Development)
- Integration tests (que FALHAM inicialmente)
- Acceptance criteria
- Quality gate: Tests escritos, reviewed

### 3. TDD (Test Driven Development)
- Unit tests (que FALHAM inicialmente)
- Contracts e mocks
- Quality gate: Coverage >80%

### 4. DDD (Domain Driven Development)
- Implementação (fazer testes passarem)
- Refactoring
- Quality gate: All tests GREEN

---

## Como Usar

1. **Durante o sprint**: Marcar checklists conforme progresso
2. **Code review**: Verificar gates antes de merge
3. **Retrospectiva**: Atualizar lições aprendidas no final

---

## Links

- [Main Roadmap](../../roadmaps/MAIN.md)
- [Workflow Guide](../WORKFLOW.md)
- [Contributing](../../CONTRIBUTING.md)
