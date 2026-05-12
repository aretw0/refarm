# @refarm.dev/infra-contract-v1

Provider-neutral infrastructure planning contracts for Refarm-managed services.

This package intentionally contains contracts only. It does not provision
resources, execute provider CLIs, read credentials, or depend on provider SDKs.

## Concepts

- `ManagedServicePlan` describes what a semantic service block needs.
- `ManagedResourceRequirement` describes provider-neutral requirements such as
  artifact storage, an HTTP endpoint, or bearer authentication.
- `ProviderProvisionPlan` describes how a provider adapter materializes a
  managed service plan into concrete resources.
- `ProviderProvisionResource` describes concrete provider-side resources such as
  a bucket, Worker, secret, database, queue, or deployment.

Provider-neutral service blocks should depend on this package. Provider-specific
adapters should map those service plans into provider resources without changing
the semantic service contract.
