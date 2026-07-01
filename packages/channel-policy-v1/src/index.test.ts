import { describe, expect, it } from "vitest";

import {
	buildChannelIdempotencyKey,
	CHANNEL_DELIVERY_ENVELOPE_SCHEMA,
	isChannelDeliveryEnvelope,
	validateChannelDeliveryEnvelope,
	type ChannelContentHash,
	type ChannelDeliveryEnvelope,
} from "./index.js";

const HASH: ChannelContentHash = {
	algorithm: "sha256",
	value: "a".repeat(64),
};

function baseEnvelope(): ChannelDeliveryEnvelope {
	const destination = {
		id: "matrix-room-main",
		channelId: "matrix",
		providerId: "matrix",
		address: "!room:example.test",
		tags: ["refarm-control"],
	};
	const itemId = "dispatch-effort-1";
	return {
		schema: CHANNEL_DELIVERY_ENVELOPE_SCHEMA,
		createdAt: "2026-06-26T20:10:00.000Z",
		producer: "dispatch-surface",
		deliveries: [
			{
				id: itemId,
				channelId: "matrix",
				providerId: "matrix",
				destination,
				idempotencyKey: buildChannelIdempotencyKey({
					channelId: "matrix",
					destinationId: destination.id,
					contentHash: HASH,
					logicalKey: "effort-1",
				}),
				contentHash: HASH,
				createdAt: "2026-06-26T20:10:00.000Z",
				review: {
					required: false,
					state: "not-required",
				},
				rateLimitPolicy: {
					id: "matrix-control-default",
					scope: "channel",
					windows: [{ limit: 20, intervalSeconds: 60 }],
				},
			},
		],
		dryRuns: [
			{
				itemId,
				ok: true,
				checkedAt: "2026-06-26T20:10:01.000Z",
				reviewState: "not-required",
				rateLimit: {
					policyId: "matrix-control-default",
					scopeKey: "matrix",
					remaining: 19,
					resetAt: "2026-06-26T20:11:00.000Z",
				},
			},
		],
		receipts: [
			{
				itemId,
				status: "queued",
				observedAt: "2026-06-26T20:10:02.000Z",
			},
		],
	};
}

describe("channel-policy:v1", () => {
	it("validates a Refarm channel-control delivery envelope", () => {
		const envelope = baseEnvelope();

		expect(validateChannelDeliveryEnvelope(envelope)).toEqual({
			ok: true,
			issues: [],
		});
		expect(isChannelDeliveryEnvelope(envelope)).toBe(true);
	});

	it("validates a vault-seed Telegram fixture without moving Telegram behavior upstream", () => {
		const envelope: ChannelDeliveryEnvelope = {
			...baseEnvelope(),
			producer: "vault-seed:dgk-outbox",
			deliveries: [
				{
					...baseEnvelope().deliveries[0],
					id: "telegram-publication-1",
					channelId: "telegram",
					providerId: "telegram",
					destination: {
						id: "telegram-main-channel",
						channelId: "telegram",
						providerId: "telegram",
						address: "@example_channel",
					},
					idempotencyKey: buildChannelIdempotencyKey({
						channelId: "telegram",
						destinationId: "telegram-main-channel",
						contentHash: HASH,
						logicalKey: "note:publicacao/2026-06-26",
					}),
					review: {
						required: true,
						state: "approved",
						reviewer: "operator",
						reviewedAt: "2026-06-26T20:09:00.000Z",
					},
					labels: ["publication"],
				},
			],
			dryRuns: [
				{
					itemId: "telegram-publication-1",
					ok: true,
					checkedAt: "2026-06-26T20:10:01.000Z",
					reviewState: "approved",
				},
			],
			receipts: [
				{
					itemId: "telegram-publication-1",
					status: "sent",
					observedAt: "2026-06-26T20:10:05.000Z",
					providerMessageId: "42",
					providerStatus: "ok",
				},
			],
		};

		expect(validateChannelDeliveryEnvelope(envelope).ok).toBe(true);
	});

	it("builds stable idempotency keys from channel, destination, hash, and logical key", () => {
		const key = buildChannelIdempotencyKey({
			channelId: "telegram",
			destinationId: "public channel",
			contentHash: HASH,
			logicalKey: "note:path with spaces.md",
		});

		expect(key).toBe(
			`channel-delivery:telegram:public%20channel:sha256:${HASH.value}:note%3Apath%20with%20spaces.md`,
		);
	});

	it("rejects invalid receipts and dangling evidence", () => {
		const result = validateChannelDeliveryEnvelope({
			...baseEnvelope(),
			receipts: [
				{
					itemId: "missing",
					status: "posted",
					observedAt: "",
				},
			],
		});

		expect(result.ok).toBe(false);
		expect(result.issues.map((issue) => issue.path)).toEqual(
			expect.arrayContaining([
				"$.receipts.0.itemId",
				"$.receipts.0.status",
				"$.receipts.0.observedAt",
			]),
		);
	});
});
