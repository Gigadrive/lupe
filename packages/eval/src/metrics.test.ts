import { describe, expect, test } from "vitest";
import { noiseBudget, precisionRecall } from "./metrics";

describe("precisionRecall", () => {
  test("computes TP/FP/FN, precision, recall, f1", () => {
    const r = precisionRecall(["a", "b", "c"], ["b", "c", "d"]);
    expect(r.truePositives).toBe(2);
    expect(r.falsePositives).toBe(1);
    expect(r.falseNegatives).toBe(1);
    expect(r.precision).toBeCloseTo(2 / 3);
    expect(r.recall).toBeCloseTo(2 / 3);
    expect(r.f1).toBeCloseTo(2 / 3);
  });

  test("empty predictions → precision 1, recall 0 when truth exists", () => {
    const r = precisionRecall([], ["x"]);
    expect(r.precision).toBe(1);
    expect(r.recall).toBe(0);
  });
});

describe("noiseBudget", () => {
  test("summarises mean/p90/max", () => {
    const b = noiseBudget([1, 2, 3, 4, 10]);
    expect(b.mean).toBeCloseTo(4);
    expect(b.max).toBe(10);
    expect(b.p90).toBe(10);
  });

  test("handles empty input", () => {
    expect(noiseBudget([])).toEqual({ mean: 0, p90: 0, max: 0 });
  });
});
