import { Effect } from "effect";
import { describe, expect, test } from "vitest";
import type { DiffFile, Finding } from "@gigadrive/lupe-core";
import { commentableLines, resolveAnchor, toAnchor } from "./anchor";
import { parseUnifiedDiff } from "./parse";

const MODIFIED = `diff --git a/src/math.ts b/src/math.ts
--- a/src/math.ts
+++ b/src/math.ts
@@ -1,4 +1,5 @@
 export function add(a, b) {
-  return a+b
+  return a + b
+  // added line
 }
 export const X = 1`;

const file: DiffFile = parseUnifiedDiff(MODIFIED)[0]!;

function finding(o: Partial<Finding>): Pick<Finding, "path" | "startLine" | "endLine" | "side"> {
  return { path: "src/math.ts", startLine: 2, endLine: 2, side: "RIGHT", ...o };
}

describe("commentableLines", () => {
  test("maps additions/context to RIGHT and deletions to LEFT", () => {
    const lines = commentableLines(file);
    const right = lines
      .filter((l) => l.side === "RIGHT")
      .map((l) => l.line)
      .sort((a, b) => a - b);
    const left = lines.filter((l) => l.side === "LEFT").map((l) => l.line);
    expect(right).toEqual([1, 2, 3, 4, 5]);
    expect(left).toEqual([2]); // the single deleted line
  });
});

describe("resolveAnchor", () => {
  test("anchors a finding on an added line (RIGHT)", () => {
    const r = resolveAnchor(finding({ startLine: 3, endLine: 3 }), file);
    expect(r.ok).toBe(true);
    expect(r.anchor).toMatchObject({ path: "src/math.ts", line: 3, side: "RIGHT" });
    expect(r.anchor?.startLine).toBeUndefined();
  });

  test("anchors a deleted line on LEFT", () => {
    const r = resolveAnchor(finding({ startLine: 2, endLine: 2, side: "LEFT" }), file);
    expect(r.ok).toBe(true);
    expect(r.anchor).toMatchObject({ line: 2, side: "LEFT" });
  });

  test("produces a multi-line anchor when both endpoints are in the diff", () => {
    const r = resolveAnchor(finding({ startLine: 2, endLine: 3 }), file);
    expect(r.ok).toBe(true);
    expect(r.anchor).toMatchObject({ line: 3, startLine: 2, side: "RIGHT", startSide: "RIGHT" });
  });

  test("REJECTS a finding whose range is not part of the diff (the 422 case)", () => {
    const r = resolveAnchor(finding({ startLine: 50, endLine: 100 }), file);
    expect(r.ok).toBe(false);
    expect(r.anchor).toBeUndefined();
    expect(r.reason).toMatch(/not part of the diff/);
  });

  test("REJECTS a RIGHT finding that only matches a deleted (LEFT) line", () => {
    // line 2 is commentable on LEFT (deletion) but the finding asks for RIGHT@... a line with no RIGHT match
    const r = resolveAnchor({ path: "src/math.ts", startLine: 99, endLine: 99, side: "RIGHT" }, file);
    expect(r.ok).toBe(false);
  });

  test("collapses to the nearest commentable line within an over-wide range", () => {
    const r = resolveAnchor(finding({ startLine: 3, endLine: 100 }), file);
    expect(r.ok).toBe(true);
    expect(r.anchor?.line).toBe(5); // greatest commentable line <= 100 within range
  });
});

describe("toAnchor (Effect)", () => {
  test("succeeds with an Anchor", () => {
    const anchor = Effect.runSync(toAnchor(finding({ startLine: 3, endLine: 3 }), file));
    expect(anchor.line).toBe(3);
  });

  test("fails with a typed AnchorError", () => {
    const err = Effect.runSync(Effect.flip(toAnchor(finding({ startLine: 50, endLine: 100 }), file)));
    expect(err._tag).toBe("AnchorError");
    expect(err.path).toBe("src/math.ts");
  });
});
