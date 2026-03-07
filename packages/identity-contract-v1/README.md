# @refarm.dev/identity-contract-v1

Versioned identity capability contract for Refarm plugin ecosystem.

## Installation

```bash
npm install @refarm.dev/identity-contract-v1
```

## Usage

### For Plugin Implementers

Implement the `IdentityProvider` interface and validate with conformance suite:

```typescript
import {
  runIdentityV1Conformance,
  type IdentityProvider,
  type Identity,
  type SignatureResult,
  type VerificationResult,
  IDENTITY_CAPABILITY
} from "@refarm.dev/identity-contract-v1";

export class MyIdentityProvider implements IdentityProvider {
  readonly pluginId = "@mycompany/identity-passkeys";
  readonly capability = IDENTITY_CAPABILITY;

  async create(displayName?: string): Promise<Identity> {
    // Your implementation
  }

  async sign(identityId: string, data: string): Promise<SignatureResult> {
    // Your implementation
  }

  async verify(signature: string, data: string): Promise<VerificationResult> {
    // Your implementation
  }

  async get(identityId: string): Promise<Identity | null> {
    // Your implementation
  }
}

// Validate conformance
describe("MyIdentityProvider conformance", () => {
  it("passes identity:v1 contract", async () => {
    const provider = new MyIdentityProvider();
    const result = await runIdentityV1Conformance(provider);
    
    expect(result.pass).toBe(true);
    if (!result.pass) {
      console.error("Conformance failures:", result.failures);
    }
  });
});
```

### For Consumers

Use any `identity:v1` compatible provider:

```typescript
import type { IdentityProvider } from "@refarm.dev/identity-contract-v1";
import { createMyIdentityProvider } from "@mycompany/identity-passkeys";

const identity: IdentityProvider = createMyIdentityProvider();

const newIdentity = await identity.create("Alice");
console.log("Created:", newIdentity.id, newIdentity.publicKey);

const signature = await identity.sign(newIdentity.id, "Hello World");
const verification = await identity.verify(signature.signature, "Hello World");
console.log("Valid signature:", verification.valid);
```

## API

### `IdentityProvider`

```typescript
interface IdentityProvider {
  readonly pluginId: string;
  readonly capability: "identity:v1";
  
  create(displayName?: string): Promise<Identity>;
  sign(identityId: string, data: string): Promise<SignatureResult>;
  verify(signature: string, data: string): Promise<VerificationResult>;
  get(identityId: string): Promise<Identity | null>;
}
```

### `Identity`

```typescript
interface Identity {
  id: string;
  publicKey: string;
  displayName?: string;
  createdAt: string;  // ISO 8601
}
```

### `SignatureResult`

```typescript
interface SignatureResult {
  signature: string;
  algorithm: string;
}
```

### `VerificationResult`

```typescript
interface VerificationResult {
  valid: boolean;
  identity: Identity;
}
```

### `runIdentityV1Conformance(provider)`

Validates a provider implementation against `identity:v1` contract.

Returns `IdentityConformanceResult`:
```typescript
{
  pass: boolean;
  total: number;
  failed: number;
  failures: string[];
}
```

## Telemetry

Providers should emit telemetry events for observability:

```typescript
interface IdentityTelemetryEvent {
  traceId: string;
  pluginId: string;
  capability: "identity:v1";
  operation: "create" | "sign" | "verify" | "get";
  durationMs: number;
  ok: boolean;
  errorCode?: "NOT_FOUND" | "INVALID_KEY" | "AUTH_FAILED" | "REVOKED" | "INTERNAL";
}
```

## Versioning

This is `identity:v1`. Breaking changes will increment the capability version (e.g., `identity:v2`).

## License

MIT
