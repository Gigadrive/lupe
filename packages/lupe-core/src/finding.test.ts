import { describe, expect, test } from "vitest";
import { canonicalRuleId, Finding, findingsJsonSchema, isAdvisory, severityToSarifLevel } from "./finding";

describe("finding model", () => {
  test("parses with defaults (side=RIGHT, evidence=[])", () => {
    const parsed = Finding.parse({
      ruleId: "lupe/security/sql-injection",
      title: "Unparameterised SQL",
      path: "src/db.ts",
      startLine: 10,
      endLine: 10,
      severity: "high",
      category: "security",
      message: "Use a parameterised query.",
      confidence: 0.9,
    });
    expect(parsed.side).toBe("RIGHT");
    expect(parsed.evidence).toEqual([]);
  });

  test("rejects malformed ruleId / confidence out of range", () => {
    expect(() =>
      Finding.parse({
        ruleId: "Bad ID!",
        title: "x",
        path: "a.ts",
        startLine: 1,
        endLine: 1,
        severity: "low",
        category: "style",
        message: "m",
        confidence: 2,
      }),
    ).toThrow();
  });

  test("severityToSarifLevel maps severities", () => {
    expect(severityToSarifLevel("critical")).toBe("error");
    expect(severityToSarifLevel("high")).toBe("error");
    expect(severityToSarifLevel("medium")).toBe("warning");
    expect(severityToSarifLevel("low")).toBe("note");
    expect(severityToSarifLevel("info")).toBe("note");
  });

  test("isAdvisory flags style/docs/test/maintainability", () => {
    expect(isAdvisory({ category: "style" })).toBe(true);
    expect(isAdvisory({ category: "docs" })).toBe(true);
    expect(isAdvisory({ category: "security" })).toBe(false);
    expect(isAdvisory({ category: "correctness" })).toBe(false);
  });

  test("canonicalRuleId normalises free-form ids", () => {
    expect(canonicalRuleId("security", "lupe/security/x")).toBe("lupe/security/x");
    expect(canonicalRuleId("performance", "N+1 Query")).toBe("lupe/performance/n-1-query");
  });

  test("findingsJsonSchema produces a JSON Schema object", () => {
    const schema = findingsJsonSchema() as Record<string, unknown>;
    expect(schema).toBeTypeOf("object");
    // array schema for the findings list
    expect(schema.type).toBe("array");
  });
});
