import { describe, it, expect } from "vitest";
import { shouldApplyProbability } from "./handleInbound.js";

describe("shouldApplyProbability", () => {
  it("returns false when probability is 0", () => {
    expect(shouldApplyProbability(0)).toBe(false);
  });

  it("returns true when probability is 100", () => {
    expect(shouldApplyProbability(100)).toBe(true);
  });

  it("returns false for negative values", () => {
    expect(shouldApplyProbability(-10)).toBe(false);
  });

  it("returns true for values above 100", () => {
    expect(shouldApplyProbability(200)).toBe(true);
  });

  it("returns false for NaN", () => {
    expect(shouldApplyProbability(NaN)).toBe(false);
  });

  it("returns false for Infinity (treated as non-finite, same as 0)", () => {
    // !Number.isFinite(Infinity) → clampProbability returns 0 → false
    expect(shouldApplyProbability(Infinity)).toBe(false);
  });

  it("is probabilistic at 50: roughly half the trials pass", () => {
    let trueCount = 0;
    const trials = 10_000;
    for (let i = 0; i < trials; i++) {
      if (shouldApplyProbability(50)) trueCount++;
    }
    // Allow wide margin: 40%–60%
    expect(trueCount).toBeGreaterThan(trials * 0.4);
    expect(trueCount).toBeLessThan(trials * 0.6);
  });
});
