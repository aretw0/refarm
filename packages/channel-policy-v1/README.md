# @refarm.dev/channel-policy-v1

Provider-neutral channel policy and delivery evidence for downstream consumers.

This package does not call provider APIs, format messages, write inbox notes, or
persist limiter state. It only defines the shared envelope for destinations,
rate-limit policy references, review gates, dry-run results, delivery receipts,
and idempotency keys.

## Boundaries

- This package owns `channel-policy:v1` shapes and validation.
- Downstream products own provider adapters, copy formatting, note UX, and
  product commands.
- Split `contacts` or `rate-limiter` into separate packages only when
  conformance tests prove independent versioning is needed.

## Example

```ts
import {
	CHANNEL_DELIVERY_ENVELOPE_SCHEMA,
	buildChannelIdempotencyKey,
	validateChannelDeliveryEnvelope,
} from "@refarm.dev/channel-policy-v1";

const contentHash = {
	algorithm: "sha256" as const,
	value: "a".repeat(64),
};

const envelope = {
	schema: CHANNEL_DELIVERY_ENVELOPE_SCHEMA,
	createdAt: new Date().toISOString(),
	producer: "consumer-cli:publication-outbox",
	deliveries: [
		{
			id: "publication-1",
			channelId: "telegram",
			providerId: "telegram",
			destination: {
				id: "main-channel",
				channelId: "telegram",
				providerId: "telegram",
				address: "@example_channel",
			},
			idempotencyKey: buildChannelIdempotencyKey({
				channelId: "telegram",
				destinationId: "main-channel",
				contentHash,
				logicalKey: "note:publication/2026-06-26",
			}),
			contentHash,
			createdAt: new Date().toISOString(),
			review: { required: true, state: "pending" },
		},
	],
};

const result = validateChannelDeliveryEnvelope(envelope);
```
