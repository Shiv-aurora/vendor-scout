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
  let turnPostCount = 0;
  const server = http.createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const body = raw ? JSON.parse(raw) : null;
    const send = (status, value) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(value));
    };

    if (req.method === "POST" && req.url === "/api/v1/sessions") {
      assert.deepEqual(body, { agent: { name: "vendor-scout" } });
      return send(201, { data: { id: "sess-42" } });
    }
    if (req.method === "GET" && req.url === "/api/v1/sessions/sess-42") return send(200, { data: { id: "sess-42" } });
    if (req.method === "POST" && req.url === "/api/v1/sessions/sess-42/turns") {
      turnPostCount += 1;
      assert.equal(body.stream, false);
      if (turnPostCount === 1) {
        assert.equal(body.input[0].type, "user.message");
        assert.match(body.input[0].content, /human approval/);
        return send(200, { data: { id: "turn-42", state: { status: "running" } } });
      }
      assert.deepEqual(body.input, [{ type: "user.tool_approval", thread_id: "thread-main", tool_call_id: "call-sample", approval: { status: "allow" } }]);
      return send(200, { data: { id: "turn-43", state: { status: "running" } } });
    }
    if (req.method === "GET" && req.url === "/api/v1/sessions/sess-42/turns/turn-42") {
      getTurnCount += 1;
      return send(200, {
        data: {
          id: "turn-42",
          state: {
            status: "done",
            output: null,
            required_actions: [{
              id: "approval-event-1",
              type: "tool.approval_required",
              thread_id: "thread-main",
              tool_calls: [{ id: "call-sample", source_event_id: "model-message-1" }]
            }]
          }
        }
      });
    }
    if (req.method === "GET" && req.url === "/api/v1/sessions/sess-42/turns/turn-43") {
      return send(200, { data: { id: "turn-43", state: { status: "done", output: { content: "Approved tool execution completed." }, required_actions: [] } } });
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

async function postAction(baseUrl, action, extra = {}, expectedStatus = 200) {
  const response = await fetch(`${baseUrl}/api/missions/mission-lidar-500/actions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, ...extra })
  });
  const body = await response.json();
  assert.equal(response.status, expectedStatus, body.error);
  return body;
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

  let result = await postAction(runtime.baseUrl, "connect_trueforge");
  let dashboard = result.dashboard;
  assert.equal(dashboard.missions[0].trueForge.sessionId, "sess-42");
  assert.equal(dashboard.missions[0].trueForge.agentName, "vendor-scout");

  result = await postAction(runtime.baseUrl, "start_trueforge_turn");
  dashboard = result.dashboard;
  assert.equal(dashboard.missions[0].trueForge.lastTurn.id, "turn-42");
  assert.equal(dashboard.missions[0].trueForge.lastTurn.status, "running");

  result = await postAction(runtime.baseUrl, "sync_trueforge_turn");
  dashboard = result.dashboard;
  assert.equal(dashboard.missions[0].trueForge.lastTurn.status, "done");
  assert.equal(dashboard.missions[0].trueForge.lastTurn.requiredActions.length, 1);

  result = await postAction(runtime.baseUrl, "start_trueforge_turn", {}, 409);
  assert.match(result.error, /Resolve the pending TrueForge required actions/);

  result = await postAction(runtime.baseUrl, "resume_trueforge_approval", {
    approvals: [{ threadId: "thread-main", toolCallId: "not-pending", status: "allow" }]
  }, 409);
  assert.match(result.error, /not pending/);

  result = await postAction(runtime.baseUrl, "resume_trueforge_approval", {
    approvals: [{ threadId: "thread-main", toolCallId: "call-sample", status: "allow" }]
  });
  dashboard = result.dashboard;
  assert.equal(dashboard.missions[0].trueForge.lastTurn.id, "turn-43");
  assert.equal(dashboard.missions[0].trueForge.lastTurn.status, "running");
  assert.equal(dashboard.missions[0].trueForge.lastTurn.resumedFrom, "turn-42");

  result = await postAction(runtime.baseUrl, "sync_trueforge_turn");
  dashboard = result.dashboard;
  assert.equal(dashboard.missions[0].trueForge.lastTurn.status, "done");
  assert.match(dashboard.missions[0].trueForge.lastTurn.content, /Approved tool execution completed/);
  assert.ok(dashboard.activity.some(item => item.title === "TrueForge session connected"));
  assert.ok(dashboard.activity.some(item => item.title === "TrueForge approval decisions submitted"));
});
