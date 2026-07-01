import {
	createInMemoryIdentityProvider,
	type IdentityProvider,
} from "@refarm.dev/identity-contract-v1";
import {
	createInMemoryStorageProvider,
	type StorageProvider,
} from "@refarm.dev/storage-contract-v1";

import { ReferenceCredentialsProvider } from "./reference.js";

export interface InMemoryCredentialsProviderFixture {
  provider: ReferenceCredentialsProvider;
  identity: IdentityProvider;
  storage: StorageProvider;
}

export function createInMemoryCredentialsProviderFixture(): InMemoryCredentialsProviderFixture {
  const identity = createInMemoryIdentityProvider();
  const storage = createInMemoryStorageProvider();
  return {
    provider: new ReferenceCredentialsProvider({ identity, storage }),
    identity,
    storage,
  };
}
