import assert from "node:assert/strict";
import test from "node:test";
import { decodeToml, encodeToml } from "../src/index.mts";

test("decodes and re-encodes the recovered TOML value tree", () => {
  const decoded = decodeToml('title = "proof path"\n[counts]\nfiles = 3\n');
  assert.deepEqual(decoded, { title: "proof path", counts: { files: 3 } });
  assert.deepEqual(decodeToml(encodeToml(decoded)), decoded);
});
