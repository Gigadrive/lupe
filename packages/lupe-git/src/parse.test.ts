import { describe, expect, test } from 'vitest';

import { buildDiffFile, parseHunks, parseUnifiedDiff } from './parse';

const MODIFIED = `diff --git a/src/math.ts b/src/math.ts
index 1111111..2222222 100644
--- a/src/math.ts
+++ b/src/math.ts
@@ -1,4 +1,5 @@
 export function add(a, b) {
-  return a+b
+  return a + b
+  // added line
 }
 export const X = 1`;

const ADDED = `diff --git a/src/new.ts b/src/new.ts
new file mode 100644
index 0000000..3333333
--- /dev/null
+++ b/src/new.ts
@@ -0,0 +1,2 @@
+export const a = 1
+export const b = 2`;

const DELETED = `diff --git a/src/old.ts b/src/old.ts
deleted file mode 100644
index 4444444..0000000
--- a/src/old.ts
+++ /dev/null
@@ -1,2 +0,0 @@
-export const gone = 1
-export const also = 2`;

const BINARY = `diff --git a/img.png b/img.png
new file mode 100644
index 0000000..5555555
Binary files /dev/null and b/img.png differ`;

const RENAMED = `diff --git a/src/a.ts b/src/b.ts
similarity index 100%
rename from src/a.ts
rename to src/b.ts`;

describe('parseUnifiedDiff', () => {
  test('parses a modified file with correct line numbers', () => {
    const [file] = parseUnifiedDiff(MODIFIED);
    expect(file!.path).toBe('src/math.ts');
    expect(file!.status).toBe('modified');
    expect(file!.additions).toBe(2);
    expect(file!.deletions).toBe(1);
    expect(file!.hunks).toHaveLength(1);

    const lines = file!.hunks[0]!.lines;
    const del = lines.find((l) => l.kind === 'del')!;
    expect(del.oldLine).toBe(2);
    const adds = lines.filter((l) => l.kind === 'add');
    expect(adds.map((a) => a.newLine)).toEqual([2, 3]);
  });

  test('parses an added file', () => {
    const [file] = parseUnifiedDiff(ADDED);
    expect(file!.status).toBe('added');
    expect(file!.path).toBe('src/new.ts');
    expect(file!.additions).toBe(2);
  });

  test('parses a deleted file', () => {
    const [file] = parseUnifiedDiff(DELETED);
    expect(file!.status).toBe('deleted');
    expect(file!.path).toBe('src/old.ts');
    expect(file!.deletions).toBe(2);
  });

  test('flags binary files with no hunks', () => {
    const [file] = parseUnifiedDiff(BINARY);
    expect(file!.binary).toBe(true);
    expect(file!.hunks).toHaveLength(0);
  });

  test('parses a pure rename', () => {
    const [file] = parseUnifiedDiff(RENAMED);
    expect(file!.status).toBe('renamed');
    expect(file!.path).toBe('src/b.ts');
    expect(file!.oldPath).toBe('src/a.ts');
  });

  test('parses a multi-file diff', () => {
    const files = parseUnifiedDiff(`${MODIFIED}\n${ADDED}`);
    expect(files).toHaveLength(2);
    expect(files.map((f) => f.path)).toEqual(['src/math.ts', 'src/new.ts']);
  });
});

describe('buildDiffFile (GitHub patch)', () => {
  test('builds from a hunk-only patch', () => {
    const file = buildDiffFile({
      filename: 'src/x.ts',
      status: 'modified',
      patch: '@@ -1,2 +1,3 @@\n const a = 1\n+const b = 2\n const c = 3',
    });
    expect(file.path).toBe('src/x.ts');
    expect(file.status).toBe('modified');
    expect(file.additions).toBe(1);
    expect(file.binary).toBe(false);
  });

  test('treats a patch-less non-rename entry as binary', () => {
    const file = buildDiffFile({ filename: 'a.png', status: 'added' });
    expect(file.binary).toBe(true);
  });
});

describe('parseHunks', () => {
  test('handles default single-line counts (@@ -a +b @@)', () => {
    const hunks = parseHunks('@@ -5 +5 @@\n-old\n+new');
    expect(hunks[0]!.oldStart).toBe(5);
    expect(hunks[0]!.newStart).toBe(5);
  });
});
