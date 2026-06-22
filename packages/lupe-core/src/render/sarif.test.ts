import { describe, expect, test } from "vitest";
import type { Finding } from "../finding";
import { findingFingerprint, renderSarif } from "./sarif";

function finding(overrides: Partial<Finding> = {}): Finding {
  return {
    ruleId: "lupe/security/sql-injection",
    title: "Unparameterised SQL",
    path: "src/db.ts",
    startLine: 10,
    endLine: 12,
    side: "RIGHT",
    severity: "high",
    category: "security",
    message: "Use a parameterised query.",
    confidence: 0.9,
    evidence: [],
    ...overrides,
  };
}

describe("renderSarif", () => {
  test("produces a valid SARIF 2.1.0 skeleton", () => {
    const log = renderSarif([finding()], { version: "1.2.3" });
    expect(log.version).toBe("2.1.0");
    expect(log.$schema).toContain("sarif-2.1.0");
    expect(log.runs).toHaveLength(1);
    expect(log.runs[0]!.tool.driver.name).toBe("lupe");
    expect(log.runs[0]!.tool.driver.version).toBe("1.2.3");
  });

  test("dedups rules and indexes results into them", () => {
    const log = renderSarif([
      finding(),
      finding({ startLine: 30, endLine: 30 }),
      finding({ ruleId: "lupe/performance/n-plus-one", category: "performance", severity: "medium" }),
    ]);
    const run = log.runs[0]!;
    expect(run.tool.driver.rules).toHaveLength(2);
    expect(run.results).toHaveLength(3);
    expect(run.results[0]!.ruleIndex).toBe(0);
    expect(run.results[2]!.ruleIndex).toBe(1);
    expect(run.results[0]!.level).toBe("error");
    expect(run.results[2]!.level).toBe("warning");
  });

  test("each result carries a region and a stable fingerprint", () => {
    const f = finding();
    const log = renderSarif([f]);
    const result = log.runs[0]!.results[0]!;
    expect(result.locations[0]!.physicalLocation.region.startLine).toBe(10);
    expect(result.locations[0]!.physicalLocation.region.endLine).toBe(12);
    expect(result.locations[0]!.physicalLocation.artifactLocation.uri).toBe("src/db.ts");
    expect(result.partialFingerprints["lupeFindingHash/v1"]).toBe(findingFingerprint(f));
  });

  test("fingerprint is deterministic and content-sensitive", () => {
    expect(findingFingerprint(finding())).toBe(findingFingerprint(finding()));
    expect(findingFingerprint(finding())).not.toBe(findingFingerprint(finding({ title: "Different" })));
  });
});
