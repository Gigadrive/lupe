import { describe, expect, test } from "vitest";
import { reviewDiff } from "./index";

describe("lupe-sdk reviewDiff", () => {
  test("an empty diff returns no findings without calling the model", async () => {
    const result = await reviewDiff({
      ai: { provider: "anthropic", apiKey: "test-key-unused" },
      diff: "",
    });
    expect(result.findings).toEqual([]);
    expect(result.cost.costUsd).toBe(0);
  });

  test("exposes a SARIF renderer", async () => {
    const result = await reviewDiff({ ai: { provider: "anthropic", apiKey: "x" }, diff: "" });
    const sarif = result.sarif();
    expect(sarif.version).toBe("2.1.0");
    expect(sarif.runs[0]!.results).toEqual([]);
  });
});
