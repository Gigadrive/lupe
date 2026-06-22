import { describe, expect, test } from "vitest";
import { coerceFindings, coerceVerify, extractFirstJson, isLocalProvider } from "./local-providers";

describe("extractFirstJson", () => {
  test("pulls a balanced array out of surrounding prose", () => {
    expect(extractFirstJson("here you go: [1, 2, [3]] done", "[")).toBe("[1, 2, [3]]");
  });

  test("ignores brackets inside strings", () => {
    expect(extractFirstJson('[{"a":"]not]"}]', "[")).toBe('[{"a":"]not]"}]');
  });

  test("returns undefined when absent", () => {
    expect(extractFirstJson("no json here", "{")).toBeUndefined();
  });
});

describe("coerceFindings", () => {
  test("validates and keeps well-formed findings, drops junk", () => {
    const text = `Sure, here:
    [
      {"ruleId":"lupe/security/x","title":"t","path":"a.ts","startLine":1,"endLine":1,"severity":"high","category":"security","message":"m","confidence":0.9},
      {"not":"a finding"}
    ]`;
    const out = coerceFindings(text);
    expect(out).toHaveLength(1);
    expect(out[0]!.ruleId).toBe("lupe/security/x");
    expect(out[0]!.side).toBe("RIGHT"); // schema default applied
  });

  test("returns [] when no array is present", () => {
    expect(coerceFindings("the model refused")).toEqual([]);
  });
});

describe("coerceVerify", () => {
  test("parses grounded/reason", () => {
    expect(coerceVerify('verdict: {"grounded": false, "reason": "speculative"}')).toEqual({
      grounded: false,
      reason: "speculative",
    });
  });

  test("defaults to kept when unparsable", () => {
    expect(coerceVerify("no json").grounded).toBe(true);
  });
});

describe("isLocalProvider", () => {
  test("recognises the local backends", () => {
    expect(isLocalProvider("claude-cli")).toBe(true);
    expect(isLocalProvider("codex-cli")).toBe(true);
    expect(isLocalProvider("anthropic")).toBe(false);
  });
});
