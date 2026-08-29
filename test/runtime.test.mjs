import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import net from "node:net";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(error => error ? reject(error) : resolve(port));
    });
  });
}

async function startServer(environment) {
  const child = spawn(process.execPath, ["server.mjs"], {
    cwd: root,
    env: environment,
    stdio: ["ignore", "pipe", "pipe"]
  });
  let diagnostics = "";
  child.stdout.on("data", chunk => { diagnostics += chunk; });
  child.stderr.on("data", chunk => { diagnostics += chunk; });
  const baseUrl = `http://127.0.0.1:${environment.PORT}`;

  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (child.exitCode != null) throw new Error(`Server exited during startup: ${diagnostics}`);
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) return { child, baseUrl, diagnostics: () => diagnostics };
    } catch {}
    await sleep(50);
  }

  child.kill("SIGTERM");
  throw new Error(`Server did not become ready: ${diagnostics}`);
}

async function stopServer(child) {
  if (child.exitCode != null) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise(resolve => child.once("exit", resolve)),
    sleep(1000)
  ]);
}

async function postJson(url, value, headers = {}) {
  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(value)
  });
}

test("mission execution persists start, discovery, and qualification", async t => {
  const directory = await mkdtemp(join(tmpdir(), "vendor-scout-runtime-"));
  const port = await freePort();
  const environment = {
    ...process.env,
    PORT: String(port),
    NODE_ENV: "development",
    VENDOR_SCOUT_DATA_PATH: join(directory, "runtime.json"),
    VENDOR_SCOUT_AGENT_TOKEN: "",
    VENDOR_SCOUT_DISCOVERY_URL: "",
    VENDOR_SCOUT_DISCOVERY_TOKEN: ""
  };

  let runtime = await startServer(environment);
  t.after(async () => stopServer(runtime.child));

  let response = await postJson(`${runtime.baseUrl}/api/dev/reset`, { stage: "draft" });
  assert.equal(response.status, 200);
  let dashboard = await response.json();
  assert.equal(dashboard.missions[0].status, "draft");
  assert.equal(dashboard.supplierCandidates.length, 0);

  response = await postJson(`${runtime.baseUrl}/api/missions/mission-lidar-500/actions`, { action: "start" });
  assert.equal(response.status, 200);
  let result = await response.json();
  assert.equal(result.dashboard.missions[0].status, "discovering");

  response = await postJson(`${runtime.baseUrl}/api/missions/mission-lidar-500/actions`, { action: "discover" });
  assert.equal(response.status, 200);
  result = await response.json();
  assert.equal(result.dashboard.missions[0].status, "qualifying");
  assert.ok(result.dashboard.supplierCandidates.length >= 4);
  assert.ok(result.dashboard.supplierCandidates.every(candidate => candidate.source.reference));

  response = await postJson(`${runtime.baseUrl}/api/missions/mission-lidar-500/actions`, { action: "qualify" });
  assert.equal(response.status, 200);
  result = await response.json();
  assert.equal(result.dashboard.missions[0].status, "contacting");
  assert.ok(result.dashboard.summary.suppliersQualified >= 2);
  assert.ok(result.dashboard.supplierCandidates.some(candidate => candidate.status === "rejected"));
  assert.ok(result.dashboard.supplierCandidates.some(candidate => candidate.status === "needs_review"));

  await stopServer(runtime.child);
  runtime = await startServer(environment);
  response = await fetch(`${runtime.baseUrl}/api/dashboard`);
  dashboard = await response.json();
  assert.equal(dashboard.missions[0].status, "contacting");
  assert.ok(dashboard.supplierCandidates.length >= 4);
});

test("production defaults deny mutation and development reset without an agent token", async t => {
  const directory = await mkdtemp(join(tmpdir(), "vendor-scout-production-"));
  const port = await freePort();
  const environment = {
    ...process.env,
    PORT: String(port),
    NODE_ENV: "production",
    VENDOR_SCOUT_DATA_PATH: join(directory, "runtime.json"),
    VENDOR_SCOUT_AGENT_TOKEN: "",
    VENDOR_SCOUT_DISCOVERY_URL: "",
    VENDOR_SCOUT_ALLOW_FIXTURE_FALLBACK: "0",
    VENDOR_SCOUT_ENABLE_DEV_RESET: "0"
  };
  const runtime = await startServer(environment);
  t.after(async () => stopServer(runtime.child));

  let response = await fetch(`${runtime.baseUrl}/api/capabilities`);
  assert.equal(response.status, 200);
  const capabilities = await response.json();
  assert.equal(capabilities.agentMutationsEnabled, false);
  assert.equal(capabilities.browserMutationsEnabled, false);
  assert.equal(capabilities.fixtureFallbackEnabled, false);
  assert.equal(capabilities.devResetEnabled, false);

  response = await postJson(`${runtime.baseUrl}/api/dev/reset`, { stage: "draft" });
  assert.equal(response.status, 404);

  response = await postJson(`${runtime.baseUrl}/api/missions/mission-lidar-500/actions`, { action: "qualify" });
  assert.equal(response.status, 503);
});
