import { describe, expect, test } from "vitest";
import type { AnchoredComment } from "@gigadrive/lupe-core";
import { toReviewComment } from "./client";

describe("toReviewComment", () => {
  test("maps a single-line anchor to line+side (no start_line)", () => {
    const c: AnchoredComment = { anchor: { path: "a.ts", line: 10, side: "RIGHT" }, body: "issue" };
    expect(toReviewComment(c)).toEqual({ path: "a.ts", body: "issue", line: 10, side: "RIGHT" });
  });

  test("maps a multi-line anchor to start_line/start_side + line/side", () => {
    const c: AnchoredComment = {
      anchor: { path: "a.ts", line: 12, side: "RIGHT", startLine: 10, startSide: "RIGHT" },
      body: "range issue",
    };
    expect(toReviewComment(c)).toEqual({
      path: "a.ts",
      body: "range issue",
      line: 12,
      side: "RIGHT",
      start_line: 10,
      start_side: "RIGHT",
    });
  });

  test("defaults start_side to side when omitted", () => {
    const c: AnchoredComment = {
      anchor: { path: "a.ts", line: 5, side: "LEFT", startLine: 3 },
      body: "x",
    };
    expect(toReviewComment(c).start_side).toBe("LEFT");
  });
});
