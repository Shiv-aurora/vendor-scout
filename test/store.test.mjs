import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FileDemoStore } from "../lib/store.mjs";

test("file store persists the local demo across instances", async () => {
  const directory = await mkdtemp(join(tmpdir(), "vendor-scout-store-"));
  const path = join(directory, "runtime.json");
  const initial = { product: { name: "Sample" }, sources: [] };
  const first = await new FileDemoStore(path).init(initial);
  await first.write({ ...initial, sources: [{ id: "source-1", state: "healthy" }] });
  const second = await new FileDemoStore(path).init(initial);
  const snapshot = await second.snapshot();
  assert.equal(snapshot.product.name, "Sample");
  assert.equal(snapshot.sources[0].state, "healthy");
  const mode = (await stat(path)).mode & 0o777;
  assert.equal(mode, 0o600);
});
