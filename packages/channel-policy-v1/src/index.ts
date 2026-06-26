export const CHANNEL_POLICY_CAPABILITY = "channel-policy:v1" as const;
export const CHANNEL_DELIVERY_ENVELOPE_SCHEMA =
	"refarm.channel-delivery-envelope.v1" as const;

export const CHANNEL_REVIEW_STATES = [
	"not-required",
	"pending",
	"approved",
	"rejected",
] as const;

export const CHANNEL_DELIVERY_STATUSES = [
	"queued",
	"dry-run",
	"sent",
	"delivered",
	"failed",
	"rate-limited",
	"cancelled",
] as const;

export type ChannelReviewState = (typeof CHANNEL_REVIEW_STATES)[number];
export type ChannelDeliveryStatus = (typeof CHANNEL_DELIVERY_STATUSES)[number];

export interface ChannelContentHash {
	readonly algorithm: "sha256";
	readonly value: string;
}

export interface ChannelDestinationRef {
	readonly id: string;
	readonly channelId: string;
	readonly providerId: string;
	readonly address: string;
	readonly displayName?: string;
	readonly tags?: readonly string[];
}

export interface ChannelRateLimitWindow {
	readonly limit: number;
	readonly intervalSeconds: number;
	readonly burst?: number;
}

export interface ChannelRateLimitPolicy {
	readonly id: string;
	readonly scope: "provider" | "channel" | "destination" | "identity";
	readonly windows: readonly ChannelRateLimitWindow[];
}

export interface ChannelRateLimitEvidence {
	readonly policyId: string;
	readonly scopeKey: string;
	readonly remaining?: number;
	readonly resetAt?: string;
	readonly retryAfterSeconds?: number;
}

export interface ChannelReviewGate {
	readonly required: boolean;
	readonly state: ChannelReviewState;
	readonly reviewer?: string;
	readonly reviewedAt?: string;
	readonly reason?: string;
}

export interface ChannelDeliveryItem {
	readonly id: string;
	readonly channelId: string;
	readonly providerId: string;
	readonly destination: ChannelDestinationRef;
	readonly idempotencyKey: string;
	readonly contentHash: ChannelContentHash;
	readonly createdAt: string;
	readonly review: ChannelReviewGate;
	readonly rateLimitPolicy?: ChannelRateLimitPolicy;
	readonly labels?: readonly string[];
}

export interface ChannelDeliveryReceipt {
	readonly itemId: string;
	readonly status: ChannelDeliveryStatus;
	readonly observedAt: string;
	readonly providerMessageId?: string;
	readonly providerStatus?: string;
	readonly retryAfterSeconds?: number;
	readonly error?: string;
	readonly rateLimit?: ChannelRateLimitEvidence;
}

export interface ChannelDryRunResult {
	readonly itemId: string;
	readonly ok: boolean;
	readonly checkedAt: string;
	readonly reviewState: ChannelReviewState;
	readonly blockedBy?: readonly string[];
	readonly rateLimit?: ChannelRateLimitEvidence;
}

export interface ChannelDeliveryEnvelope {
	readonly schema: typeof CHANNEL_DELIVERY_ENVELOPE_SCHEMA;
	readonly createdAt: string;
	readonly producer: string;
	readonly deliveries: readonly ChannelDeliveryItem[];
	readonly dryRuns?: readonly ChannelDryRunResult[];
	readonly receipts?: readonly ChannelDeliveryReceipt[];
}

export interface ChannelPolicyValidationIssue {
	readonly path: string;
	readonly message: string;
}

export interface ChannelPolicyValidationResult {
	readonly ok: boolean;
	readonly issues: readonly ChannelPolicyValidationIssue[];
}

const REVIEW_STATE_SET = new Set<string>(CHANNEL_REVIEW_STATES);
const DELIVERY_STATUS_SET = new Set<string>(CHANNEL_DELIVERY_STATUSES);

export function buildChannelIdempotencyKey(input: {
	readonly channelId: string;
	readonly destinationId: string;
	readonly contentHash: ChannelContentHash;
	readonly logicalKey?: string;
}): string {
	const logical = input.logicalKey ? `:${encodePart(input.logicalKey)}` : "";
	return [
		"channel-delivery",
		encodePart(input.channelId),
		encodePart(input.destinationId),
		input.contentHash.algorithm,
		input.contentHash.value,
	].join(":") + logical;
}

export function validateChannelDeliveryEnvelope(
	value: unknown,
): ChannelPolicyValidationResult {
	const issues: ChannelPolicyValidationIssue[] = [];
	validateEnvelope(value, "$", issues);
	return { ok: issues.length === 0, issues };
}

export function isChannelDeliveryEnvelope(
	value: unknown,
): value is ChannelDeliveryEnvelope {
	return validateChannelDeliveryEnvelope(value).ok;
}

function encodePart(value: string): string {
	return encodeURIComponent(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
	return typeof value === "string" && value.length > 0;
}

function requireString(
	value: unknown,
	path: string,
	issues: ChannelPolicyValidationIssue[],
): void {
	if (!isNonEmptyString(value)) {
		issues.push({ path, message: "Expected a non-empty string." });
	}
}

function validateStringArray(
	value: unknown,
	path: string,
	issues: ChannelPolicyValidationIssue[],
): void {
	if (!Array.isArray(value)) {
		issues.push({ path, message: "Expected an array." });
		return;
	}
	value.forEach((item, index) =>
		requireString(item, `${path}.${index}`, issues),
	);
}

function validateNonNegativeInteger(
	value: unknown,
	path: string,
	issues: ChannelPolicyValidationIssue[],
): void {
	if (!Number.isInteger(value) || (value as number) < 0) {
		issues.push({ path, message: "Expected a non-negative integer." });
	}
}

function validatePositiveInteger(
	value: unknown,
	path: string,
	issues: ChannelPolicyValidationIssue[],
): void {
	if (!Number.isInteger(value) || (value as number) <= 0) {
		issues.push({ path, message: "Expected a positive integer." });
	}
}

function validateHash(
	value: unknown,
	path: string,
	issues: ChannelPolicyValidationIssue[],
): void {
	if (!isRecord(value)) {
		issues.push({ path, message: "Expected a content hash object." });
		return;
	}
	if (value.algorithm !== "sha256") {
		issues.push({ path: `${path}.algorithm`, message: "Expected sha256." });
	}
	if (!isNonEmptyString(value.value) || !/^[a-f0-9]{64}$/.test(value.value)) {
		issues.push({
			path: `${path}.value`,
			message: "Expected a 64-char lowercase hex digest.",
		});
	}
}

function validateDestination(
	value: unknown,
	path: string,
	issues: ChannelPolicyValidationIssue[],
): void {
	if (!isRecord(value)) {
		issues.push({ path, message: "Expected a destination reference object." });
		return;
	}
	requireString(value.id, `${path}.id`, issues);
	requireString(value.channelId, `${path}.channelId`, issues);
	requireString(value.providerId, `${path}.providerId`, issues);
	requireString(value.address, `${path}.address`, issues);
	if (value.displayName !== undefined) {
		requireString(value.displayName, `${path}.displayName`, issues);
	}
	if (value.tags !== undefined) {
		validateStringArray(value.tags, `${path}.tags`, issues);
	}
}

function validateRateLimitPolicy(
	value: unknown,
	path: string,
	issues: ChannelPolicyValidationIssue[],
): void {
	if (!isRecord(value)) {
		issues.push({ path, message: "Expected a rate-limit policy object." });
		return;
	}
	requireString(value.id, `${path}.id`, issues);
	if (
		value.scope !== "provider" &&
		value.scope !== "channel" &&
		value.scope !== "destination" &&
		value.scope !== "identity"
	) {
		issues.push({
			path: `${path}.scope`,
			message: "Expected provider, channel, destination, or identity.",
		});
	}
	if (!Array.isArray(value.windows) || value.windows.length === 0) {
		issues.push({
			path: `${path}.windows`,
			message: "Expected at least one rate-limit window.",
		});
		return;
	}
	value.windows.forEach((window, index) => {
		const windowPath = `${path}.windows.${index}`;
		if (!isRecord(window)) {
			issues.push({
				path: windowPath,
				message: "Expected a rate-limit window object.",
			});
			return;
		}
		validatePositiveInteger(window.limit, `${windowPath}.limit`, issues);
		validatePositiveInteger(
			window.intervalSeconds,
			`${windowPath}.intervalSeconds`,
			issues,
		);
		if (window.burst !== undefined) {
			validateNonNegativeInteger(window.burst, `${windowPath}.burst`, issues);
		}
	});
}

function validateReviewGate(
	value: unknown,
	path: string,
	issues: ChannelPolicyValidationIssue[],
): void {
	if (!isRecord(value)) {
		issues.push({ path, message: "Expected a review gate object." });
		return;
	}
	if (typeof value.required !== "boolean") {
		issues.push({ path: `${path}.required`, message: "Expected a boolean." });
	}
	if (!isNonEmptyString(value.state) || !REVIEW_STATE_SET.has(value.state)) {
		issues.push({ path: `${path}.state`, message: "Expected a valid review state." });
	}
	if (value.reviewer !== undefined) {
		requireString(value.reviewer, `${path}.reviewer`, issues);
	}
	if (value.reviewedAt !== undefined) {
		requireString(value.reviewedAt, `${path}.reviewedAt`, issues);
	}
	if (value.reason !== undefined) {
		requireString(value.reason, `${path}.reason`, issues);
	}
}

function validateRateLimitEvidence(
	value: unknown,
	path: string,
	issues: ChannelPolicyValidationIssue[],
): void {
	if (!isRecord(value)) {
		issues.push({ path, message: "Expected rate-limit evidence object." });
		return;
	}
	requireString(value.policyId, `${path}.policyId`, issues);
	requireString(value.scopeKey, `${path}.scopeKey`, issues);
	if (value.remaining !== undefined) {
		validateNonNegativeInteger(value.remaining, `${path}.remaining`, issues);
	}
	if (value.resetAt !== undefined) {
		requireString(value.resetAt, `${path}.resetAt`, issues);
	}
	if (value.retryAfterSeconds !== undefined) {
		validateNonNegativeInteger(
			value.retryAfterSeconds,
			`${path}.retryAfterSeconds`,
			issues,
		);
	}
}

function validateDeliveryItem(
	value: unknown,
	path: string,
	issues: ChannelPolicyValidationIssue[],
): void {
	if (!isRecord(value)) {
		issues.push({ path, message: "Expected a delivery item object." });
		return;
	}
	requireString(value.id, `${path}.id`, issues);
	requireString(value.channelId, `${path}.channelId`, issues);
	requireString(value.providerId, `${path}.providerId`, issues);
	validateDestination(value.destination, `${path}.destination`, issues);
	requireString(value.idempotencyKey, `${path}.idempotencyKey`, issues);
	validateHash(value.contentHash, `${path}.contentHash`, issues);
	requireString(value.createdAt, `${path}.createdAt`, issues);
	validateReviewGate(value.review, `${path}.review`, issues);
	if (value.rateLimitPolicy !== undefined) {
		validateRateLimitPolicy(
			value.rateLimitPolicy,
			`${path}.rateLimitPolicy`,
			issues,
		);
	}
	if (value.labels !== undefined) {
		validateStringArray(value.labels, `${path}.labels`, issues);
	}
}

function validateDryRun(
	value: unknown,
	path: string,
	issues: ChannelPolicyValidationIssue[],
	deliveryIds: ReadonlySet<string>,
): void {
	if (!isRecord(value)) {
		issues.push({ path, message: "Expected a dry-run result object." });
		return;
	}
	requireString(value.itemId, `${path}.itemId`, issues);
	if (isNonEmptyString(value.itemId) && !deliveryIds.has(value.itemId)) {
		issues.push({ path: `${path}.itemId`, message: "Unknown delivery item id." });
	}
	if (typeof value.ok !== "boolean") {
		issues.push({ path: `${path}.ok`, message: "Expected a boolean." });
	}
	requireString(value.checkedAt, `${path}.checkedAt`, issues);
	if (
		!isNonEmptyString(value.reviewState) ||
		!REVIEW_STATE_SET.has(value.reviewState)
	) {
		issues.push({
			path: `${path}.reviewState`,
			message: "Expected a valid review state.",
		});
	}
	if (value.blockedBy !== undefined) {
		validateStringArray(value.blockedBy, `${path}.blockedBy`, issues);
	}
	if (value.rateLimit !== undefined) {
		validateRateLimitEvidence(value.rateLimit, `${path}.rateLimit`, issues);
	}
}

function validateReceipt(
	value: unknown,
	path: string,
	issues: ChannelPolicyValidationIssue[],
	deliveryIds: ReadonlySet<string>,
): void {
	if (!isRecord(value)) {
		issues.push({ path, message: "Expected a delivery receipt object." });
		return;
	}
	requireString(value.itemId, `${path}.itemId`, issues);
	if (isNonEmptyString(value.itemId) && !deliveryIds.has(value.itemId)) {
		issues.push({ path: `${path}.itemId`, message: "Unknown delivery item id." });
	}
	if (!isNonEmptyString(value.status) || !DELIVERY_STATUS_SET.has(value.status)) {
		issues.push({
			path: `${path}.status`,
			message: "Expected a valid delivery status.",
		});
	}
	requireString(value.observedAt, `${path}.observedAt`, issues);
	if (value.providerMessageId !== undefined) {
		requireString(value.providerMessageId, `${path}.providerMessageId`, issues);
	}
	if (value.providerStatus !== undefined) {
		requireString(value.providerStatus, `${path}.providerStatus`, issues);
	}
	if (value.retryAfterSeconds !== undefined) {
		validateNonNegativeInteger(
			value.retryAfterSeconds,
			`${path}.retryAfterSeconds`,
			issues,
		);
	}
	if (value.error !== undefined) {
		requireString(value.error, `${path}.error`, issues);
	}
	if (value.rateLimit !== undefined) {
		validateRateLimitEvidence(value.rateLimit, `${path}.rateLimit`, issues);
	}
}

function validateEnvelope(
	value: unknown,
	path: string,
	issues: ChannelPolicyValidationIssue[],
): void {
	if (!isRecord(value)) {
		issues.push({ path, message: "Expected a channel delivery envelope object." });
		return;
	}
	if (value.schema !== CHANNEL_DELIVERY_ENVELOPE_SCHEMA) {
		issues.push({
			path: `${path}.schema`,
			message: `Expected ${CHANNEL_DELIVERY_ENVELOPE_SCHEMA}.`,
		});
	}
	requireString(value.createdAt, `${path}.createdAt`, issues);
	requireString(value.producer, `${path}.producer`, issues);
	if (!Array.isArray(value.deliveries)) {
		issues.push({ path: `${path}.deliveries`, message: "Expected an array." });
		return;
	}
	const deliveryIds = new Set<string>();
	value.deliveries.forEach((delivery, index) => {
		validateDeliveryItem(delivery, `${path}.deliveries.${index}`, issues);
		if (isRecord(delivery) && isNonEmptyString(delivery.id)) {
			if (deliveryIds.has(delivery.id)) {
				issues.push({
					path: `${path}.deliveries.${index}.id`,
					message: "Duplicate delivery item id.",
				});
			}
			deliveryIds.add(delivery.id);
		}
	});
	if (value.dryRuns !== undefined) {
		if (!Array.isArray(value.dryRuns)) {
			issues.push({ path: `${path}.dryRuns`, message: "Expected an array." });
		} else {
			value.dryRuns.forEach((dryRun, index) =>
				validateDryRun(dryRun, `${path}.dryRuns.${index}`, issues, deliveryIds),
			);
		}
	}
	if (value.receipts !== undefined) {
		if (!Array.isArray(value.receipts)) {
			issues.push({ path: `${path}.receipts`, message: "Expected an array." });
		} else {
			value.receipts.forEach((receipt, index) =>
				validateReceipt(
					receipt,
					`${path}.receipts.${index}`,
					issues,
					deliveryIds,
				),
			);
		}
	}
}
