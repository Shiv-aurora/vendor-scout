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
  const child = spawn(process.execPath, ["server.mjs"], { cwd: root, env: environment, stdio: ["ignore", "pipe", "pipe"] });
  let diagnostics = "";
  child.stdout.on("data", chunk => { diagnostics += chunk; });
  child.stderr.on("data", chunk => { diagnostics += chunk; });
  const baseUrl = `http://127.0.0.1:${environment.PORT}`;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.exitCode != null) throw new Error(`Server exited: ${diagnostics}`);
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) return { child, baseUrl };
    } catch {}
    await sleep(50);
  }
  child.kill("SIGTERM");
  throw new Error(`Server did not start: ${diagnostics}`);
}

async function stop(child) {
  if (child.exitCode != null) return;
  child.kill("SIGTERM");
  await Promise.race([new Promise(resolve => child.once("exit", resolve)), sleep(1000)]);
}

async function runDemo(baseUrl) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["scripts/demo-decision.mjs", baseUrl], { cwd: root, env: process.env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", chunk => { stdout += chunk; });
    child.stderr.on("data", chunk => { stderr += chunk; });
    child.once("exit", code => code === 0 ? resolve(stdout) : reject(new Error(`demo builder failed (${code}): ${stderr || stdout}`)));
  });
}

async function postJson(url, body) {
  const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" }, body: JSON.stringify(body) });
  const payload = await response.json();
  return { response, payload };
}

async function callTool(baseUrl, id, name, args) {
  const { response, payload } = await postJson(`${baseUrl}/mcp`, { jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } });
  assert.equal(response.status, 200, JSON.stringify(payload));
  return payload.result;
}

async function runtimeFor(t) {
  const directory = await mkdtemp(join(tmpdir(), "vendor-scout-approval-runtime-"));
  const port = await freePort();
  const runtime = await startServer({
    ...process.env,
    PORT: String(port),
    NODE_ENV: "development",
    VENDOR_SCOUT_DATA_PATH: join(directory, "runtime.json"),
    VENDOR_SCOUT_ORDER_URL: "",
    TRUEFORGE_BASE_URL: ""
  });
  t.after(() => stop(runtime.child));
  return runtime;
}

async function snapshot(baseUrl) {
  const response = await fetch(`${baseUrl}/api/missions/mission-lidar-500`);
  assert.equal(response.status, 200);
  return response.json();
}

test("end-to-end decision flow blocks execution, records approval, and executes one idempotent controlled sample action", async t => {
  const runtime = await runtimeFor(t);
  const demoOutput = JSON.parse(await runDemo(runtime.baseUrl));
  assert.equal(demoOutput.missionStatus, "awaiting_approval");
  assert.equal(demoOutput.note.includes("controlled evidence"), true);

  let state = await snapshot(runtime.baseUrl);
  assert.equal(state.mission.status, "awaiting_approval");
  assert.equal(state.approvals.length, 1);
  assert.equal(state.approvals[0].status, "pending");
  assert.equal(state.sampleOrders.length, 0);
  assert.equal(state.recommendations.length, 1);
  assert.equal(state.quotes.filter(quote => quote.rank).length, 2);

  let tool = await callTool(runtime.baseUrl, 1, "vendor_scout_execute_sample_order", { missionId: "mission-lidar-500" });
  assert.equal(tool.isError, true, "sample execution must fail before business approval");
  assert.match(tool.content[0].text, /approved/i);
  state = await snapshot(runtime.baseUrl);
  assert.equal(state.sampleOrders.length, 0);

  const decision = await postJson(`${runtime.baseUrl}/api/missions/mission-lidar-500/approval`, { decision: "approve" });
  assert.equal(decision.response.status, 200, JSON.stringify(decision.payload));
  assert.equal(decision.payload.mission.status, "approved");
  assert.equal(decision.payload.approvals[0].status, "approved");
  assert.equal(decision.payload.sampleOrders.length, 0, "business approval must not itself spend money");

  tool = await callTool(runtime.baseUrl, 2, "vendor_scout_execute_sample_order", { missionId: "mission-lidar-500" });
  assert.equal(tool.isError, false, JSON.stringify(tool));
  assert.equal(tool.structuredContent.mission.status, "completed");
  assert.equal(tool.structuredContent.sampleOrders.length, 1);
  assert.equal(tool.structuredContent.sampleOrders[0].status, "simulated");
  assert.equal(tool.structuredContent.sampleOrders[0].simulated, true);
  assert.equal(tool.structuredContent.sampleOrders[0].provider, "controlled-sample-order");
  assert.equal(tool.structuredContent.sampleOrders[0].externalOrderId, null);
  const orderId = tool.structuredContent.sampleOrders[0].id;

  tool = await callTool(runtime.baseUrl, 3, "vendor_scout_execute_sample_order", { missionId: "mission-lidar-500" });
  assert.equal(tool.isError, false, "replaying an already completed destructive tool must be safe and idempotent");
  assert.equal(tool.structuredContent.sampleOrders.length, 1);
  assert.equal(tool.structuredContent.sampleOrders[0].id, orderId);
  assert.equal(tool.structuredContent.activity.filter(item => item.title.startsWith("Controlled sample order recorded")).length, 1);
});

test("keep negotiating and reject decisions never create a sample order", async t => {
  const runtime = await runtimeFor(t);

  await runDemo(runtime.baseUrl);
  let decision = await postJson(`${runtime.baseUrl}/api/missions/mission-lidar-500/approval`, { decision: "negotiate_more" });
  assert.equal(decision.response.status, 200);
  assert.equal(decision.payload.mission.status, "negotiating");
  assert.equal(decision.payload.approvals[0].status, "returned_to_negotiation");
  assert.equal(decision.payload.sampleOrders.length, 0);

  await runDemo(runtime.baseUrl);
  decision = await postJson(`${runtime.baseUrl}/api/missions/mission-lidar-500/approval`, { decision: "reject" });
  assert.equal(decision.response.status, 200);
  assert.equal(decision.payload.mission.status, "rejected");
  assert.equal(decision.payload.approvals[0].status, "rejected");
  assert.equal(decision.payload.sampleOrders.length, 0);
});

test("sample-order MCP tool is explicitly destructive for TrueForge approval policy", async t => {
  const runtime = await runtimeFor(t);
  const response = await postJson(`${runtime.baseUrl}/mcp`, { jsonrpc: "2.0", id: 10, method: "tools/list", params: {} });
  assert.equal(response.response.status, 200);
  const tool = response.payload.result.tools.find(item => item.name === "vendor_scout_execute_sample_order");
  assert.ok(tool);
  assert.equal(tool.annotations.destructiveHint, true);
  assert.equal(tool.annotations.openWorldHint, true);
  assert.equal(tool.annotations.idempotentHint, true);
});
