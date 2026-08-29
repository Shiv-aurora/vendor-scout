import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
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

async function startMockTrueForge() {
  let getTurnCount = 0;
  const server = http.createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const body = raw ? JSON.parse(raw) : null;
    const send = (status, value) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(value));
    };

    if (req.method === "POST" && req.url === "/api/v1/sessions/") {
      assert.deepEqual(body, { agent: { name: "vendor-scout" } });
      return send(201, { data: { id: "sess-42" } });
    }
    if (req.method === "GET" && req.url === "/api/v1/sessions/sess-42") return send(200, { data: { id: "sess-42" } });
    if (req.method === "POST" && req.url === "/api/v1/sessions/sess-42/turns") {
      assert.equal(body.stream, false);
      assert.equal(body.input[0].type, "user.message");
      assert.match(body.input[0].content, /human approval/);
      return send(200, { data: { id: "turn-42", state: { status: "running" } } });
    }
    if (req.method === "GET" && req.url === "/api/v1/sessions/sess-42/turns/turn-42") {
      getTurnCount += 1;
      return send(200, {
        data: {
          id: "turn-42",
          state: getTurnCount > 0
            ? { status: "done", output: { content: "Qualified suppliers are ready for RFQ outreach." }, requiredActions: [] }
            : { status: "running" }
        }
      });
    }
    return send(404, { message: "not found" });
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address();
  return { baseUrl: `http://127.0.0.1:${port}`, close: () => new Promise(resolve => server.close(resolve)) };
}

async function startVendorScout(environment) {
  const child = spawn(process.execPath, ["server.mjs"], { cwd: root, env: environment, stdio: ["ignore", "pipe", "pipe"] });
  let diagnostics = "";
  child.stdout.on("data", chunk => { diagnostics += chunk; });
  child.stderr.on("data", chunk => { diagnostics += chunk; });
  const baseUrl = `http://127.0.0.1:${environment.PORT}`;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (child.exitCode != null) throw new Error(`Vendor Scout exited during startup: ${diagnostics}`);
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) return { child, baseUrl };
    } catch {}
    await sleep(50);
  }
  child.kill("SIGTERM");
  throw new Error(`Vendor Scout did not start: ${diagnostics}`);
}

async function stop(child) {
  if (child.exitCode != null) return;
  child.kill("SIGTERM");
  await Promise.race([new Promise(resolve => child.once("exit", resolve)), sleep(1000)]);
}

async function postAction(baseUrl, action) {
  const response = await fetch(`${baseUrl}/api/missions/mission-lidar-500/actions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action })
  });
  const body = await response.json();
  assert.equal(response.status, 200, body.error);
  return body.dashboard;
}

test("Vendor Scout persists TrueForge session and turn state on the sourcing mission", async t => {
  const trueForge = await startMockTrueForge();
  t.after(trueForge.close);
  const directory = await mkdtemp(join(tmpdir(), "vendor-scout-trueforge-"));
  const port = await freePort();
  const runtime = await startVendorScout({
    ...process.env,
    PORT: String(port),
    NODE_ENV: "development",
    VENDOR_SCOUT_DATA_PATH: join(directory, "runtime.json"),
    VENDOR_SCOUT_AGENT_TOKEN: "",
    TRUEFORGE_BASE_URL: trueForge.baseUrl,
    TRUEFORGE_AGENT_NAME: "vendor-scout",
    TRUEFORGE_TOKEN: ""
  });
  t.after(() => stop(runtime.child));

  let response = await fetch(`${runtime.baseUrl}/api/capabilities`);
  let capabilities = await response.json();
  assert.equal(capabilities.trueForge.configured, true);
  assert.equal(capabilities.trueForge.agentName, "vendor-scout");
  assert.equal(capabilities.trueForge.endpoint, trueForge.baseUrl);

  let dashboard = await postAction(runtime.baseUrl, "connect_trueforge");
  assert.equal(dashboard.missions[0].trueForge.sessionId, "sess-42");
  assert.equal(dashboard.missions[0].trueForge.agentName, "vendor-scout");

  dashboard = await postAction(runtime.baseUrl, "start_trueforge_turn");
  assert.equal(dashboard.missions[0].trueForge.lastTurn.id, "turn-42");
  assert.equal(dashboard.missions[0].trueForge.lastTurn.status, "running");

  dashboard = await postAction(runtime.baseUrl, "sync_trueforge_turn");
  assert.equal(dashboard.missions[0].trueForge.lastTurn.status, "done");
  assert.match(dashboard.missions[0].trueForge.lastTurn.content, /RFQ outreach/);
  assert.ok(dashboard.activity.some(item => item.title === "TrueForge session connected"));
  assert.ok(dashboard.activity.some(item => item.title === "TrueForge turn done"));
});
