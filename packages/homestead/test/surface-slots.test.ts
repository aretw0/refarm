import { createMockManifest } from "@refarm.dev/plugin-manifest";
import { describe, expect, it } from "vitest";
import {
	resolveHomesteadSurfaceActivationPlan,
	resolveHomesteadSurfaceMounts,
	resolveHomesteadSurfaceSlots,
} from "../src/sdk/surface-slots";

describe("resolveHomesteadSurfaceSlots", () => {
	it("combines legacy UI slots with homestead extension surfaces", () => {
		const manifest = createMockManifest({
			ui: { slots: ["main", "statusbar", "main"] },
			extensions: {
				surfaces: [
					{
						layer: "homestead",
						kind: "panel",
						id: "stream-panel",
						slot: "main",
					},
					{
						layer: "homestead",
						kind: "panel",
						id: "activity-panel",
						slot: "activity",
					},
					{
						layer: "automation",
						kind: "workflow-step",
						id: "ignored",
						slot: "automation",
					},
				],
			},
		});

		expect(resolveHomesteadSurfaceSlots(manifest)).toEqual([
			"main",
			"statusbar",
			"activity",
		]);
		expect(resolveHomesteadSurfaceMounts(manifest)).toMatchObject([
			{ slotId: "main", source: "legacy-ui-slot" },
			{ slotId: "statusbar", source: "legacy-ui-slot" },
			{
				slotId: "main",
				source: "extension-surface",
				surface: { id: "stream-panel", kind: "panel" },
			},
			{
				slotId: "activity",
				source: "extension-surface",
				surface: { id: "activity-panel", kind: "panel" },
			},
		]);
	});

	it("ignores homestead surfaces that require unauthorized capabilities", () => {
		const manifest = createMockManifest({
			ui: { slots: ["statusbar"] },
			extensions: {
				surfaces: [
					{
						layer: "homestead",
						kind: "panel",
						id: "authorized-stream-panel",
						slot: "streams",
						capabilities: ["ui:stream:read"],
					},
					{
						layer: "homestead",
						kind: "panel",
						id: "unauthorized-secrets-panel",
						slot: "secrets",
						capabilities: ["ui:secrets:read"],
					},
				],
			},
		});

		expect(resolveHomesteadSurfaceSlots(manifest)).toEqual([
			"statusbar",
			"streams",
		]);
		expect(
			resolveHomesteadSurfaceSlots(manifest, {
				allowedCapabilities: ["ui:secrets:read"],
			}),
		).toEqual(["statusbar", "secrets"]);
	});

	it("returns explicit activation rejections for unactionable surfaces", () => {
		const manifest = createMockManifest({
			extensions: {
				surfaces: [
					{
						layer: "homestead",
						kind: "panel",
						id: "missing-slot",
					},
					{
						layer: "homestead",
						kind: "panel",
						id: "secrets-panel",
						slot: "main",
						capabilities: ["ui:secrets:read", "ui:panel:render"],
					},
					{
						layer: "homestead",
						kind: "panel",
						id: "duplicate-panel",
						slot: "main",
					},
					{
						layer: "homestead",
						kind: "panel",
						id: "duplicate-panel",
						slot: "statusbar",
					},
				],
			},
		});

		const plan = resolveHomesteadSurfaceActivationPlan(manifest);

		expect(plan.mounts).toMatchObject([
			{ slotId: "main", source: "legacy-ui-slot" },
			{
				slotId: "main",
				source: "extension-surface",
				surface: { id: "duplicate-panel" },
			},
		]);
		expect(plan.rejected).toMatchObject([
			{ reason: "missing-slot", surface: { id: "missing-slot" } },
			{
				reason: "unsupported-capability",
				surface: { id: "secrets-panel" },
				missingCapabilities: ["ui:secrets:read"],
			},
			{ reason: "duplicate-surface-id", surface: { id: "duplicate-panel" } },
		]);
	});

	it("rejects homestead surfaces targeting slots that the host does not expose", () => {
		const manifest = createMockManifest({
			ui: { slots: ["main", "ghost-legacy"] },
			extensions: {
				surfaces: [
					{
						layer: "homestead",
						kind: "panel",
						id: "known-panel",
						slot: "main",
					},
					{
						layer: "homestead",
						kind: "panel",
						id: "ghost-panel",
						slot: "ghost",
					},
				],
			},
		});

		const plan = resolveHomesteadSurfaceActivationPlan(manifest, {
			availableSlots: ["main", "statusbar"],
		});

		expect(plan.mounts).toMatchObject([
			{ slotId: "main", source: "legacy-ui-slot" },
			{
				slotId: "main",
				source: "extension-surface",
				surface: { id: "known-panel" },
			},
		]);
		expect(plan.mounts).not.toMatchObject([
			{ slotId: "ghost-legacy" },
		]);
		expect(plan.rejected).toMatchObject([
			{ reason: "unknown-slot", surface: { id: "ghost-panel" } },
		]);
	});

	it("rejects homestead surfaces with unsupported host kinds", () => {
		const manifest = createMockManifest({
			extensions: {
				surfaces: [
					{
						layer: "homestead",
						kind: "panel",
						id: "known-panel",
						slot: "main",
					},
					{
						layer: "homestead",
						kind: "fullscreen-overlay",
						id: "overlay-panel",
						slot: "main",
					},
				],
			},
		});

		const plan = resolveHomesteadSurfaceActivationPlan(manifest);

		expect(plan.mounts).toMatchObject([
			{ slotId: "main", source: "legacy-ui-slot" },
			{
				slotId: "main",
				source: "extension-surface",
				surface: { id: "known-panel", kind: "panel" },
			},
		]);
		expect(plan.rejected).toMatchObject([
			{
				reason: "unsupported-kind",
				surface: { id: "overlay-panel", kind: "fullscreen-overlay" },
			},
		]);

		expect(
			resolveHomesteadSurfaceActivationPlan(manifest, {
				allowedKinds: ["panel", "fullscreen-overlay"],
			}).rejected,
		).toEqual([]);
	});
});
