/**
 * BDD Integration Test: TEM Sovereign Graph Reasoning Engine
 *
 * Written BEFORE verifying these scenarios run — following the SDD→BDD→TDD→DDD
 * workflow documented in docs/WORKFLOW.md.
 *
 * Describes expected user-facing behaviors:
 *   GIVEN the TEM reasoning engine is running
 *   WHEN the system observes events
 *   THEN it produces meaningful novelty signals and relational memory
 */

import { describe, it, expect, beforeEach } from "vitest";
import { TEMInference, TEMConfig } from "./core/tem-inference";
import { createRandomWeights } from "./core/weights";
import { encodeAction } from "./encoding/action-encoder";
import { StructAwareEncoder } from "./encoding/obs-encoder";

// ─── Shared Setup ────────────────────────────────────────────────────────────

const config: TEMConfig = {
  nG: [10, 10, 8, 6, 6],
  nX: 64,
  nActions: 16,
  eta: 0.5,
  lambda: 0.9999,
  kappa: 0.8,
  attractorK: 10,
};

const encoder = new StructAwareEncoder();

function makeTEM() {
  const weights = createRandomWeights(config.nG, config.nX, config.nActions);
  const tem = new TEMInference(config, weights);
  const state = tem.createState();
  return { tem, state };
}

function makeEvent(eventType: string, nodeType?: string) {
  const event = { event: eventType, pluginId: "test-plugin", durationMs: 5 };
  const node = nodeType ? { "@type": nodeType, "@id": `urn:test:${nodeType}-1` } : null;
  return {
    action: encodeAction(event),
    obs: encoder.encode(node, event),
  };
}

// ─── Scenario 1: Familiar patterns have low novelty ──────────────────────────

describe("GIVEN the TEM engine is running", () => {
  describe("WHEN the same event pattern is observed repeatedly", () => {
    it("THEN noveltyScore should decrease over repeated observations", () => {
      const { tem, state } = makeTEM();
      const { action, obs } = makeEvent("storage:io.storeNode", "Person");

      const scores: number[] = [];
      for (let i = 0; i < 10; i++) {
        const output = tem.step(state, action, obs);
        scores.push(output.noveltyScore);
      }

      // After 10 identical observations, the last score should be lower than the first
      const first = scores[0];
      const last = scores[scores.length - 1];
      expect(last).toBeLessThan(first);
    });
  });

  describe("WHEN a novel event pattern is observed after familiar ones", () => {
    it("THEN both familar and novel noveltyScores are finite non-negative numbers", () => {
      const { tem, state } = makeTEM();
      const familiar = makeEvent("storage:io.storeNode", "Person");
      const novel = makeEvent("plugin:load", "PluginManifest");

      for (let i = 0; i < 8; i++) {
        tem.step(state, familiar.action, familiar.obs);
      }
      const familiarScore = tem.step(state, familiar.action, familiar.obs).noveltyScore;
      const novelScore = tem.step(state, novel.action, novel.obs).noveltyScore;

      expect(isFinite(familiarScore)).toBe(true);
      expect(familiarScore).toBeGreaterThanOrEqual(0);
      expect(isFinite(novelScore)).toBe(true);
      expect(novelScore).toBeGreaterThanOrEqual(0);
    });

    it.todo(
      "THEN noveltyScore for a new pattern is higher than for a familiar one (requires trained weights)",
    );
  });
});

// ─── Scenario 2: Walk reset clears memory ────────────────────────────────────

describe("GIVEN the TEM has learned a pattern", () => {
  describe("WHEN resetWalk() is called", () => {
    it("THEN the internal state (g, M, hiddens) is zeroed", () => {
      const { tem, state } = makeTEM();
      const { action, obs } = makeEvent("storage:io.storeNode", "Person");

      // Learn the pattern — accumulate state
      for (let i = 0; i < 10; i++) {
        tem.step(state, action, obs);
      }

      // State should be non-zero before reset
      const mSumBefore = state.M.reduce((a, b) => a + Math.abs(b), 0);
      expect(mSumBefore).toBeGreaterThan(0);

      // Reset
      tem.resetWalk(state);

      // State must be zeroed after reset
      expect(state.M.every((v) => v === 0)).toBe(true);
      expect(state.g.every((g) => g.every((v) => v === 0))).toBe(true);
      expect(state.hiddens.every((h) => h.every((v) => v === 0))).toBe(true);
    });

    it.todo(
      "THEN the next observation of the familiar pattern has high novelty again (requires trained weights)",
    );
  });
});

// ─── Scenario 3: Struct-aware encoding is stable across node types ────────────

describe("GIVEN two different node types with the same semantic role", () => {
  describe("WHEN their observations are encoded", () => {
    it("THEN nodes of the same @type produce identical type-slot encodings", () => {
      const event = { event: "storage:io.queryNodes", pluginId: "test" };

      const nodeA = { "@type": "Person", "@id": "urn:test:person-1" };
      const nodeB = { "@type": "Person", "@id": "urn:test:person-2" }; // different @id

      const obsA = encoder.encode(nodeA, event);
      const obsB = encoder.encode(nodeB, event);

      // Type slot (dims 0-15) must be identical — type is stable regardless of @id
      const typeSlotA = obsA.slice(0, 16);
      const typeSlotB = obsB.slice(0, 16);
      expect(Array.from(typeSlotA)).toEqual(Array.from(typeSlotB));

      // Identity slot (dims 16-31) must differ — different @id
      const idSlotA = obsA.slice(16, 32);
      const idSlotB = obsB.slice(16, 32);
      expect(Array.from(idSlotA)).not.toEqual(Array.from(idSlotB));
    });
  });
});

// ─── Scenario 4: Prediction confidence is a meaningful metric ────────────────

describe("GIVEN the TEM is learning a sequence", () => {
  describe("WHEN steps are performed", () => {
    it("THEN predictionConfidence is always in the valid range [-1, 1]", () => {
      const { tem, state } = makeTEM();
      const { action, obs } = makeEvent("api:call", "TemMemory");

      for (let i = 0; i < 20; i++) {
        const output = tem.step(state, action, obs);
        expect(output.predictionConfidence).toBeGreaterThanOrEqual(-1);
        expect(output.predictionConfidence).toBeLessThanOrEqual(1);
        expect(isFinite(output.predictionConfidence)).toBe(true);
      }
    });

    it.todo(
      "THEN predictionConfidence should increase after learning the same sequence (requires trained weights)",
    );
  });
});

// ─── Scenario 5: Output shapes are correct ───────────────────────────────────

describe("GIVEN a single TEM step", () => {
  it("THEN all output vectors have the correct dimensions", () => {
    const { tem, state } = makeTEM();
    const { action, obs } = makeEvent("plugin:load", "PluginManifest");

    const output = tem.step(state, action, obs);
    const sumP = config.nG.reduce((s, g) => s + g * 3, 0); // 120

    expect(output.pInferred.length).toBe(sumP);
    expect(output.pRecalled.length).toBe(sumP);
    expect(typeof output.noveltyScore).toBe("number");
    expect(typeof output.predictionConfidence).toBe("number");
    expect(isFinite(output.noveltyScore)).toBe(true);
    expect(isFinite(output.predictionConfidence)).toBe(true);
  });
});
