import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const execute = promisify(execFile);

test("Vercel imports the root entrypoint as an unbound HTTP server", async () => {
  const directory = await mkdtemp(join(tmpdir(), "vendor-scout-vercel-"));
  try {
    const { stdout, stderr } = await execute(process.execPath, [
      "--input-type=module",
      "--eval",
      'const { default: server } = await import("./server.mjs"); console.log(server?.constructor?.name);'
    ], {
      cwd: new URL("..", import.meta.url),
      env: {
        ...process.env,
        VERCEL: "1",
        VENDOR_SCOUT_DATA_PATH: "",
        TMPDIR: directory
      }
    });

    assert.equal(stderr, "");
    assert.equal(stdout.trim(), "Server");
    assert.equal((await stat(join(directory, "vendor-scout-runtime.json"))).isFile(), true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
