import { describe, expect, test } from "vitest";
import { type Finding, renderSarif } from "@gigadrive/lupe-core";

/**
 * SARIF 2.1.0 structural-validity gate. Asserts the renderer output meets the
 * subset of the spec that GitHub code scanning (`upload-sarif`) requires:
 * version, tool.driver, rule indexing, result locations + regions, and
 * partialFingerprints. Keeps a regression net without bundling the full schema.
 */

function finding(o: Partial<Finding> = {}): Finding {
  return {
    ruleId: "lupe/correctness/off-by-one",
    title: "Off-by-one in loop bound",
    path: "src/loop.ts",
    startLine: 4,
    endLine: 6,
    side: "RIGHT",
    severity: "medium",
    category: "correctness",
    message: "Loop runs one iteration too far.",
    confidence: 0.8,
    evidence: [],
    ...o,
  };
}

describe("SARIF 2.1.0 validity", () => {
  const log = renderSarif(
    [
      finding(),
      finding({ ruleId: "lupe/security/xss", category: "security", severity: "critical", path: "src/x.ts" }),
      finding({ startLine: 20, endLine: 20 }), // same rule as first → dedup
    ],
    { version: "1.0.0" },
  );

  test("has version and exactly one run", () => {
    expect(log.version).toBe("2.1.0");
    expect(log.$schema).toMatch(/sarif-2\.1\.0/);
    expect(log.runs).toHaveLength(1);
  });

  test("driver carries deduped rules with valid default levels", () => {
    const rules = log.runs[0]!.tool.driver.rules;
    const ids = rules.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length); // no duplicate rule ids
    for (const r of rules) {
      expect(r.id).toBeTruthy();
      expect(["error", "warning", "note"]).toContain(r.defaultConfiguration.level);
    }
  });

  test("every result references a rule and a physical location with a region", () => {
    const run = log.runs[0]!;
    for (const result of run.results) {
      expect(result.ruleIndex).toBeGreaterThanOrEqual(0);
      expect(run.tool.driver.rules[result.ruleIndex]!.id).toBe(result.ruleId);
      const region = result.locations[0]!.physicalLocation.region;
      expect(region.startLine).toBeGreaterThanOrEqual(1);
      expect(region.endLine).toBeGreaterThanOrEqual(region.startLine);
      expect(Object.keys(result.partialFingerprints).length).toBeGreaterThan(0);
    }
  });
});
