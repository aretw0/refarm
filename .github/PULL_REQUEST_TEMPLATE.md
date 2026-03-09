## 🚜 Refarm Pull Request

**What does this PR do?**
<!-- Describe the purpose of this PR. What problem are you solving? -->
<!-- If this resolves an active issue, mention it (e.g., "Fixes #123"). -->

## 🚦 SDD -> DDD Quality Gates
To ensure Refarm remains deterministic and secure, verify your work against the pipeline phases:

- [ ] **SDD (Specification)**: Does this align with an ADR or a Feature Spec? If so, link it.
- [ ] **BDD (Behavior)**: Are there integration tests ensuring the new behavior is verified?
- [ ] **TDD (Tests)**: Are there unit tests acting as contracts for your logic?
- [ ] **DDD (Domain)**: Are all tests and benchmarks currently passing green?

## ✅ Developer Checklist

- [ ] (`task:verify`) I have run the verify command successfully.
- [ ] I have generated a `changeset` (if applicable for published packages).
- [ ] The code follows the `SecurityMode` principles.
- [ ] If this touches CI/CD or Scripts, I have ensured automated bots won't break.
